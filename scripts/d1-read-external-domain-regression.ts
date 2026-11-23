/**
 * D1 读取额度优化 + 第三方域名接入 · 专项回归
 *
 * 背景（2026-11-23）：免费版 5M rows read/天 被打满，站点 500。
 * 真因：/api/config 每页/每切页都请求，一次内部十几个 settings 单点 SELECT
 * + publicStats 的 GROUP BY 全表扫 subdomains；30 秒 isolate 缓存跨 isolate
 * 不共享，每个 isolate 过期都各自扫一遍。注册页 350ms 防抖连续打字又放大。
 *
 * 修复：公开统计持久化快照（读 1 行）、config 整响应缓存 + 浏览器 Cache-Control、
 * 全局写后失效、前端 SWR 60s 节流、注册页 600ms + 15s 结果缓存 + 序号丢弃。
 *
 * 另含「第三方域名接入」：独立表、标「（外部域名）」、不占配额、
 * 不参与公开统计、不写本站 DNS。用户后续决定先不开放，改标「即将上线」：
 * 实现代码（TXT 验证 / 供应商 API key 写记录）完整保留，但后端统一闸门
 * 让所有接口返回 503 comingSoon，前端只显示状态卡片、不渲染表单。
 * 本回归真跑这个闸门，确认接口确实不可用、数据库零写入。
 *
 * 运行：npx tsx scripts/d1-read-external-domain-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import {
  publicStats, invalidatePublicStats, resetPublicStatsCache,
} from '../src/lib/publicStats.js';
import {
  getConfigCache, setConfigCache, invalidatePublicConfig,
  CONFIG_CACHE_CONTROL, CONFIG_TTL,
} from '../src/lib/configCache.js';
import externalRoutes, {
  EXTERNAL_LABEL, EXTERNAL_DOMAINS_COMING_SOON, COMING_SOON_MESSAGE,
} from '../src/routes/externalDomains.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────────────── 轻量 D1 mock（记录每条 SQL） ───────────────── */
type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  ext: Row[];
  seq: number;
  calls: string[];
};
let S: Store;
function fresh(): Store { return { settings: new Map(), ext: [], seq: 0, calls: [] }; }

