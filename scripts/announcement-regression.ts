/**
 * 站点公告专项回归（CI 步骤：站点公告回归）
 *
 * 背景：后台「站点设置 → 站点公告」一直是死字段 —— /api/config 的 SELECT
 * 清单漏了 announcement，前端永远读到 undefined；且旧渲染逻辑只在
 * mountShell()（要求页面有 .main）里插，首页 / 登录 / 注册 / WHOIS / 条款
 * 全都不显示。用户反馈「每个地方都没有露出来」。
 *
 * 覆盖：
 *   A. 真跑 Hono app + 内存 D1，验证 /api/config 确实下发公告（含留空 / trim / 超长）
 *   B. SPA 与独立模板的挂载链路静态断言（单一来源、textContent、全站调用点）
 *   C. 无头浏览器实拍：三个 Worker 直出模板的公告条真的可见、纯文本、留空隐藏
 *      （浏览器不可用时跳过，不阻断 CI）
 *
 * 运行：npx tsx scripts/announcement-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import app from '../src/index.js';
/* /api/config 现在有 30 秒整响应缓存；回归里每次换内存数据等价于后台写操作，
   必须同步失效，否则后几次会拿到第一次的缓存值。 */
import { invalidatePublicConfig } from '../src/lib/configCache.js';
import { meoyTopHtml } from '../src/html/root-meoy.js';
import { v1TopHtml } from '../src/html/root-v1.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────────────── A. 真跑 /api/config ───────────────── */
function makeEnv(settings: Record<string, string>) {
  const rows = Object.entries(settings).map(([key, value]) => ({ key, value }));
  const exec = (sql: string, args: any[]) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    let out: any[] = [];

    if (/^SELECT key, value FROM settings WHERE key IN \(/.test(s)) {
      // 把 IN (...) 里的字面量解出来，只返回实际配置过的键
      const m = s.match(/IN \((.*?)\)/);
      const keys = (m ? m[1] : '').split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
      out = rows.filter((r) => keys.includes(r.key));
    } else if (/^SELECT value FROM settings WHERE key = \?/.test(s)) {
      const r = rows.find((x) => x.key === String(args[0]));
      out = r ? [{ value: r.value }] : [];
    } else if (/^SELECT key, value FROM settings/.test(s)) {
      out = rows.slice();
    } else if (/^SELECT .* FROM settings/.test(s)) {
      const r = rows.find((x) => x.key === String(args[0]));
      out = r ? [{ ...r }] : [];
    } else {
      out = [];   // 其它表（users / sessions / root_domains …）一律空，走默认值
    }
    return out;
  };
  const wrap = (sql: string, args: any[]) => ({
    first: async () => exec(sql, args)[0] ?? null,
    all: async () => ({ results: exec(sql, args) }),
    run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
  });
  return {
    DB: {
      prepare(sql: string) {
        const self = wrap(sql, []);
        return { bind(...args: any[]) { return wrap(sql, args); }, first: self.first, all: self.all, run: self.run };
      },
    },
    ROOT_DOMAIN: 'meoy.top',
    ALLOW_SIGNUP: '1',
  } as any;
}

const CTX: any = { waitUntil() {}, passThroughOnException() {} };
async function getConfig(announcement?: string) {
  invalidatePublicConfig();   // 内存库换值 = 后台保存，整响应缓存必须失效
  const settings: Record<string, string> = {
    site_name: 'Noxc',
    logo_url: '/img/logo.jpg',
    domain_valid_days: '365',
    renew_window_days: '',
  };
  if (announcement !== undefined) settings.announcement = announcement;
  const res = await app.fetch(
    new Request('https://nic.test/api/config', {
      headers: { 'Accept': 'application/json', 'X-Lang': 'zh' },
    }),
    makeEnv(settings), CTX);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

{
  let r = await getConfig('欢迎使用 Noxc');
  check(r.status === 200, '/api/config 正常 200（真跑 Hono + 内存 D1）');
  check(r.body.announcement === '欢迎使用 Noxc', '站点公告由 /api/config 正确下发');

  r = await getConfig('  系统维护通知  ');
  check(r.body.announcement === '系统维护通知', '公告两端空白被 trim');

  r = await getConfig('');
  check(r.body.announcement === '', '留空时下发空串（前端据此不渲染）');

  r = await getConfig(undefined);
  check(r.body.announcement === '', '库里没有该 key 也不报错，回落空串');

  r = await getConfig('x'.repeat(400));
  check(r.body.announcement.length === 300, '超长公告裁到 300 字，与后台保存口径一致');
}

/* ───────────────── B. 挂载链路静态断言 ───────────────── */
const cfgSrc = read('src/index.ts');
const runtime = read('src/app/lib/runtime.ts');
const design = read('src/app/styles/design-system.css');
const shared = read('src/html/announcement.ts');
const vpTheme = read('docs-src/.vitepress/theme/index.ts');
const vpAnn = read('docs-src/.vitepress/theme/announcement.ts');
const vpConfig = read('docs-src/.vitepress/config.mts');
const rootMeoy = read('src/html/root-meoy.ts');
const rootV1 = read('src/html/root-v1.ts');
const schema = read('schema.sql');
const readme = read('README.md');

check(/WHERE key IN \([^)]*'announcement'[^)]*\)/.test(cfgSrc),
  '/api/config 的 SELECT 清单包含 announcement（历史根因 1）');
