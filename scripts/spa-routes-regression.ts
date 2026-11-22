/**
 * SPA 直达路径回归（CI 步骤：SPA 直达回落回归）
 *
 * 复现的线上问题：举报滥用页整页白屏。
 *   前端 App.tsx 的 ROUTES 有 /report /abuse，但 Worker 的 SPA_PATHS 是
 *   另一份手写清单，漏了这两个；直接打开 / 刷新 / 从根域名落地页外链跳过去时，
 *   Worker 把 /report 原样交给 ASSETS → 静态资源里没这个文件 → 404 空 body
 *   → Safari 显示一片白。站内点链接由 React 接管，所以只有直达才暴露。
 *
 * 覆盖：
 *   A. 解析 App.tsx 的 ROUTES，逐个断言都在 spaFallbackPaths() 里（防漂移）
 *   B. 真跑 Hono + 内存 D1 + mock ASSETS，验证 /report、/abuse 及其 .html /
 *      带查询串变体确实被回落到 /（index.html），未知路径仍原样交给 ASSETS
 *   C. /docs 仍由模板直出，不被回落吞掉
 *   D. 反向对照：拿掉 'report' 后回落清单必须不再含 /report（证明检测有效）
 *
 * 运行：npx tsx scripts/spa-routes-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import app from '../src/index.js';
import { SPA_PAGE_NAMES, spaFallbackPaths } from '../src/lib/spaRoutes.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────────────── A. 前端路由表 ⊆ 回落清单 ───────────────── */
const appSrc = read('src/app/App.tsx');
const idxSrc = read('src/index.ts');
const routeBlock = appSrc.split('const ROUTES')[1].split('};')[0];
const routes = Array.from(routeBlock.matchAll(/'(\/[^']+)'\s*:/g)).map((m) => m[1]);
const fallbacks = spaFallbackPaths();

check(routes.length >= 30, `解析到前端 ROUTES ${routes.length} 条（防止正则失效后空跑）`);
check(fallbacks.includes('/report') && fallbacks.includes('/report.html')
  && fallbacks.includes('/abuse') && fallbacks.includes('/abuse.html'),
  '回落清单含 /report /abuse 及其 .html 变体（本次白屏根因）');