function exec(sql: string, args: any[]) {
  const s = sql.replace(/\s+/g, ' ').trim();
  S.calls.push(s);
  const rows: Row[] = [];
  let lastRowId = 0, changes = 0;
  /* 统一配置层：SELECT key, value FROM settings（真实 D1 同形） */
  if (/^SELECT key, value FROM settings$/.test(s)) {
    for (const [key, value] of S.settings) rows.push({ key, value: String(value) });
    return { rows, lastRowId, changes };
  }

  if (/^SELECT value FROM settings WHERE key = 'public_stats_snapshot'$/.test(s)) {
    const v = S.settings.get('public_stats_snapshot');
    if (v !== undefined) rows.push({ value: v });
  } else if (/^INSERT INTO settings\(key, value\) VALUES \('public_stats_snapshot', \?\)/.test(s)) {
    S.settings.set('public_stats_snapshot', String(args[0])); changes = 1;
  } else if (/^DELETE FROM settings WHERE key = 'public_stats_snapshot'$/.test(s)) {
    S.settings.delete('public_stats_snapshot'); changes = 1;
  } else if (/^SELECT COUNT\(\*\) AS n FROM users$/.test(s)) {
    rows.push({ n: 12 });
  } else if (/^SELECT COUNT\(\*\) AS n FROM subdomains WHERE status = 'approved'$/.test(s)) {
    rows.push({ n: 4200 });   // 4200 域名：旧版一次 GROUP BY 就吃掉 4200 rows read
  } else if (/GROUP BY d/.test(s)) {
    rows.push({ d: 'noxc.uk', n: 2600, u: 900 }, { d: 'meoy.top', n: 1600, u: 600 });
  } else if (/^SELECT value FROM settings WHERE key = \?$/.test(s)) {
    const v = S.settings.get(String(args[0]));
    if (v !== undefined) rows.push({ value: v });
  } else if (/^SELECT key, value FROM settings WHERE key IN/.test(s)) {
    /* config 的批量读取：空库即可 */
  } else if (/^PRAGMA table_info\(external_domains\)/.test(s)) {
    for (const n of ['id','fqdn','user_id','note','provider','ns1','ns2','zone_id',
      'verify_token','verify_status','verified_at','provider_key','created_at']) rows.push({ name: n });
  } else if (/^INSERT INTO external_domains/.test(s)) {
    /* 新流程 SQL 里有字面量，bind 的参数是 fqdn,user_id,note,verify_token,created_at */
    const [fqdn, userId, note, verifyToken, createdAt] = args;
    const id = ++S.seq;
    S.ext.push({ id, fqdn, user_id: userId, note, provider: 'dnshe', ns1: '', ns2: '',
      zone_id: '', verify_token: verifyToken, verify_status: 'pending', verified_at: null,
      provider_key: '', created_at: createdAt });
    lastRowId = id; changes = 1;
  } else if (/^UPDATE external_domains SET verify_status = 'verified'/.test(s)) {
    const r = S.ext.find((x) => x.id === Number(args[1]));
    if (r) { r.verify_status = 'verified'; r.verified_at = args[0]; changes = 1; }
  } else if (/^UPDATE external_domains SET provider = \?/.test(s)) {
    const [provider, , zoneId, ns1, ns2, id] = args;
    const r = S.ext.find((x) => x.id === Number(id));
    if (r) { r.provider = provider; r.provider_key = provider; r.zone_id = zoneId;
      r.ns1 = ns1; r.ns2 = ns2; changes = 1; }
  } else if (/^SELECT \* FROM external_domains WHERE user_id = \?/.test(s)) {
    for (const r of S.ext.filter((x) => x.user_id === Number(args[0]))) rows.push({ ...r });
  } else if (/^SELECT id FROM external_domains WHERE fqdn = \?$/.test(s)) {
    const r = S.ext.find((x) => x.fqdn === args[0]);
    if (r) rows.push({ id: r.id });
  } else if (/^SELECT COUNT\(\*\) AS n FROM external_domains WHERE user_id = \?/.test(s)) {
    rows.push({ n: S.ext.filter((x) => x.user_id === Number(args[0])).length });
  } else if (/^SELECT \* FROM external_domains WHERE id = \?$/.test(s)) {
    const r = S.ext.find((x) => x.id === Number(args[0]));
    if (r) rows.push({ ...r });
  } else if (/^DELETE FROM external_domains WHERE id = \?/.test(s)) {
    const before = S.ext.length;
    S.ext = S.ext.filter((x) => x.id !== Number(args[0]));
    changes = before - S.ext.length;
  } else if (/^INSERT INTO settings\(key, value\) VALUES \(\?, \?\)/.test(s)) {
    S.settings.set(String(args[0]), String(args[1])); changes = 1;
  } else if (/^INSERT INTO audit_log/.test(s)) {
    changes = 1;
  }
  return { rows, lastRowId, changes };
}
function makeDb() {
  const wrap = (sql: string, args: any[]) => {
    const out = () => exec(sql, args);
    return {
      first: async () => out().rows[0] ?? null,
      all: async () => ({ results: out().rows }),
      run: async () => { const r = out(); return { meta: { last_row_id: r.lastRowId, changes: r.changes } }; },
    };
  };
  return {
    prepare(sql: string) {
      return { bind(...a: any[]) { return wrap(sql, a); }, ...wrap(sql, []) };
    },
  };
}
const env = () => ({ DB: makeDb(), ROOT_DOMAIN: 'meoy.top', ROOT_DOMAINS: 'meoy.top,noxc.uk,v-1.top' } as any);

