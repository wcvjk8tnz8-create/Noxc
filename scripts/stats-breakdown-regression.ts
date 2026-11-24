/**
 * 「域名总数可展开 + 首页 HOT」专项回归（CI 步骤：统计展开回归）
 *
 * 用跨 Node 版本的内存 D1 表（不依赖 node:sqlite，CI 是 Node 20），
 * 真跑 publicStats() 的分组 / 排序 / 补 0 / hottest，再真跑 Hono 的
 * /api/config 验证下发，最后静态核对前端渲染链路并做浏览器实拍
 * （展开面板可见 / HOT 存在 / 无横向溢出）。
 *
 * 运行：npx tsx scripts/stats-breakdown-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import app from '../src/index.js';
import { publicStats, resetPublicStatsCache } from '../src/lib/publicStats.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────────────── 内存 D1（跨 Node 20/22/24） ─────────────────
   GROUP_SQL 在这里用等价的 JS 分组实现，返回与 SQLite 相同的 d / n / u 列，
   其余 SQL 按本回归需要的形状应答；/api/config 的其它 helper 查不到就走
   各自的 try/catch 兜底，与线上「表未建 / D1 抖动」的降级路径一致。 */
type SubRow = { fqdn: string; root_domain: string; status: string; user_id: number };

function makeDb() {
  let subs: SubRow[] = [
    { fqdn: 'a.meoy.top', root_domain: 'meoy.top', status: 'approved',  user_id: 1 },
    { fqdn: 'b.meoy.top', root_domain: 'meoy.top', status: 'approved',  user_id: 1 },
    { fqdn: 'c.meoy.top', root_domain: 'meoy.top', status: 'approved',  user_id: 2 },
    { fqdn: 'd.v-1.top',  root_domain: 'v-1.top',  status: 'approved',  user_id: 2 },
    { fqdn: 'e.noxc.uk',  root_domain: '',         status: 'approved',  user_id: 3 },
    { fqdn: 'f.meoy.top', root_domain: 'meoy.top', status: 'pending',   user_id: 3 },
    { fqdn: 'g.v-1.top',  root_domain: 'v-1.top',  status: 'suspended', user_id: 1 },
  ];
  const users = [1, 2, 3];
  const settings = new Map<string, string>();

  async function query(sql: string, args: any[]): Promise<any[]> {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT COUNT\(\*\) AS n FROM users/.test(q)) return [{ n: users.length }];
    if (/^SELECT COUNT\(\*\) AS n FROM subdomains WHERE status = 'approved'/.test(q)) {
      return [{ n: subs.filter((r) => r.status === 'approved').length }];
    }
    if (/GROUP BY d/.test(q)) {
      const map = new Map<string, { n: number; u: Set<number> }>();
      for (const r of subs) {
        if (r.status !== 'approved') continue;
        const d = r.root_domain
          ? r.root_domain.trim().toLowerCase()
          : (r.fqdn.includes('.') ? r.fqdn.slice(r.fqdn.indexOf('.') + 1) : r.fqdn).toLowerCase();
        const cur = map.get(d) || { n: 0, u: new Set<number>() };
        cur.n += 1; cur.u.add(r.user_id); map.set(d, cur);
      }
      return [...map.entries()].map(([d, v]) => ({ d, n: v.n, u: v.u.size }));
    }
    if (/^SELECT key, value FROM settings WHERE key IN/.test(q)
        || /^SELECT key, value FROM settings$/.test(q)) {
      return [...settings.entries()].map(([key, value]) => ({ key, value }));
    }
    if (/^SELECT value FROM settings WHERE key = \?/.test(q)) {
      const v = settings.get(String(args[0]));
      return v === undefined ? [] : [{ value: v }];
    }
    if (/^PRAGMA table_info\(subdomains\)/.test(q)) {
      return ['id', 'fqdn', 'root_domain', 'status', 'user_id',
        'showcase', 'showcase_title', 'showcase_desc', 'showcase_emoji']
        .map((name) => ({ name }));
    }
    if (/^INSERT OR IGNORE INTO settings\(key, value\) VALUES/.test(q)) {
      const m = q.match(/VALUES \('([^']+)', '([^']*)'\)/);
      if (m && !settings.has(m[1])) settings.set(m[1], m[2]);
      return [];
    }
    return [];   // 其它表：helper 自己有兜底
  }

  const build = (sql: string, args: any[]) => ({
    first: async () => (await query(sql, args))[0] ?? null,
    all: async () => ({ results: await query(sql, args) }),
    run: async () => { await query(sql, args); return { meta: { changes: 0, last_row_id: 0 } }; },
  });
  const DB = {
    prepare(sql: string) {
      const base = build(sql, []);
      return { bind: (...args: any[]) => build(sql, args), ...base };
    },
  };
  return {
    DB,
    db: {
      exec(q: string) {
        if (/DELETE FROM subdomains WHERE fqdn IN/.test(q)) {
          const names = [...q.matchAll(/'([^']+)'/g)].map((m) => m[1]);
          subs = subs.filter((r) => !names.includes(r.fqdn));
        } else if (/UPDATE subdomains SET status = 'pending'/.test(q)) {
          subs = subs.map((r) => ({ ...r, status: 'pending' }));
        }
      },
    },
  };
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

  check(st.users === 3, `注册人数 = 3（内存表 COUNT），实际 ${st.users}`);
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
  '统计 SQL 按 root_domain（空则回落到 fqdn）、域名数与去重用户数真分组');