const uncovered = routes.filter((r) => !fallbacks.includes(r));
check(uncovered.length === 0, `App.tsx 的 ${routes.length} 个直达路径全部被回落清单覆盖${uncovered.length ? '，缺：' + uncovered.join(', ') : ''}`);
check(/const SPA_PATHS = new Set\(spaFallbackPaths\(\)\)/.test(idxSrc)
  && !/new Set\(\[\s*'\/',\s*'\/index\.html'/.test(idxSrc),
  'Worker 使用唯一来源生成回落清单，不再手写第二份');
check(/import \{ spaFallbackPaths \} from '\.\/lib\/spaRoutes\.js'/.test(idxSrc),
  'index.ts 正确引入 spaRoutes');

/* 反向对照：证明「前端 ROUTES ⊆ 回落清单」这条检测不是恒真 */
const withoutReport = SPA_PAGE_NAMES.filter((n) => n !== 'report');
const stubPaths = ['/', '/index.html', ...withoutReport.flatMap((n) => ['/' + n, '/' + n + '.html'])];
check(!stubPaths.includes('/report') && stubPaths.includes('/abuse'),
  '反向对照：移除 report 后清单不含 /report，但 abuse 仍在');
check(routes.filter((r) => !stubPaths.includes(r)).includes('/report'),
  '反向对照：此时前端 ROUTES 的 /report 会被判为未覆盖（检测确实有效）');
check(fallbacks.includes('/report'), '现行清单含 /report（对照组：拿掉就会漏）');

/* ───────────────── B/C. 真跑 Hono ───────────────── */
function makeEnv() {
  const assetsCalls: string[] = [];
  const exec = (sql: string, args: any[]) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    // 内存库只有空 settings；其余查询一律空结果，走代码里的默认值 / catch 分支
    if (/^SELECT key, value FROM settings/.test(s)) return [];
    if (/^SELECT value FROM settings/.test(s)) return [];
    if (/^PRAGMA/.test(s)) return [];
    return [];
  };
  const wrap = (sql: string, args: any[]) => ({
    first: async () => exec(sql, args)[0] ?? null,
    all: async () => ({ results: exec(sql, args) }),
    run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
  });
  const DB = {
    prepare(sql: string) {
      const self = wrap(sql, []);
      return { bind(...args: any[]) { return wrap(sql, args); }, first: self.first, all: self.all, run: self.run };
    },
  };
  return {
    DB,
    ROOT_DOMAIN: 'meoy.top',
    ALLOW_SIGNUP: '1',
    ASSETS: {
      async fetch(req: Request) {
        const u = new URL(req.url);
        assetsCalls.push(u.pathname + u.search);
        if (u.pathname === '/' || u.pathname === '/index.html') {
          return new Response('<!doctype html><html><body><div id="root">INDEX_SHELL</div></body></html>', {
            status: 200, headers: { 'content-type': 'text/html' },
          });
        }
        // 模拟 Cloudflare Assets 的 html_handling 规范化：
        // /docs/index.html → 301 /docs/，/docs/x.html → 301 /docs/x
        if (u.pathname === '/docs/index.html') {
          return new Response('', { status: 301, headers: { location: '/docs/' } });
        }
        if (u.pathname.endsWith('.html') && u.pathname.startsWith('/docs/')) {
          return new Response('', { status: 301, headers: { location: u.pathname.slice(0, -5) } });
        }
        if (u.pathname === '/docs/' || /^\/docs\/[a-z-]+$/.test(u.pathname)) {
          return new Response('<!doctype html><html><body><div id="app">VITEPRESS_DOCS</div><h1>Noxc 服务文档</h1></body></html>', {
            status: 200, headers: { 'content-type': 'text/html' },
          });
        }
        return new Response('', { status: 404 });
      },
    },
    assetsCalls,
  } as any;
}

const CTX: any = { waitUntil() {}, passThroughOnException() {} };
async function hit(p: string) {
  const env = makeEnv();
  const res = await app.fetch(new Request('https://nic.test' + p, { method: 'GET' }), env, CTX);
  return { status: res.status, text: await res.text(), calls: env.assetsCalls as string[] };
}

for (const p of ['/report', '/report.html', '/abuse', '/abuse.html', '/report?domain=bad.meoy.top', '/abuse?domain=x']) {
  const r = await hit(p);
  const fellBack = r.calls.length === 1 && r.calls[0] === '/';
  check(r.status === 200 && r.text.includes('INDEX_SHELL') && fellBack,
    `${p} 直达 → 回落 index.html（不再 404 白屏）`);
}

/* 其它已知 SPA 页仍正常回落，防止改成「所有路径都回首页」 */
for (const p of ['/login', '/whois.html', '/showcase']) {
  const r = await hit(p);
  check(r.status === 200 && r.text.includes('INDEX_SHELL'), `${p} 仍正常回落`);
}

/* 未知路径 / 静态资源：原样交给 ASSETS，不误伤 404 语义 */
for (const p of ['/definitely-not-a-page', '/img/logo.jpg', '/assets/x.js']) {
  const r = await hit(p);
  check(r.status === 404 && r.calls[0] === p,
    `${p} 原样交给 ASSETS（回落清单没有放宽成通配）`);
}

/* /docs 由 VitePress 静态产物提供。ASSETS 会把 /docs/index.html 与
   /*.html 规范化成 301，docsAsset() 在 Worker 内部消化，浏览器零重定向。 */
{
  const r = await hit('/docs');
  check(r.status === 200 && r.text.includes('VITEPRESS_DOCS') &&
    !r.text.includes('redirect') && r.calls[0] === '/docs/',
    '/docs 直达 → 200（ASSETS 规范化 3xx 被内部消化，不外吐重定向）');
  const r2 = await hit('/docs/');
  check(r2.status === 200 && r2.text.includes('VITEPRESS_DOCS'),
    '/docs/ 直达同样 200');
  const r3 = await hit('/docs/quick-start.html');
  check(r3.status === 200 && r3.calls.length >= 2 && r3.calls[1] === '/docs/quick-start',
    '/docs/* 的 .html 规范化 301 在内部跟随，子页正常 200');
  const r4 = await hit('/docs.html');
  check(r4.status === 302, '/docs.html 老书签 302 到 /docs/');
}

/* 根路径在普通主机上走 SPA 首页；根域名落地页只在特定 Host 直出 */
{
  const env = makeEnv();
  const res = await app.fetch(new Request('https://nic.test/', { method: 'GET' }), env, CTX);
  const t = await res.text();
  check(res.status === 200 && t.includes('INDEX_SHELL'), '普通主机 / 仍回落到 SPA 首页');
}

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`SPA 直达回落回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
