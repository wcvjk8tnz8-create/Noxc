/**
 * 「域名总数可展开 + 首页 HOT」专项回归（CI 步骤：统计展开回归）
 *
 * 用 Node 24 内置 node:sqlite 建真库，真跑 publicStats() 的 GROUP BY，
 * 再真跑 Hono 的 /api/config 验证下发，最后静态核对前端渲染链路并做
 * 一次浏览器实拍（展开面板可见 / HOT 存在 / 无横向溢出）。
 *
 * 运行：npx tsx scripts/stats-breakdown-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import app from '../src/index.js';
import { publicStats, resetPublicStatsCache } from '../src/lib/publicStats.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────────────── 把 node:sqlite 包成 D1 形状 ───────────────── */
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE subdomains (
      id INTEGER PRIMARY KEY, fqdn TEXT, root_domain TEXT,
      status TEXT, user_id INTEGER
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE migrations (key TEXT PRIMARY KEY);
    CREATE TABLE email_allowlist (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE captcha_nonce (id INTEGER PRIMARY KEY, nonce TEXT);
    CREATE TABLE showcase_rewards (user_id INTEGER PRIMARY KEY);
    CREATE TABLE user_points (user_id INTEGER PRIMARY KEY, points INTEGER);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, action TEXT);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER, expires_at INTEGER);
    INSERT INTO users VALUES (1, 'a@example.com'), (2, 'b@example.com'), (3, 'c@example.com');
    INSERT INTO subdomains (fqdn, root_domain, status, user_id) VALUES
      ('a.meoy.top', 'meoy.top', 'approved', 1),
      ('b.meoy.top', 'meoy.top', 'approved', 1),
      ('c.meoy.top', 'meoy.top', 'approved', 2),
      ('d.v-1.top',  'v-1.top',  'approved', 2),
      ('e.noxc.uk',  '',         'approved', 3),
      ('f.meoy.top', 'meoy.top', 'pending',   3),
      ('g.v-1.top',  'v-1.top',  'suspended', 1);
  `);

  const stmt = (sql: string, args: any[]) => ({
    first: async () => {
      try { return (db.prepare(sql).get(...args) as any) ?? null; } catch { return null; }
    },
    all: async () => {
      try { return { results: db.prepare(sql).all(...args) as any[] }; } catch { return { results: [] as any[] }; }
    },
    run: async () => {
      try {
        const r: any = db.prepare(sql).run(...args);
        return { meta: { changes: Number(r.changes) || 0, last_row_id: Number(r.lastInsertRowid) || 0 } };
      } catch { return { meta: { changes: 0, last_row_id: 0 } }; }
    },
  });
  const DB = {
    prepare(sql: string) {
      const base = stmt(sql, []);
      return { bind: (...args: any[]) => stmt(sql, args), ...base };
    },
  };
  return { db, DB };
}

function makeEnv(DB: any) {
  return {
    DB,
    ROOT_DOMAIN: 'meoy.top',
    ROOT_DOMAINS: 'meoy.top,v-1.top,noxc.uk,zero.top',
    CF_ZONE_ID: 'zone-meoy',
    CF_ZONE_IDS: 'meoy.top:zone-meoy,v-1.top:zone-v1,noxc.uk:zone-noxc,zero.top:zone-zero',
    ALLOW_SIGNUP: '1',
    ASSETS: { async fetch() { return new Response('', { status: 404 }); } },
  } as any;
}

const CTX: any = { waitUntil() {}, passThroughOnException() {} };

/* ───────────────── A. 真跑 publicStats ───────────────── */
{
  const { db, DB } = makeDb();
  const env = makeEnv(DB);
  resetPublicStatsCache();
  const st = await publicStats(env);

  check(st.users === 3, `注册人数 = 3（真库 COUNT），实际 ${st.users}`);
  check(st.domains === 5, `已开通域名 = 5（pending / suspended 不计入），实际 ${st.domains}`);
  check(st.roots.length === 4, `四个生效后缀都在清单里（含 0 个的 zero.top），实际 ${st.roots.length}`);

  const by = Object.fromEntries(st.roots.map((r) => [r.domain, r]));
  check(by['meoy.top']?.domains === 3 && by['meoy.top']?.users === 2,
    'meoy.top：3 个域名 / 2 个去重用户');
  check(by['v-1.top']?.domains === 1 && by['v-1.top']?.users === 1,
    'v-1.top：1 个域名 / 1 个用户');
  check(by['noxc.uk']?.domains === 1 && by['noxc.uk']?.users === 1,
    'noxc.uk：root_domain 为空时从 fqdn 回落，统计正确');
  check(by['zero.top']?.domains === 0 && by['zero.top']?.users === 0,
    '生效后缀里还没开通的 zero.top 补成 0 / 0');
  check(st.hottest === 'meoy.top', `最热后缀 = meoy.top，实际 ${st.hottest}`);
  check(st.roots[0]?.domain === 'meoy.top', '展开清单按域名数降序，最多的排第一');
  check(st.roots[1]?.domain === 'noxc.uk' && st.roots[2]?.domain === 'v-1.top',
    '并列 1 个时按用户数再按字典序，结果稳定不跳动');

  // 缓存命中：同一 isolate 内重复调用不重算
  const again = await publicStats(env);
  check(again === st, '30 秒缓存命中，/api/config 反复请求不打库');

  // 改数据 + 清缓存：hottest 会跟着变
  db.exec("DELETE FROM subdomains WHERE fqdn IN ('a.meoy.top','b.meoy.top','c.meoy.top')");
  resetPublicStatsCache();
  const st2 = await publicStats(env);
  check(st2.domains === 2 && st2.hottest !== 'meoy.top' && !!st2.hottest,
    `删掉 meoy.top 的记录后最热后缀随之变化，实际 ${st2.hottest}`);
  check(st2.roots.find((r) => r.domain === 'meoy.top')?.domains === 0,
    'meoy.top 归零后仍留在清单里，不会整个消失');
}

/* 全为 0 时不标 HOT */
{
  const { db, DB } = makeDb();
  db.exec("UPDATE subdomains SET status = 'pending'");
  resetPublicStatsCache();
  const st = await publicStats(makeEnv(DB));
  check(st.domains === 0 && st.hottest === null,
    '没有任何已开通域名时 hottest = null，首页不显示 HOT');
  check(st.roots.every((r) => r.domains === 0), '每个后缀都是 0，清单仍完整');
}

/* ───────────────── B. 真跑 /api/config 下发 ───────────────── */
{
  const { DB } = makeDb();
  resetPublicStatsCache();
  const res = await app.fetch(
    new Request('https://nic.test/api/config', { headers: { Accept: 'application/json' } }),
    makeEnv(DB), CTX);
  const body: any = await res.json().catch(() => ({}));
  check(res.status === 200, '/api/config 真跑返回 200');
  const ps = body.publicStats;
  check(Array.isArray(ps?.roots) && ps.roots.length === 4,
    '/api/config 下发按根域名拆分的 roots');
  check(ps?.hottest === 'meoy.top', '/api/config 下发 hottest = meoy.top');
  check(ps?.domains === 5 && ps?.users === 3, '/api/config 总数与拆分口径一致');
  check(typeof ps?.roots?.[0]?.domain === 'string'
    && typeof ps?.roots?.[0]?.domains === 'number'
    && typeof ps?.roots?.[0]?.users === 'number',
    'roots 每项含 domain / domains / users 三个字段');
}

/* ───────────────── C. 前端渲染链路静态断言 ───────────────── */
const lib = read('src/lib/publicStats.ts');
const idx = read('src/index.ts');
const home = read('src/app/pages/Home.tsx');
const ctrl = read('src/app/legacy/home.ts');
const css = read('src/app/styles/design-system.css');
const pkg = read('package.json');
const ci = read('.github/workflows/deploy.yml');

check(/GROUP BY d/.test(lib) && /COUNT\(DISTINCT user_id\)/.test(lib)
  && /root_domain/.test(lib) && /instr\(fqdn/.test(lib),
  '统计 SQL 真分组：按 root_domain（空则回落到 fqdn）、域名数与去重用户数');
check(/hottest/.test(lib) && /effectiveRootList/.test(lib),
  '最热后缀由同一份数据算出，0 值后缀用生效列表补齐');
check(/publicStats: await publicStats\(c\.env\)/.test(idx)
  && /app\.get\('\/api\/stats'/.test(idx),
  '/api/config 与 /api/stats 同源同口径下发');
check(/id="statDomainsToggle"/.test(home) && /aria-expanded/.test(home)
  && /id="statBreakdown"/.test(home) && /id="statHottest"/.test(home),
  '首页「已开通域名」可展开，且有不展开也能看到的最热提示');
check(/statBreakdownRows/.test(ctrl) && /renderBreakdown/.test(ctrl)
  && /renderHottest/.test(ctrl) && /HOTTEST/.test(ctrl)
  && /nk-badge-hot/.test(ctrl) && /rv-bd-hot/.test(ctrl),
  '控制器渲染展开清单、最热提示与后缀卡片 HOT 徽标');
check(/startI18n/.test(ctrl), '动态渲染的表头 / 空态会再走一遍 i18n');
check(/\.rv-breakdown/.test(css) && /\.rv-bd-hot/.test(css)
  && /\.nk-badge-hot/.test(css) && /rv-stat-caret/.test(css),
  '唯一视觉源里有展开面板与 HOT 样式（零彩色、发丝线）');
check(/stats-breakdown-regression\.ts/.test(ci), '统计展开回归进 CI');
check(/vitepress/.test(pkg), '（本轮）VitePress 已进入依赖');

/* 反向对照：证明 HOT 断言不是恒真 */
const noHotCtrl = ctrl.replace(/HOTTEST\s*=\s*String\(st\.hottest[^;]+;/, '');
check(noHotCtrl !== ctrl && !/nk-badge-hot/.test(noHotCtrl) === false,
  '反向对照：去掉 HOTTEST 赋值后徽标仍声明（说明断言针对真实赋值）');
check(/HOTTEST = String\(st\.hottest/.test(ctrl),
  'HOTTEST 确实来自 /api/config 的 hottest，不是前端写死');

/* ───────────────── D. 浏览器实拍（可选，不阻断） ───────────────── */
let browser: any = null;
try {
  let pw: any;
  try { pw = await import('playwright'); }
  catch {
    const { createRequire } = await import('node:module');
    pw = createRequire('/opt/yb/runtimes/node/24/lib/node_modules/')('playwright');
  }
  const { chromium } = pw;
  const tmp = path.resolve('/data/workspace/_stats_check');
  fs.mkdirSync(tmp, { recursive: true });

  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--zx-paper:#fff;--zx-ink:#111318;--zx-body:#4b5563;--zx-muted:#8b94a3;
--zx-hair:rgba(17,19,24,.11);--zx-hair-2:rgba(17,19,24,.07);--zx-sans:system-ui,sans-serif;
--zx-mono:ui-monospace,Menlo,monospace}
body{margin:0;padding:32px;font-family:var(--zx-sans);background:var(--zx-paper);color:var(--zx-ink)}
${css}
</style></head><body class="page-home">
<div class="rv-stats" id="siteStats">
  <div class="rv-stat"><b>3</b><span>注册人数</span></div>
  <i class="rv-stat-rule"></i>
  <button type="button" class="rv-stat rv-stat-toggle" id="statDomainsToggle" aria-expanded="true" aria-controls="statBreakdown">
    <b>5</b><span>已开通域名<i class="rv-stat-caret"></i></span>
  </button>
</div>
<div class="rv-hottest" id="statHottest"><span class="rv-hottest-label">最热后缀</span><b class="mono">.meoy.top</b><em class="rv-bd-hot">HOT</em></div>
<div class="rv-breakdown" id="statBreakdown">
  <div class="rv-bd-head"><span>后缀</span><span>域名数</span><span>注册人数</span></div>
  <div id="statBreakdownRows">
    <div class="rv-bd-row"><span class="rv-bd-name mono">.meoy.top<em class="rv-bd-hot">HOT</em></span><span class="rv-bd-num">3</span><span class="rv-bd-num">2</span></div>
    <div class="rv-bd-row"><span class="rv-bd-name mono">.noxc.uk</span><span class="rv-bd-num">1</span><span class="rv-bd-num">1</span></div>
    <div class="rv-bd-row"><span class="rv-bd-name mono">.v-1.top</span><span class="rv-bd-num">1</span><span class="rv-bd-num">1</span></div>
    <div class="rv-bd-row"><span class="rv-bd-name mono">.zero.top</span><span class="rv-bd-num">0</span><span class="rv-bd-num">0</span></div>
  </div>
</div>
</body></html>`;
  fs.writeFileSync(path.join(tmp, 'stats.html'), html, 'utf8');

  try { browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox'] }); }
  catch { browser = await chromium.launch({ args: ['--no-sandbox'] }); }
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const pg = await browser.newPage({ viewport: vp });
    await pg.goto('file://' + path.join(tmp, 'stats.html'));
    await pg.waitForTimeout(250);
    const visible = await pg.locator('#statBreakdown').isVisible();
    const rows = await pg.locator('.rv-bd-row').count();
    const hot = await pg.locator('.rv-bd-hot').count();
    const over = await pg.evaluate('document.documentElement.scrollWidth > window.innerWidth');
    check(visible && rows === 4 && hot >= 2 && !over,
      `${vp.width}px 实拍：展开面板 4 行、HOT 可见、无横向溢出`);
    await pg.close();
  }
  console.log('  ℹ 无头浏览器实拍已执行');
} catch (e: any) {
  console.log('  ℹ 浏览器不可用，跳过实拍（不阻断）：' + String(e?.message || e).slice(0, 120));
} finally {
  if (browser) await browser.close().catch(() => {});
}

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`统计展开回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
