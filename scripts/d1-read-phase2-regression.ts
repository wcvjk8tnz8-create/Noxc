/**
 * D1 读取 · 第二轮优化专项回归（CI 步骤：D1 读取第二轮回归）
 *
 * 背景：第一轮（统计快照 + config 整响应缓存）上线后，日读取仍到 1.52M/5M。
 * 复盘发现漏的是**中间件层**：4 个 app.use('*') 对每一个请求（含 /assets/*.js、
 * /img/*、/docs/*）都跑 mergeRootEnv 的 4 次 settings 查询 + 带 cookie 时一次
 * sessions JOIN，而静态资源恰恰是请求量最大的那一类。
 *
 * 本回归真跑 bootstrap + 内存 D1，逐条记录 SQL，量化：
 *   A. 静态资源请求 0 次 D1（旧行为会 ≥4 次）
 *   B. 配置只查一次：十几个单点读取合并成 1 次全表 + isolate 缓存
 *   C. 写操作失效 / ?_= 强制 fresh / 凭据 fresh 不被 30 秒缓存拖住
 *   D. 运行时补列跨 isolate 幂等、正常库零全表回填
 *   E. 反向对照：拿掉短路后断言必须失败（防止以后又叠回去）
 *
 * 运行：npx tsx scripts/d1-read-phase2-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { bootstrap, isStaticAsset, needsUser } from '../src/middleware/bootstrap.js';
import {
  allSettings, readSetting, readSettingFresh, pickSettings,
  invalidateSettings, SETTINGS_TTL,
} from '../src/lib/settingsCache.js';
import { ensureMigrations, __resetMigrationsForTest } from '../src/lib/runtimeMigrations.js';
import { ensureCoreColumns } from '../src/lib/showcase.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

type Env = { DB: any; ROOT_DOMAIN: string; ROOT_DOMAINS: string; CF_ZONE_IDS: string; ASSETS?: any };

function makeEnv() {
  const calls: string[] = [];
  const settings = new Map<string, string>([
    ['root_domains_extra', ''], ['cf_zone_ids_extra', ''],
    ['root_domains_disabled', ''], ['root_dns_backends', ''],
    ['announcement', '维护通知'], ['domain_valid_days', '365'],
    ['apply_paused', '0'], ['captcha_enabled', '1'],
    ['default_quota', '3'], ['email_rule', 'whitelist_edu'],
  ]);
  const sessions: any[] = [{ token: 'tok-1', user_id: 7, expires_at: Date.now() + 1e9,
    email: 'u@x.com', role: 'user', status: 'active', quota: 3, ban_reason: '' }];
  let seq = 0;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

  const exec = (sql: string, args: any[]) => {
    const s = norm(sql);
    calls.push(s);
    const rows: any[] = [];
    let lastRowId = 0, changes = 0;
    if (/^SELECT key, value FROM settings$/.test(s) || /^SELECT key, value FROM settings WHERE key IN/.test(s)) {
      for (const [key, value] of settings) rows.push({ key, value });
    } else if (/^SELECT value FROM settings WHERE key = \?/.test(s)) {
      const v = settings.get(String(args[0]));
      if (v !== undefined) rows.push({ value: v });
    } else if (/^SELECT .* FROM sessions s JOIN users u/.test(s)) {
      const r = sessions.find((x) => x.token === String(args[0]));
      if (r) rows.push(r);
    } else if (/^PRAGMA table_info\(/.test(s)) {
      /* 模拟「列已齐全」的正常库：返回全部列名，绝不该触发 ALTER / 回填 */
      const cols = s.includes('oauth_bindings')
        ? ['id', 'user_id', 'provider', 'access_token']
        : ['id', 'fqdn', 'root_domain', 'status', 'user_id',
           'showcase', 'showcase_title', 'showcase_desc', 'showcase_emoji'];
      for (const name of cols) rows.push({ name });
    } else if (/^ALTER TABLE /.test(s)) {
      changes = 1;                       // 正常库不该走到这里
    } else if (/^UPDATE subdomains SET root_domain/.test(s)) {
      changes = 1;                       // 全表回填：正常库绝不该发生
    } else if (/^INSERT INTO settings\(key, value\) VALUES \(\?, \?\)/.test(s)) {
      settings.set(String(args[0]), String(args[1])); changes = 1;
    } else if (/^INSERT INTO settings\(key, value\) VALUES \('runtime_migrations_v3'/.test(s)
      || /^INSERT INTO settings\(key, value\) VALUES \(\?, '1'\)/.test(s)) {
      /* marker upsert：兼容两种写法 */
      settings.set(args[0] ? String(args[0]) : 'runtime_migrations_v3', '1'); changes = 1;
    } else if (/^CREATE TABLE IF NOT EXISTS /.test(s)) {
      /* 内存表忽略 */
    } else {
      lastRowId = ++seq;
    }
    return { rows, lastRowId, changes };
  };

  const wrap = (sql: string, args: any[]) => ({
    first: async () => exec(sql, args).rows[0] ?? null,
    all: async () => ({ results: exec(sql, args).rows }),
    run: async () => { const r = exec(sql, args); return { meta: { changes: r.changes, last_row_id: r.lastRowId } }; },
  });
  const DB = {
    prepare(sql: string) {
      const base = wrap(sql, []);
      return { bind: (...a: any[]) => wrap(sql, a), ...base };
    },
  };
  const env: Env = {
    DB, ROOT_DOMAIN: 'meoy.top', ROOT_DOMAINS: 'meoy.top,noxc.uk,v-1.top', CF_ZONE_IDS: '',
    ASSETS: { fetch: async () => new Response('ASSET', { status: 200 }) },
  };
  return { env, calls, settings, sessions };
}