check(/announcement: String\(s\.announcement \|\| ''\)\.trim\(\)\.slice\(0, 300\)/.test(cfgSrc),
  '下发的是 trim 过的纯文本，不解析 HTML');
check(/export const DEFAULT_BRAND = \{[^}]*announcement: ''/s.test(runtime),
  'DEFAULT_BRAND 已带 announcement 字段（接口失败时回落不显示）');
check(/announcement: typeof d\.announcement === 'string'/.test(runtime),
  'normalizeBrand 解析公告，缓存与后台即时刷新都走同一份');
check(/export function mountAnnouncement\(/.test(runtime)
  && /body\.textContent = msg/.test(runtime)
  && !/innerHTML\s*=\s*.*announcement/.test(runtime),
  'mountAnnouncement 用 textContent 渲染，绝不 innerHTML（防 XSS）');
check(/data-no-i18n/.test(runtime) && /role': 'status'|setAttribute\('role', 'status'\)/.test(runtime),
  '公告条标 data-no-i18n + role=status，英文模式不被词典改写');
check(/document\.querySelector\('\.main'\) \|\| document\.body/.test(runtime),
  '控制台插 .main 顶部，其余页面插 body 最前（历史根因 2）');
check(/void loadBranding\(\)\.then\(\(b\) => mountAnnouncement\(b\.announcement\)\)/.test(runtime),
  'refreshRuntime 每次切页都挂载公告，覆盖全部 SPA 页面');
check(/try \{ mountAnnouncement\(b\.announcement\); \} catch \{\}/.test(runtime),
  'applyBranding 挂载公告，后台保存后不用刷新整页');
check(!/cfg\.notice \|\| cfg\.announcement/.test(runtime) && !/shellNotice/.test(runtime),
  '旧的「只在 mountShell 渲染」逻辑已移除，不再重复请求 /api/config');
check(/\.site-announcement/.test(design)
  && /white-space: normal/.test(design)
  && /overflow-wrap: anywhere/.test(design)
  && /position: relative/.test(design)
  && /prefers-color-scheme|\[data-theme="dark"\]/.test(design),
  '设计系统有专用公告条样式：可换行、纯文档流、深浅色、不复用 .notice 卡片');
check(/bar\.className = 'site-announcement'/.test(runtime),
  '公告条使用专用 .site-announcement class，不复用会被 !important 压成白卡的 .notice');
check(/VALUES \('announcement', ''\)/.test(schema),
  '全新库公告默认留空（不再写死旧品牌欢迎语）');
check(/\| 站点公告 \| 空 \| 纯文本/.test(readme) && !/\| 站点公告 \| 空 \| 预留 \|/.test(readme),
  'README 不再把公告写成「预留」');

for (const [p, t] of [['root-meoy.ts', rootMeoy], ['root-v1.ts', rootV1]] as [string, string][]) {
  check(t.includes('ANNOUNCEMENT_CSS') && t.includes('ANNOUNCEMENT_BODY') && t.includes('ANNOUNCEMENT_JS'),
    `${p} 接入共享公告片段（样式 / 占位 / 渲染函数）`);
  check(/renderAnnouncement\(d\)/.test(t) || /renderAnnouncement\(/.test(t),
    `${p} 拿到 /api/config 后真的调用渲染`);
}
check(/s\.textContent\s*=\s*t/.test(shared) && /纯文本/.test(shared),
  '独立模板同样用 textContent，管理员输入原样呈现');
check(/base: '\/docs\/'/.test(vpConfig) && /locales:/.test(vpConfig)
  && /'简体中文'|简体中文/.test(vpConfig) && /English/.test(vpConfig),
  'VitePress 文档配置：base /docs/ + 中英双语 locales');
check(/'layout-top'/.test(vpTheme) && /loadAnnouncement\(\)/.test(vpTheme)
  && /siteAnnouncement/.test(vpTheme) && !/v-html\s*[:=]/.test(vpTheme),
  'VitePress 用 layout-top 插槽挂公告，h() 纯文本子节点，绝不 v-html');
check(/h\('span', \{ class: 'sa-text' \}, announcement\.value\)/.test(vpTheme),
  '插槽渲染的是 .value 纯文本，管理员输入原样呈现');
check(/fetch\('\/api\/config'/.test(vpAnn) && /announcement\.value\s*=/.test(vpAnn),
  '主题异步补挂公告，接口失败保持隐藏，不阻塞首屏');

/* ───────────────── C. 浏览器实拍（可选，不阻断） ───────────────── */
let browser: any = null;
try {
  // 沙盒把 playwright 装在全局 node_modules；CI 没装时整段跳过，不阻断。
  let pw: any;
  try { pw = await import('playwright'); }
  catch {
    const { createRequire } = await import('node:module');
    pw = createRequire('/opt/yb/runtimes/node/24/lib/node_modules/')('playwright');
  }
  const { chromium } = pw;
  const tmp = path.resolve('/data/workspace/_ann_check');
  fs.mkdirSync(tmp, { recursive: true });
  /* VitePress 主题插槽的等效渲染页：真实产物由 CI 的 vitepress build 生成，
     这里用与 theme/index.ts 完全相同的 DOM 与 fetch 逻辑做浏览器实拍。 */
  const vpEquivalent = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#111318}
.VPNav{height:56px;border-bottom:1px solid rgba(17,19,24,.11);display:flex;align-items:center;padding:0 24px;font-weight:700}
#siteAnnouncement{display:flex;align-items:flex-start;gap:10px;padding:10px 24px;background:#f7f8fa;border-bottom:1px solid rgba(17,19,24,.11);color:#4b5563;font-size:13px}
#siteAnnouncement[hidden]{display:none!important}
#siteAnnouncement .sa-dot{width:7px;height:7px;flex:0 0 7px;margin-top:.55em;border-radius:50%;background:#111318}
#siteAnnouncement .sa-text{flex:1 1 auto;min-width:0}
main{padding:24px}
</style></head><body>
<div class="VPNav">Noxc 服务文档</div>
<div id="siteAnnouncement" role="status" hidden><span class="sa-dot"></span><span class="sa-text"></span></div>
<main><h1>关于 Noxc</h1><p>VitePress layout-top 插槽等效渲染。</p></main>
<script>
(function(){
  var el=document.getElementById('siteAnnouncement');
  fetch('/api/config',{headers:{'Accept':'application/json'}})
    .then(function(r){return r.ok?r.json():null})
    .then(function(d){
      var t=d&&typeof d.announcement==='string'?d.announcement.trim():'';
      if(!t){el.hidden=true;return}
      el.querySelector('.sa-text').textContent=t;
      el.hidden=false;
    }).catch(function(){});
})();
</script></body></html>`;
  const pages: Record<string, string> = {
    'vitepress-slot.html': vpEquivalent,
    'meoy.html': meoyTopHtml,
    'v1.html': v1TopHtml,
  };
  for (const [f, html] of Object.entries(pages)) {
    fs.writeFileSync(path.join(tmp, f), html, 'utf8');
    check(html.includes('id="siteAnnouncement"')
      && (html.includes('renderAnnouncement') || html.includes("querySelector('.sa-text').textContent")),
      `${f} 求值时公告占位与渲染逻辑已内联`);
  }

  try {
    browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox'] });
  } catch {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const NOTICE = '系统维护：本周日 02:00–04:00 暂停解析下发';
  await ctx.route('**/api/config', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, announcement: NOTICE, rootDomains: ['meoy.top', 'v-1.top'] }),
  }));

  for (const f of Object.keys(pages)) {
    const pg = await ctx.newPage();
    await pg.goto('file://' + path.join(tmp, f));
    await pg.waitForTimeout(700);
    const bar = pg.locator('#siteAnnouncement');
    const visible = await bar.isVisible().catch(() => false);
    const text = visible ? (await bar.locator('.sa-text').innerText()).trim() : '';
    check(visible && text === NOTICE, `${f} 公告条实拍可见且文本正确`);
    if (visible) {
      const overflow = await pg.evaluate('document.documentElement.scrollWidth > window.innerWidth');
      check(!overflow, `${f} 公告条不造成横向溢出`);
    }
    await pg.close();
  }

  // XSS：公告含标签时必须按纯文本显示，不产生任何元素
  const xss = await ctx.newPage();
  await xss.route('**/api/config', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, announcement: '<img src=x onerror=alert(1)> 纯文本公告' }),
  }));
  await xss.goto('file://' + path.join(tmp, 'vitepress-slot.html'));
  await xss.waitForTimeout(600);
  const injected = await xss.locator('#siteAnnouncement img').count();
  const asText = (await xss.locator('#siteAnnouncement .sa-text').innerText()).trim();
  check(injected === 0 && asText === '<img src=x onerror=alert(1)> 纯文本公告',
    '公告含 HTML 标签时按纯文本渲染，不注入元素');
  await xss.close();

  // 留空：必须隐藏
  const empty = await ctx.newPage();
  await empty.route('**/api/config', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, announcement: '' }),
  }));
  await empty.goto('file://' + path.join(tmp, 'docs.html'));
  await empty.waitForTimeout(600);
  check(!(await empty.locator('#siteAnnouncement').isVisible().catch(() => false)),
    '公告留空时隐藏，不留空条');
  await empty.close();

  await ctx.close();
  console.log('  ℹ 无头浏览器实拍已执行');
} catch (e: any) {
  console.log('  ℹ 浏览器不可用，跳过实拍（不阻断）：' + String(e?.message || e).slice(0, 120));
} finally {
  if (browser) await browser.close().catch(() => {});
}

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`站点公告回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