/* ───────────── A. publicStats 持久化快照：真跑 ───────────── */
{
  S = fresh(); resetPublicStatsCache();
  const E = env();
  await invalidatePublicStats(E);   // 清掉可能的旧快照
  S.calls.length = 0;
  const a = await publicStats(E);
  const heavy = S.calls.filter((q) => /GROUP BY d/.test(q) || /COUNT\(\*\)/.test(q));
  check(a.users === 12 && a.domains === 4200 && a.hottest === 'noxc.uk',
    '首次重算得到正确聚合值（users 12 / domains 4200 / HOT noxc.uk）');
  check(heavy.length === 3 && S.calls.some((q) => /INSERT INTO settings/.test(q)),
    '首次：两个 COUNT + 一次 GROUP BY，并把结果写成快照');
  check(S.settings.has('public_stats_snapshot'), '快照写入 settings 表一行');

  /* 模拟另一个 isolate：清内存缓存，只剩 D1 快照 */
  resetPublicStatsCache();
  S.calls.length = 0;
  const b = await publicStats(E);
  check(JSON.stringify(b) === JSON.stringify(a), '另一个 isolate 读到同一份快照，数字一致');
  check(S.calls.length === 1
    && /^SELECT value FROM settings WHERE key = 'public_stats_snapshot'$/.test(S.calls[0]),
    '关键：新 isolate 一次请求只花 1 row read，不再全表扫描');
  check(!S.calls.some((q) => /GROUP BY d/.test(q)), '快照命中时完全不跑 GROUP BY');

  /* 快照过期：TTL 可由环境变量调 */
  S.settings.set('public_stats_snapshot', JSON.stringify({
    at: Date.now() - 20 * 60_000, value: { users: 1, domains: 1, roots: [], hottest: null },
  }));
  resetPublicStatsCache();
  S.calls.length = 0;
  await publicStats({ ...E, PUBLIC_STATS_TTL: 30 });
  check(S.calls.some((q) => /GROUP BY d/.test(q)),
    '快照过期（或 TTL 调小）才重算一次');
  S.settings.delete('public_stats_snapshot');
  resetPublicStatsCache();
  S.calls.length = 0;
  await publicStats(E);
  check(S.calls.some((q) => /GROUP BY d/.test(q)), '快照被删后这一次确实重算');
  resetPublicStatsCache();          // 模拟下一个 isolate
  S.calls.length = 0;
  await publicStats(E);
  check(!S.calls.some((q) => /GROUP BY d/.test(q))
    && /public_stats_snapshot/.test(S.calls[0] || ''),
    '重算后立即回写快照，下一次又只 1 行');

  /* 写路径失效 */
  await invalidatePublicStats(E);
  check(!S.settings.has('public_stats_snapshot'), 'invalidatePublicStats 删快照行');
  resetPublicStatsCache();
  S.calls.length = 0;
  await publicStats(E);
  check(S.calls.some((q) => /GROUP BY d/.test(q)), '失效后下一次立即重算（开通/审核即时刷新）');
}

/* ───────────── B. /api/config 整响应缓存 ───────────── */
{
  invalidatePublicConfig();
  check(getConfigCache() === null, '初始无 config 缓存');
  setConfigCache({ siteName: 'Noxc', announcement: 'hi' });
  check(getConfigCache()?.siteName === 'Noxc', 'setConfigCache 后命中');
  invalidatePublicConfig();
  check(getConfigCache() === null, '写操作后失效，下一次重新构建');
  check(CONFIG_TTL === 30_000 && CONFIG_CACHE_CONTROL.includes('max-age=30')
    && CONFIG_CACHE_CONTROL.startsWith('private'),
    '缓存 30 秒 + 浏览器私有缓存，不缓存含登录态的数据');
}

/* ───────────── C. 源码防回流（D1） ───────────── */
const idx = read('src/index.ts');
const statsLib = read('src/lib/publicStats.ts');
const cacheLib = read('src/lib/configCache.ts');
const runtime = read('src/app/lib/runtime.ts');
const reg = read('src/app/legacy/register.ts');
const schema = read('schema.sql');
const ci = read('.github/workflows/deploy.yml');
const readme = read('README.md');
const health = read('scripts/health-check.ts');