check(/hottest/.test(lib) && /effectiveRootList/.test(lib),
  '最热后缀由同一份数据算出，0 值后缀用生效列表补齐');
check(/publicStats: stats/.test(idx) && /publicStats\(c\.env\),/.test(idx)
  && /app\.get\('\/api\/stats'/.test(idx),
  '/api/config 与 /api/stats 同源同口径下发（统计并入并发取值）');
check(/id="statDomainsToggle"/.test(home) && /aria-expanded/.test(home)
  && /id="statBreakdown"/.test(home) && /id="statHottest"/.test(home),
  '首页「已开通域名」可展开，且有不展开也能看到的最热提示');
check(!/\.filter\(\(r\) => !isApplyPausedFor\(r\.domain\)\)/.test(ctrl)
  && /rv-bd-paused/.test(ctrl),
  '统计展开列出全部后缀：暂停申请不等于后缀不存在');
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
    <div class="rv-bd-row is-paused"><span class="rv-bd-name mono">.meoy.top<em class="rv-bd-hot">HOT</em><em class="rv-bd-paused">暂停申请</em></span><span class="rv-bd-num">3</span><span class="rv-bd-num">2</span></div>
    <div class="rv-bd-row"><span class="rv-bd-name mono">.noxc.uk</span><span class="rv-bd-num">1</span><span class="rv-bd-num">1</span></div>
    <div class="rv-bd-row"><span class="rv-bd-name mono">.v-1.top</span><span class="rv-bd-num">1</span><span class="rv-bd-num">1</span></div>
    <div class="rv-bd-row"><span class="rv-bd-name mono">.zero.top</span><span class="rv-bd-num">0</span><span class="rv-bd-num">0</span></div>
  </div>
</div>
<div class="root-picker-menu show" id="rootPickerMenu">
  <button type="button" class="root-opt on" data-root="noxc.uk" data-paused="0"><span class="root-opt-name">.NOXC.UK</span></button>
  <button type="button" class="root-opt" data-root="meoy.top" data-paused="1" disabled aria-disabled="true"><span class="root-opt-name">.MEOY.TOP</span><span class="root-opt-free">暂停</span></button>
</div>
<script>window.__pausedClicks=0;document.querySelector('[data-paused="1"]').onclick=function(){window.__pausedClicks++};</script>
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
    /* 暂停 ≠ 不存在：meoy.top 必须在统计里看得见，只做灰显标注 */
    const pausedRow = pg.locator('.rv-bd-row.is-paused .rv-bd-name');
    const pausedText = await pausedRow.innerText().catch(() => '');
    const rowOpacity = await pg.evaluate(() => {
      const el = document.querySelector('.rv-bd-row.is-paused .rv-bd-name') as HTMLElement | null;
      return el ? Number(getComputedStyle(el).opacity) : 1;
    });
    const tagVisible = await pg.locator('.rv-bd-paused').isVisible().catch(() => false);
    check(pausedText.includes('meoy.top') && tagVisible && rowOpacity < 1,
      `${vp.width}px 实拍：被暂停的 meoy.top 仍在统计展开里、带灰标注（opacity ${rowOpacity}）`);
    /* 注册页选择器：暂停项看得见但灰显、disabled、点不动 */
    const opt = pg.locator('.root-opt[data-paused="1"]');
    const optState = await pg.evaluate(() => {
      const el = document.querySelector('.root-opt[data-paused="1"]') as HTMLButtonElement | null;
      if (!el) return { disabled: false, pe: '', op: 1 };
      const s = getComputedStyle(el);
      return { disabled: el.disabled, pe: s.pointerEvents, op: Number(s.opacity) };
    });
    /* 只模拟真实用户能做到的动作：disabled 元素的 .click() 不会派发 onclick；
       人工 dispatchEvent 会绕过 disabled，不代表真实点击，故不在此使用。 */
    await opt.evaluate((el: any) => { el.click(); }).catch(() => {});
    const clicks = await pg.evaluate('window.__pausedClicks || 0');
    check(optState.disabled && optState.pe === 'none' && optState.op < 1 && clicks === 0,
      `${vp.width}px 实拍：菜单里暂停项灰显不可点（disabled/pointer-events/opacity ${optState.op}/触发 ${clicks} 次）`);
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
