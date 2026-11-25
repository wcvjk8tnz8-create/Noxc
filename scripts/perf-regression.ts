/**
 * 响应速度优化 / 过渡动画移除专项回归
 *
 * 背景：有人反馈站内切换慢。旧的 Miku 切页过渡会把导航延后
 *   NAV_HOLD_MIN 200ms + MIN_VISIBLE 360ms，慢接口最多再等 1400ms，
 *   首屏还要 preload 4 张图、预热/解码 3 张壁纸、整页藏到 2.5s 就绪。
 *
 * 本回归两层：
 *   A. 真跑 src/app/lib/prefetch.ts：验证「立即换页」后在飞的预取能被
 *      api.get 复用，零重复请求（这是拆掉过渡后不退化的数据层保障）
 *   B. 静态断言：过渡模块 / DOM / CSS / 静态页副本全部移除、点击立即
 *      navigate、首屏预载收紧、整屏等待收紧、/api/config 并发、静态资源缓存、
 *      以及「默认关闭装饰动效」（社区反馈动画太多）
 *
 * 运行：npx tsx scripts/perf-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');
const exists = (p: string) => fs.existsSync(path.resolve(p));

async function main() {
  /* ═════════ A. 真跑预取：立即换页后零重复请求 ═════════ */
  const calls: string[] = [];
  let replyOk = true;
  (globalThis as any).document = { documentElement: { getAttribute: () => 'zh' } };
  (globalThis as any).location = { href: 'https://nic.test/' };
  (globalThis as any).fetch = (p: string) => {
    calls.push(p);
    return new Promise((resolve) => setTimeout(() => resolve({
      json: () => Promise.resolve(replyOk ? { success: true, from: 'prefetch', path: p } : { success: false }),
    }), 15));
  };
  const prefetch = await import('../src/app/lib/prefetch.js');

  {
    prefetch.invalidatePrefetch();
    calls.length = 0; replyOk = true;
    const all = prefetch.prefetchRoute('/dashboard');
    check(calls.length === 5,
      `点 /dashboard 瞬间并行发起 5 个首屏 GET（实际 ${calls.length}）`);
    check(prefetch.takePrefetched('/api/config') === null,
      '在飞的预取不会被 takePrefetched 提前丢弃（旧实现会删条目）');
    const inflight = prefetch.waitPrefetched('/api/config');
    check(!!inflight && typeof (inflight as any).then === 'function',
      'waitPrefetched 拿到仍在飞的 Promise，api.get 直接等它');
    check(prefetch.waitPrefetched('/api/config') === null,
      '同一条在飞预取只被消费一次');
    const data: any = await inflight;
    check(data && data.success === true && data.path === '/api/config',
      '等到的就是首次请求的结果，没有重发');
    check(calls.length === 5, `立即换页后零重复请求（总请求数仍为 ${calls.length}）`);
    await all;
    check(calls.length === 5, '整条路由预取完成后也没有补偿性重发');
  }
  {
    prefetch.invalidatePrefetch();
    calls.length = 0;
    const all = prefetch.prefetchRoute('/checkin');
    await all;
    const hit = prefetch.takePrefetched('/api/config');
    check(hit && hit.success === true && calls.length === 2,
      '已完成的预取由 takePrefetched 直接消费，命中后不重复发');
  }
  {
    prefetch.invalidatePrefetch();
    replyOk = false;
    const all = prefetch.prefetchRoute('/checkin');
    const inflight = prefetch.waitPrefetched('/api/config');
    const data: any = await inflight;
    check(data && data.success === false,
      '预取失败时 Promise 也结算（api.get 据此走正常请求兜底）');
    await all;
    replyOk = true;
  }

  /* ═════════ B. 静态：过渡彻底移除 ═════════ */
  const mainSrc = read('src/app/main.tsx');
  const appSrc = read('src/app/App.tsx');
  const runtime = read('src/app/lib/runtime.ts');
  const spa = read('src/html/spa.ts');
  const shellCss = read('src/app/styles/shell.css');
  const dsCss = read('src/app/styles/design-system.css');
  const indexSrc = read('src/index.ts');

  check(!exists('src/app/lib/pageTransition.ts'), '切页过渡模块已删除，不再打进前端包');
  check(!/pageTransition|mountTransition|beginTransition|endTransition/.test(mainSrc + appSrc + runtime),
    '入口 / App / runtime 不再引用过渡 API');
  check(/void prefetchRoute\(href\);\s*navigate\(href\)/.test(appSrc),
    '站内链接：并行预取后立即 navigate（省掉旧的 200~1400ms 延后）');
  check(!/useRef\(key\)|prevKey/.test(appSrc), 'App 不再有过渡驱动的路由 key 比对');
  check(!/miku-pop|tdTransition|td-trans/.test(spa + shellCss + dsCss),
    'HTML 壳与 CSS 里不再有过渡角色 / 遮罩样式');
  /* 「纯白不闷」的 hover 微动效放在形态层，但绝不等于恢复切页延后：
     它只用 transform / opacity，不引入任何导航等待或整屏就绪门。 */
  const fxCss = read('src/app/styles/nodeloc-skin.css');
  check(!/pageTransition|tdTransition|miku-pop|data-ready/.test(fxCss)
    && /8 · 效果层/.test(fxCss),
    '形态层只有 hover / 呼吸微动效，没有切页过渡与整屏就绪门');
  for (const f of ['src/html/root-meoy.ts', 'src/html/root-v1.ts']) {
    const rp = read(f);
    check(!/tdTransition|td-trans|miku-pop|location\.href = url/.test(rp),
      `${path.basename(f)} 不再有过渡层 / 素材预热 / 延后跳转`);
    check(/location\.href = PANEL/.test(rp) && /addEventListener\("submit"/.test(rp),
      `${path.basename(f)} 查询框仍跳 WHOIS，且改为立即跳转（功能不丢）`);
    check((rp.match(/addEventListener\("submit"/g) || []).length === 1,
      `${path.basename(f)} 提交监听合并为一个，不再双重绑定`);
  }

  /* 首屏带宽 / 体积 */
  const preloads = (spa.match(/rel="preload" as="image"/g) || []).length;
  check(preloads === 1 && /miku-bouquet-haze\.webp/.test(spa),
    `首屏图片 preload 从 4 张收到 1 张（实际 ${preloads}）`);
  check(!/WARM_ASSETS|warmAssets|decodeAsset/.test(runtime + mainSrc + appSrc),
    '首屏不再预热 / 解码 3 张壁纸，省下带宽与主线程');
  check(!/tdPageIn/.test(shellCss) && !/tdRevealIn var\(--td-dur-3\)/.test(shellCss),
    '整页淡入与卡片 55ms 阶梯入场动画都已移除');
  check(/\.page-root\[data-ready="1"\] \.main \{\s*opacity: 1 !important/.test(shellCss),
    '就绪后立即显示，不再补 420ms 淡入');

  /* 就绪门控收紧 */
  check(/setTimeout\(r, 800\)/.test(runtime) && !/setTimeout\(r, 2500\)/.test(runtime),
    '整屏隐藏硬兜底从 2500ms 收紧到 800ms');
  check(/}, 1200\);/.test(appSrc) && !/}, 3000\);/.test(appSrc),
    '页面挂载放出兜底从 3000ms 收紧到 1200ms');

  /* 数据层：预取复用 + /api/config 并发 */
  check(/waitPrefetched\(p\)/.test(runtime) && /if \(data && data\.success\) return data/.test(runtime),
    'api.get 复用在飞预取，失败时才兜底重发');
  check(/if \(!e \|\| !e\.ok\) return null/.test(read('src/app/lib/prefetch.ts')),
    'takePrefetched 保留在飞条目，不提前丢弃');
  check(/showcasePts, expiry, quota, stats\] = await Promise\.all\(/.test(indexSrc),
    '/api/config 冷缓存：11 个独立子项并发发起，不再串行累加 RTT');
  check(/max-age=31536000, immutable/.test(read('public/_headers')),
    '带内容 hash 的静态资源 immutable 长缓存');

  /* CI / 文档 */
  check(/perf-regression\.ts/.test(read('.github/workflows/deploy.yml')),
    '性能专项回归挂进 CI');
  check(/过渡动画|移除过渡/.test(read('README.md')), 'README 记录过渡移除与提速口径');

  /* ── 社区反馈「动画效果太多」：默认全停，仍可一键恢复 ── */
  check(/dataset\.motion = 'paused'/.test(mainSrc)
    && /noxc-motion-paused/.test(mainSrc)
    && /!== '0'/.test(mainSrc),
    '入口默认把 documentElement 标成 paused，只有显式恢复才放开');
  check(!/localStorage\.getItem\(MOTION_KEY\) === '1'\) document\.documentElement\.dataset\.motion = 'paused'/.test(
      read('src/app/pages/Home.tsx')),
    '首页不再反向覆盖全局默认，用户「恢复动效」跨页保留');
  check(/dataset\.motion === 'paused'/.test(runtime),
    'JS 数字滚动与 IntersectionObserver 入场也尊重默认暂停');
  check(/8\.5 默认暂停兜底/.test(fxCss)
    && /html\[data-motion="paused"\] body\.page-home \.yn-panel::before/.test(fxCss),
    '形态层高特异性兜底：循环柔光 / 圆点 pulse / hover 过渡全部停掉');

  for (const m of ok) console.log('  ✓ ' + m);
  for (const m of bad) console.error('  ✗ ' + m);
  console.log(`响应速度优化 / 过渡移除回归：${ok.length} 通过，${bad.length} 失败`);
  if (bad.length) process.exit(1);
}

main().catch((e) => { console.error('回归异常:', e); process.exit(1); });