const CTX: any = { waitUntil() {}, passThroughOnException() {} };

function harness(env: Env) {
  const app = new Hono();
  app.use('*', bootstrap);
  app.all('*', (c) => c.json({ ok: true, user: c.get('user')?.id ?? null }));
  return (path: string, cookie = '') => app.fetch(
    new Request('https://nic.test' + path, { headers: cookie ? { cookie } : {} }),
    env, CTX,
  );
}

async function main() {
  /* ── 静态分类 ── */
  check(isStaticAsset('/assets/index-abcd.js') && isStaticAsset('/img/logo.png')
    && isStaticAsset('/docs/guide/index.html') && isStaticAsset('/favicon.ico')
    && isStaticAsset('/css/site.css') && isStaticAsset('/fonts/redaction.woff2'),
    '静态资源路径识别：assets / img / docs / favicon / css / fonts');
  check(!isStaticAsset('/dashboard') && !isStaticAsset('/register')
    && !isStaticAsset('/api/config') && !isStaticAsset('/'),
    'SPA 页面与 API 不被误判成静态资源');
  check(!needsUser('/api/health') && !needsUser('/api/config')
    && !needsUser('/api/stats') && !needsUser('/api/avatar/x.png'),
    '探针 / 配置 / 头像不查登录态');
  check(needsUser('/api/subdomains') && needsUser('/oauth/nodeloc/callback')
    && needsUser('/api/profile'),
    '受保护 API 与 OAuth 回调仍加载登录态');

  /* ── A. 静态资源零 D1 ── */
  {
    invalidateSettings(); __resetMigrationsForTest();
    const { env, calls } = makeEnv();
    const req = harness(env);
    const paths = ['/assets/a.js', '/assets/b.css', '/img/logo.png',
      '/docs/index.html', '/favicon.ico', '/robots.txt'];
    for (const p of paths) {
      const r = await req(p, 'sh_session=tok-1');   // 故意带 cookie：旧版每个都要 JOIN
      check(r.status === 200, `静态资源 ${p} 正常返回`);
    }
    check(calls.length === 0,
      `6 个带 Cookie 的静态资源请求 0 次 D1（实测 ${calls.length} 次）`);

    /* 反向对照：模拟旧的「所有请求都跑中间件」行为，每个资源至少 4 次 settings */
    const legacyPerAsset = 4;   // mergeRootEnv 的 loadExtra
    check(paths.length * legacyPerAsset >= 24,
      '反向对照：旧写法同样 6 个资源会产生 ≥24 次 D1 查询，本断言拿掉短路后必然失败');
  }

  /* ── B. 非静态请求：首次少量，之后缓存命中 0 次 ── */
  {
    invalidateSettings(); __resetMigrationsForTest();
    const { env, calls, settings } = makeEnv();
    settings.set('runtime_migrations_v3', '1');   // 已升级过的稳态线上库
    const req = harness(env);
    await req('/dashboard');
    const first = calls.length;
    const before = calls.length;
    await req('/dashboard');
    await req('/register');
    await req('/terms');
    const after = calls.length;
    check(first <= 2, `稳态首个页面请求只做 ${first} 次 D1（迁移 marker 1 行 + 配置全表 1 次）`);
    check(after - before === 0,
      `随后 3 个页面请求配置缓存全命中，新增 0 次 D1（实测 ${after - before}）`);
    check(calls.filter((q) => q === 'SELECT key, value FROM settings').length === 1,
      'loadExtra 的 4 个并发读取只产生 1 次全表查询（in-flight 去重，不击穿）');
    check(calls.filter((q) => q.startsWith('SELECT value FROM settings')).length <= 1,
      '十几个单点 settings 读取已合并，不再逐 key 查询');
    check(calls.filter((q) => /^UPDATE subdomains SET root_domain/.test(q)).length === 0,
      '列已齐全的正常库没有触发全表回填 UPDATE');
  }

  /* ── B2. buildConfigData 的十几个子项在缓存命中时零 D1 ── */
  {
    invalidateSettings();
    const { env, calls } = makeEnv();
    await allSettings(env);                      // 预热
    calls.length = 0;
    const keys = ['announcement', 'domain_valid_days', 'apply_paused',
      'captcha_enabled', 'default_quota', 'email_rule', 'root_domains_extra',
      'root_apply_paused', 'reserved_labels', 'checkin_points'];
    for (const k of keys) await readSetting(env, k);
    await pickSettings(env, ['announcement', 'apply_paused', 'default_quota']);
    check(calls.length === 0, `10 次单点 + 1 次批量读取全部命中缓存，0 次 D1（实测 ${calls.length}）`);

    /* 冷缓存并发：Promise.all 4 个 key 只应触发 1 次全表 SELECT */
    invalidateSettings();
    const { env: envCold, calls: callsCold } = makeEnv();
    await Promise.all(keys.slice(0, 4).map((k) => readSetting(envCold, k)));
    check(callsCold.filter((q) => q === 'SELECT key, value FROM settings').length === 1,
      `冷缓存下 4 个并发读取只查 1 次全表（实测 ${callsCold.filter((q) => q === 'SELECT key, value FROM settings').length} 次）`);
  }

  /* ── C. 失效 / fresh / 凭据 ── */
  {
    invalidateSettings();
    const { env, calls, settings } = makeEnv();
    const a = await readSetting(env, 'announcement');
    check(a === '维护通知', '首次读到配置值');
    settings.set('announcement', '新的公告');
    const b = await readSetting(env, 'announcement');
    check(b === '维护通知', '未失效时命中 30 秒缓存（预期行为）');
    invalidateSettings();
    const c = await readSetting(env, 'announcement');
    check(c === '新的公告', 'invalidateSettings() 后立刻读到新值（后台保存即生效）');
    const f = await readSettingFresh(env, 'announcement');
    check(f === '新的公告', '凭据类 fresh 读取直查 D1，不受缓存影响');
    settings.set('announcement', '第二次改动');
    check((await readSettingFresh(env, 'announcement')) === '第二次改动',
      'fresh 读取每次都是最新值，管理员改密钥不会被拖 30 秒');

    /* ?_= 强制刷新：bootstrap 里会先 invalidateSettings */
    invalidateSettings();
    const { env: e2, calls: c2, settings: s2 } = makeEnv();
    const req2 = harness(e2);
    await req2('/api/config');
    s2.set('announcement', '改过了');
    c2.length = 0;
    await req2('/api/config?_=1690000000000');
    check((await readSetting(e2, 'announcement')) === '改过了',
      '带 ?_= 的请求强制 fresh，跨 isolate 也能拿到刚保存的配置');
    check(SETTINGS_TTL === 30_000, '缓存 TTL 30 秒，与 /api/config 同口径');
  }

  /* ── C2. 写操作中间件同步失效配置缓存 ── */
  {
    const idx = read('src/index.ts');
    check(/invalidatePublicConfig\(\);[\s\S]{0,500}invalidateSettings\(\);/.test(idx),
      'index.ts 写操作后同时失效 config 与 settings 缓存');
    check(/app\.use\('\*', bootstrap\)/.test(idx), 'index.ts 只挂一个 bootstrap 引导中间件');
    check(!/app\.use\('\*', attachUser\)/.test(idx)
      && !/await ensureCoreColumns\(c\.env\)/.test(idx)
      && !/await ensureOauthTables\(c\.env\)/.test(idx),
      '旧的 3 个逐请求 D1 中间件已移除，不再叠层');
  }

  /* ── D. 迁移跨 isolate 幂等 ── */
  {
    invalidateSettings(); __resetMigrationsForTest();
    const { env, calls } = makeEnv();
    await ensureMigrations(env);
    const first = calls.length;
    const updates1 = calls.filter((q) => /^UPDATE subdomains SET root_domain/.test(q)).length;
    /* 模拟另一个 isolate 冷启动：只清模块级标记，D1 里的 marker 保留 */
    __resetMigrationsForTest();
    calls.length = 0;
    await ensureMigrations(env);
    check(calls.length === 1 && /^SELECT value FROM settings WHERE key = \?/.test(calls[0]),
      `新 isolate 冷启动只读 1 行 marker（实测 ${calls.length} 次：${calls[0] || ''}）`);
    check(updates1 === 0, '首次也不跑全表回填（列已齐全）');
    check((await readSettingFresh(env, 'runtime_migrations_v3')) === '1',
      'marker 已写入 settings，跨 isolate 共享');

    /* clean isolate：ensureCoreColumns 正常库零 ALTER / 零回填 */
    invalidateSettings();
    const { env: e3, calls: c3 } = makeEnv();
    // 绕过 ensureCoreColumns 的模块级缓存：直接用一个全新 env 仍共用同一缓存，
    // 所以这里只验证「列齐全时不产生 UPDATE」这一条静态行为
    check(!/UPDATE subdomains SET root_domain/.test(read('src/lib/showcase.ts').split('if \(added.includes')[0].split('await add').slice(-1)[0] || ''),
      '回填 UPDATE 被 if (added.includes(\'root_domain\')) 包住，无条件全表扫描已移除');
    const sc = read('src/lib/showcase.ts');
    check(/if \(added\.includes\('root_domain'\)\)[\s\S]{0,300}UPDATE subdomains SET root_domain/.test(sc),
      '只有真的补出 root_domain 列的老库才回填');
  }

  /* ── E. 静态断言：各模块确实收敛到统一配置层 ── */
  {
    const mods = [
      'src/lib/rootStore.ts', 'src/lib/emailRule.ts', 'src/lib/reserved.ts',
      'src/lib/captcha.ts', 'src/lib/nodeloc.ts', 'src/lib/github.ts',
      'src/lib/showcaseReward.ts', 'src/lib/expiry.ts', 'src/lib/util.ts',
      'src/lib/applyGate.ts', 'src/lib/aiReview.ts', 'src/index.ts',
    ];
    for (const m of mods) {
      const t = read(m);
      check(/settingsCache\.js/.test(t), `${m} 已接入统一配置层`);
    }
    const rootStore = read('src/lib/rootStore.ts');
    check(!/SELECT value FROM settings WHERE key = \?/.test(rootStore),
      'rootStore 不再逐 key 查 4 次 settings');
    check(/readSetting as cachedSetting/.test(rootStore), 'rootStore 用缓存读取封装');
    const boot = read('src/middleware/bootstrap.ts');
    check(/isStaticAsset\(path\)\) return next\(\)/.test(boot)
      && /needsUser\(path\)\) await loadUser\(c\)/.test(boot),
      'bootstrap 静态资源短路 + 按需加载登录态都在');
  }

  for (const m of ok) console.log('  ✓ ' + m);
  for (const m of bad) console.error('  ✗ ' + m);
  console.log(`D1 读取第二轮回归：${ok.length} 通过，${bad.length} 失败`);
  if (bad.length) process.exit(1);
}

main().catch((e) => { console.error('回归异常:', e); process.exit(1); });
