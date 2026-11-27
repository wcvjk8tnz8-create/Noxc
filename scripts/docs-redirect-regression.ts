/**
 * /docs 重定向循环专项回归（CI 步骤：服务文档重定向循环回归）
 *
 * 真实故障：/docs 改 VitePress 后，Safari 报「太多重新导向」。
 *   Worker 把 /docs 内部改写成 /docs/index.html → Cloudflare ASSETS 的
 *   html_handling 规范化 301 到 /docs/ → 浏览器请求 /docs/ → Worker 把
 *   尾斜杠去掉又变成 /docs → 再改写 /docs/index.html → 无限循环。
 *
 * 修法：docsAsset() 在 Worker 内部跟随 ASSETS 的 3xx，只把最终 200/404
 * 返回浏览器；记录访问过的 path，自指循环立即停下并回 404，绝不外吐 3xx。
 *
 * 覆盖：
 *   A. 真跑 Hono + 模拟 ASSETS 规范化，验证 /docs、/docs/、/docs/* 全部
 *      返回 200/404，且响应里绝不出现 3xx（浏览器侧零重定向）
 *   B. 旧链接 /docs/dnshe 也零重定向拿到 DNSHE 章节
 *   C. ASSETS 自指死循环时回 404 而不是把 3xx 抛给浏览器
 *   D. 反向对照：把旧写法（直接 ASSETS.fetch('/docs/index.html') 外吐 3xx）
 *      跑一遍，确实会产生浏览器可见的 301，证明检测不是恒真
 *
 * 运行：npx tsx scripts/docs-redirect-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import app from '../src/index.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

const DOCS_HTML = '<!doctype html><html><body><div id="app">VITEPRESS_DOCS</div></body></html>';
const DNSHE_HTML = '<!doctype html><html><body><div id="app">VITEPRESS_DOCS</div><h2>DNSHE 托管接入</h2><p>Add DNS records</p></body></html>';

/** 模拟 Cloudflare Workers Assets 的 html_handling（auto-trailing-slash） */
function makeEnv(mode: 'normal' | 'loop' = 'normal') {
  const calls: string[] = [];
  const ASSETS = {
    async fetch(req: Request) {
      const u = new URL(req.url);
      const p = u.pathname;
      calls.push(p);

      if (mode === 'loop') {
        // 病态 ASSETS：/docs/ 与 /docs 互相 301，制造内部自指
        if (p === '/docs/') return new Response('', { status: 301, headers: { location: '/docs' } });
        if (p === '/docs') return new Response('', { status: 301, headers: { location: '/docs/' } });
        return new Response('', { status: 404 });
      }

      if (p === '/docs/index.html') return new Response('', { status: 301, headers: { location: '/docs/' } });
      if (p.startsWith('/docs/') && p.endsWith('index.html')) {
        // 目录 index：/docs/en/index.html → /docs/en/
        return new Response('', { status: 301, headers: { location: p.slice(0, -'index.html'.length) } });
      }
      if (p.startsWith('/docs/') && p.endsWith('.html')) {
        return new Response('', { status: 301, headers: { location: p.slice(0, -5) } });
      }
      if (p === '/docs/' || /^\/docs\/(en\/)?[a-z-]*$/.test(p)) {
        const body = p.includes('dnshe') ? DNSHE_HTML : DOCS_HTML;
        return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (p === '/' || p === '/index.html') {
        return new Response('<!doctype html><div id="root">INDEX_SHELL</div>', {
          status: 200, headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('', { status: 404 });
    },
  };
  return {
    DB: {
      prepare() {
        const q = () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) });
        return { bind: q, ...q() };
      },
    },
    ROOT_DOMAIN: 'meoy.top',
    ALLOW_SIGNUP: '1',
    ASSETS,
    calls,
  } as any;
}

const CTX: any = { waitUntil() {}, passThroughOnException() {} };
async function hit(p: string, mode: 'normal' | 'loop' = 'normal') {
  const env = makeEnv(mode);
  const res = await app.fetch(new Request('https://nic.test' + p, { method: 'GET' }), env, CTX);
  return {
    status: res.status,
    location: res.headers.get('location'),
    text: await res.text(),
    calls: env.calls as string[],
  };
}

/* ───────────────── A. 浏览器侧零重定向 ───────────────── */
for (const p of ['/docs', '/docs/', '/docs/quick-start.html', '/docs/en/index.html', '/docs/dnshe.html',
  '/docs/external-domains.html', '/docs/en/external-domains.html']) {
  const r = await hit(p);
  check(r.status === 200 && r.text.includes('VITEPRESS_DOCS') && !r.location,
    `${p} → 200 且无 Location 头（浏览器零重定向）`);
  check(r.calls.length >= 1 && !r.calls.includes('/docs/index.html'),
    `${p} 不再由 Worker 显式改写 /docs/index.html（避开自指循环）`);
}

/* ───────────────── B. 旧书签 ───────────────── */
{
  const r = await hit('/docs/dnshe');
  check(r.status === 200 && r.text.includes('DNSHE 托管接入') && r.text.includes('Add DNS records'),
    '/docs/dnshe 旧书签内部消化后直接拿到 DNSHE 章节');
  check(!r.location, '/docs/dnshe 不向浏览器抛 3xx（旧写法会与 ASSETS 规范化打架）');
  const r2 = await hit('/docs.html');
  check(r2.status === 302 && r2.location === '/docs/',
    '/docs.html 老书签只 302 一次到 /docs/');
}

/* ───────────────── C. ASSETS 病态自指不外吐 3xx ───────────────── */
{
  const r = await hit('/docs', 'loop');
  check(r.status === 404 && !r.location,
    'ASSETS 自指死循环时回 404，绝不把 3xx 抛给浏览器（Safari 不会再报太多重新导向）');
  check(r.calls.length <= 5, `内部跟随次数有上限（实际 ${r.calls.length} 次），不会打爆 isolate`);
}

/* ───────────────── D. 反向对照：旧写法确实会循环 ───────────────── */
{
  // 复现修复前的处理：把 /docs 改成 /docs/index.html 直接外吐 ASSETS 响应
  const env = makeEnv('normal');
  const raw = await env.ASSETS.fetch(new Request('https://nic.test/docs/index.html'));
  check(raw.status === 301 && raw.headers.get('location') === '/docs/',
    '反向对照：旧写法拿到的正是 301 → /docs/（浏览器下一轮又回 Worker，形成循环）');
  // 浏览器再请求 /docs/，Worker 的 path 去掉尾斜杠又变 /docs
  const browserSecond = new URL('https://nic.test/docs/').pathname.replace(/\/+$/, '') || '/';
  check(browserSecond === '/docs',
    '反向对照：/docs/ 进 Worker 后 path 又被规范化成 /docs，闭环成立');
}

/* ───────────────── E. 源码防回流断言 ───────────────── */
const idx = read('src/index.ts');
const hc = read('scripts/health-check.ts');
const ci = read('.github/workflows/deploy.yml');
check(/async function docsAsset\(c: any, startPath: string\)/.test(idx)
  && /seen\.has\(key\)/.test(idx) && /返回 404|redirect loop/.test(idx),
  'index.ts 有 docsAsset 内部跟随 + 自指检测 + 不外吐 3xx');
check(!/new URL\('\/docs\/index\.html', c\.req\.url\)/.test(idx),
  '旧的「/docs 显式改写 index.html」写法已删除');
check(/docsAsset\(c, '\/docs\/'\)/.test(idx) && /docsAsset\(c, reqUrl\.pathname\)/.test(idx),
  '/docs 与 /docs/* 统一走内部消化');
check(/服务文档重定向循环回归/.test(ci) && /docs-redirect-regression\.ts/.test(ci),
  '专项回归进 CI');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`服务文档重定向循环回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