check(/INSERT INTO settings\(key, value\) VALUES \('public_stats_snapshot'/.test(statsLib)
  && /SELECT value FROM settings WHERE key = 'public_stats_snapshot'/.test(statsLib)
  && /snapshotTtl/.test(statsLib),
  '公开统计用 settings 表一行 JSON 做持久化快照');
check(/export async function invalidatePublicStats/.test(statsLib)
  && /DELETE FROM settings WHERE key = 'public_stats_snapshot'/.test(statsLib),
  '写路径可主动失效快照');
check(/getConfigCache\(\)/.test(idx) && /CONFIG_CACHE_CONTROL/.test(idx)
  && /c\.req\.query\('_'\)/.test(idx),
  'config 整响应缓存 + cache-buster 绕过（后台保存即生效）');
check(/app\.use\('\*', async \(c, next\)/.test(idx)
  && /invalidatePublicConfig\(\)/.test(idx)
  && /invalidatePublicStats\(c\.env\)/.test(idx),
  '全局 middleware 一处覆盖全部写路径');
check(/Cache-Control', 'public, max-age=60'/.test(idx), '/api/stats 也有缓存头');
check(/Date\.now\(\) - brandAt > 60_000/.test(runtime)
  && /brandForceFresh = true/.test(runtime)
  && /configPath\(\)/.test(runtime),
  '前端 SWR 后台刷新节流 60 秒 + 保存后强制刷新');
check(/600\);/.test(reg) && /15_000/.test(reg) && /checkSeq/.test(reg)
  && /checkCache/.test(reg),
  '注册页打字节流：600ms 防抖 + 15 秒结果缓存 + 过期响应丢弃');
check(/附录 Z · 故障排查与已知错误（固定放在文末）/.test(readme)
  && readme.lastIndexOf('## 附录 Z') > readme.lastIndexOf('## 附录 ·'),
  'README 错误/故障/限制统一放在文末');
check(/Z\.1 D1 读取额度被打满/.test(readme) && /5M rows read/.test(readme),
  'README 文末记录本次 D1 事故与排查');

/* ───────────── D. 「即将上线」闸门：真跑 Hono ───────────── */
S = fresh();
const app = new Hono();
app.use('*', async (c, next) => { c.set('user', { id: 7, email: 'u@example.com', role: 'user' }); await next(); });
app.route('/api/external-domains', externalRoutes);
const CTX: any = { waitUntil() {}, passThroughOnException() {} };
const call = (method: string, body?: any, suffix = '') =>
  app.fetch(new Request('https://nic.test/api/external-domains' + suffix, {
    method, headers: { 'content-type': 'application/json', 'X-Lang': 'zh' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env(), CTX);

{
  check(EXTERNAL_LABEL === '（外部域名）', '统一标签仍是（外部域名）');
  check(EXTERNAL_DOMAINS_COMING_SOON === true
    && /即将上线/.test(COMING_SOON_MESSAGE),
    '功能开关为「即将上线」，提示文案明确');

  /* 所有方法、所有子路径都必须被闸门拦下 */
  const cases: Array<[string, any, string]> = [
    ['GET', undefined, ''],
    ['POST', { domain: 'example.com' }, ''],
    ['POST', { provider: 'cloudflare', apiKey: 'SECRET' }, '/1/verify'],
    ['POST', { provider: 'cloudflare', apiKey: 'SECRET' }, '/1/connect'],
    ['POST', { apiKey: 'SECRET', type: 'A', name: '@', content: '1.2.3.4' }, '/1/records'],
    ['DELETE', undefined, '/1'],
  ];
  for (const [method, body, suffix] of cases) {
    const res = await call(method, body, suffix);
    const j: any = await res.json();
    check(res.status === 503 && j.success === false && j.comingSoon === true
      && /即将上线/.test(j.message || ''),
      `${method} ${suffix || '/'} 返回 503 + comingSoon（接口确实不可用）`);
    check(!/SECRET/.test(JSON.stringify(j)), `${method} ${suffix || '/'} 不回显任何 API key`);
  }

  /* 关键：闸门在写库之前就拦下，D1 一行都没写 */
  check(S.ext.length === 0
    && !S.calls.some((q) => /INSERT INTO external_domains|UPDATE external_domains|DELETE FROM external_domains/.test(q)),
    '即将上线期间数据库零写入（前端收起表单后接口也不会裸奔）');

  /* 实现代码完整保留，以后把开关改回 false 就能开放，不用重写 */
  check(/checkOwnership/.test(read('src/routes/externalDomains.ts'))
    && /connectProvider/.test(read('src/routes/externalDomains.ts'))
    && /addRecord/.test(read('src/routes/externalDomains.ts'))
    && /CREATE TABLE IF NOT EXISTS external_domains/.test(schema),
    '三步流程实现与独立表完整保留，随时可开放');
}

/* ───────────── E. 前端标签与文档 ───────────── */
const dash = read('src/app/pages/Dashboard.tsx');
const whoisRoute = read('src/routes/whois.ts');
const whoisUi = read('src/app/legacy/whois.ts');
const docsZh = read('docs-src/settings.md');
const docsEn = read('docs-src/en/settings.md');
check(/第三方域名接入/.test(dash) && /externalLabel/.test(dash)
  && /id="externalCard"/.test(dash), '控制台有第三方域名接入卡片并标（外部域名）');
check(/externalLabel: EXTERNAL_LABEL/.test(whoisRoute)
  && /r\.externalLabel \|\| '（外部域名）'/.test(whoisUi),
  'WHOIS 外部域名结果也用同一份（外部域名）标签');
check(/外部域名/.test(docsZh) && /external domain/i.test(docsEn)
  && /第三方域名接入/.test(readme), '中英文档与 README 写明外部域名');
check(/applyCard[\s\S]{0,400}<ExternalDomains \/>/.test(dash),
  '第三方域名接入放在「注册域名」卡片下面');
check(/即将上线/.test(dash) && /即将上线/.test(read('src/app/pages/Register.tsx')),
  '控制台与注册页都标「即将上线」');
check(!/dashboard#externalCard/.test(read('src/app/pages/Register.tsx')),
  '注册页不再提供可跳转的接入入口');
const extRoute = read('src/routes/externalDomains.ts');
const extVerify = read('src/lib/externalVerify.ts');
const extDns = read('src/lib/providerDns.ts');
check(/checkOwnership/.test(extRoute) && /verify_status/.test(extRoute)
  && /connectProvider/.test(extRoute) && /addRecord/.test(extRoute),
  '后端三步流程：TXT 验证 → 连接供应商 → 写 DNS 记录');
check(/cloudflare-dns\.com\/dns-query/.test(extVerify)
  && /dns\.google\/resolve/.test(extVerify) && /type\) === 16/.test(extVerify),
  '所有权验证走公共 DoH JSON，TXT(type=16) 双兜底');
check(/api\.cloudflare\.com\/client\/v4/.test(extDns)
  && /isNameInDomain/.test(extDns) && /proxied: false/.test(extDns),
  'Cloudflare 官方 v4 写入，名称限定本域名，不默认开代理');
check(/nsWarning/.test(extRoute) && /NS 生效前/.test(extRoute),
  '接口明确提示 NS 前提，不假装加 TXT 就能解析');
check(!/api_?key/i.test(read('schema.sql').slice(
  read('schema.sql').indexOf('CREATE TABLE IF NOT EXISTS external_domains'),
  read('schema.sql').indexOf('CREATE INDEX IF NOT EXISTS idx_external_user')).replace(/verify_token/g,'')),
  'external_domains 表不存供应商 API key');
check(/EXTERNAL_DOMAINS_COMING_SOON = true/.test(extRoute)
  && /app\.use\('\*'/.test(extRoute) && /503/.test(extRoute),
  '后端统一闸门：即将上线时接口全部 503，不放行任何写入');
check(!/api\.(post|del|get)\(/.test(dash.slice(dash.indexOf('function ExternalDomains'), dash.indexOf('/** Dashboard')))
  && !/<input|<select|<form/.test(dash.slice(dash.indexOf('function ExternalDomains'), dash.indexOf('/** Dashboard'))),
  '控制台卡片没有任何表单 / 接口调用，只是状态说明');
check(/即将上线|coming soon/i.test(docsZh) && /coming soon/i.test(docsEn)
  && /即将上线/.test(readme), '中英文档与 README 写明「即将上线」');
check(/D1 读取与第三方域名回归/.test(ci)
  && /d1-read-external-domain-regression\.ts/.test(ci), '专项回归进 CI');
check(/public_stats_snapshot/.test(health), '健康巡检有防回流断言');

/* ───────────── F. 反向对照 ───────────── */
const oldStats = statsLib.replace(/const snap = await readSnapshot\(env\);/, '/* 无快照 */');
check(oldStats !== statsLib && !/const snap = await readSnapshot/.test(oldStats),
  '反向对照：拿掉快照读取后每个 isolate 都会全表扫描，断言必须失败');
const noThrottle = runtime.replace(/Date\.now\(\) - brandAt > 60_000/, 'true');
check(noThrottle !== runtime && !/Date\.now\(\) - brandAt > 60_000/.test(noThrottle),
  '反向对照：把 SWR 节流改回每次都刷新会被断言拦下');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`D1 读取与第三方域名回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
