/**
 * 静态健康巡检：只用 Node 内置模块，不依赖 node_modules。
 * 把历次线上踩过的坑固化成阻断检查，避免「能打包 ≠ 能运行」的问题再回流。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const errors = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : errors.push(msg));

/* 1. 样式层括号必须成对 —— 少一个 } 会让后面整段规则失效 */
const css = [
  'src/app/styles/components.css',
  'src/app/styles/index.css',
  'src/app/styles/responsive.css',
  'src/app/styles/theme-terra.css',
  'src/app/styles/motion.css',
  'src/app/styles/liquid-glass.css',
  'src/app/styles/reverie.css',
];
for (const p of css) {
  const t = read(p);
  const a = (t.match(/\{/g) || []).length, b = (t.match(/\}/g) || []).length;
  check(a === b, `${p} 括号平衡 ${a}/${b}`);
}

/* 2. 词典重复键：对象字面量里同名 key 会让 esbuild 报 duplicate-object-key。
      必须全量扫描 —— 旧版只认行首，漏掉了「一行写好几个键」的写法。 */
const dicts = ['src/app/lib/i18n.ts', 'src/app/lib/dict.en.ts', 'src/lib/i18nServer.ts'];
for (const p of dicts) {
  const t = read(p);
  const keys = [...t.matchAll(/(?:^|,\s*)'([^']+)'\s*:/gm)].map((m) => m[1]);
  const seen = new Set(), dup = new Set();
  for (const k of keys) { if (seen.has(k)) dup.add(k); seen.add(k); }
  check(dup.size === 0, `${p} 无重复键（全量 ${keys.length} 条）${dup.size ? ' → ' + [...dup].join(', ') : ''}`);
}

/* 3. 密钥绝不入库 */
const srcFiles = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.wrangler'].includes(e.name)) continue;
      walk(rel);
    } else if (/\.(ts|tsx|js|mjs|json|toml|md)$/.test(e.name)) srcFiles.push(rel);
  }
};
walk('src');
srcFiles.push('wrangler.toml', 'README.md');
for (const p of srcFiles) {
  const fp = path.join(root, p);
  if (!fs.existsSync(fp)) continue;
  const t = fs.readFileSync(fp, 'utf8');
  check(!/\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,})\b/.test(t), `${p} 无明文密钥`);
}

/* 4. 样式层顺序：动效层 → 液态玻璃层 → Reverie 设计系统层收口在最后。
      Reverie 用同等 !important 覆盖前六层的色板，必须保留玻璃层里
      遮罩 / Toast / 抽屉 / 欢迎卡的修复，否则会静默回退成旧 bug。 */
const main = read('src/app/main.tsx');
const imports = [...main.matchAll(/import\s+['"]\.\/styles\/([^'"]+)['"]/g)].map((m) => m[1]);
check(imports.at(-1) === 'reverie.css', `reverie.css 为最后加载的样式层（实际 ${imports.at(-1)}）`);
check(
  imports.includes('motion.css') && imports.indexOf('motion.css') < imports.indexOf('liquid-glass.css'),
  '动效层在玻璃层之前加载（玻璃层不得跳过动效层）',
);
check(
  imports.includes('liquid-glass.css') && imports.indexOf('liquid-glass.css') < imports.indexOf('reverie.css'),
  '液态玻璃层在 Reverie 之前加载，浮岛结构不被新层覆盖掉',
);
const glass = read('src/app/styles/liquid-glass.css');
check(/\.modal\s*\{[^}]*background:\s*rgba\(/s.test(glass), '玻璃层保留半透明弹窗遮罩');
check(/#toast\s*\{[^}]*background:\s*transparent/s.test(glass), '玻璃层保留透明 Toast 容器');
check(/transform:\s*translateX\(calc\(-100%/s.test(glass), '玻璃层保留移动端抽屉收起位移');
check(/body\.side-open \.sidebar\s*\{[^}]*transform:\s*translateX\(0\)/s.test(glass), '玻璃层保留移动端抽屉展开');
check(/prefers-reduced-motion:\s*reduce/.test(glass), '玻璃层尊重减少动态偏好');
/* 页头欢迎卡：四角全圆角玻璃卡，且不再残留直角细线框 */
const welcomeBlock = (glass.match(/\.welcome\s*\{[^}]*\}/s) || [''])[0];
check(/border-radius:\s*var\(--lg-r-lg\)/.test(welcomeBlock) && !/border-radius:\s*0/.test(welcomeBlock), '玻璃层欢迎卡为全圆角玻璃卡');
check(/border:\s*1px solid var\(--lg-stroke\)/.test(welcomeBlock), '玻璃层欢迎卡为四边细线边框');
check(/\.welcome \.w-av\s*\{[^}]*border-radius:\s*50%/s.test(glass), '玻璃层欢迎头像为圆形');
/* 头像与个人资料页同源：Dashboard 用 img，控制器读 /api/profile */
const dashTsx = read('src/app/pages/Dashboard.tsx');
check(/<img\s+className="w-av"\s+id="wAv"/.test(dashTsx), '欢迎头像使用 img 而非首字母方块');
const dashTs = read('src/app/legacy/dashboard.ts');
check(/api\.get\('\/api\/profile'\)/.test(dashTs) && /prof\.profile\.avatar|prof && prof\.profile && prof\.profile\.avatar/.test(dashTs), '欢迎头像读取与个人资料同源的 /api/profile');
const motion = read('src/app/styles/motion.css');
check(/\.modal\s*\{[^}]*background:\s*rgba\(/s.test(motion), '弹窗遮罩为半透明（不是整屏白卡）');
check(/#toast\s*\{[^}]*background:\s*transparent/s.test(motion), 'Toast 容器透明（不是黑色药丸）');
check(/body::after\s*\{/s.test(motion), '抽屉遮罩常驻可过渡');
check(/prefers-reduced-motion:\s*reduce/.test(motion), '尊重系统减少动态偏好');
check(/@keyframes tdPopOut/.test(motion) && /@keyframes tdDropOut/.test(motion), '浮层有对称的退出动画');

/* 5. 动效引擎只能有一套，避免 scroll 监听随切页累积 */
const runtime = read('src/app/lib/runtime.ts');
const refresh = runtime.slice(runtime.indexOf('export function refreshRuntime()'), runtime.indexOf('// 前端通用工具'));
check(!/mountMotionStandalone/.test(refresh), 'refreshRuntime 未重复挂载第二套动效引擎');
check(/bootMotion\(\)/.test(runtime), '动效引擎为全局单例');

/* 6. 保存设置不得再出现未声明的 brandPromise 赋值 */
const admin = read('src/app/legacy/admin.ts');
check(!/^\s*brandPromise\s*=/m.test(admin), '后台保存未给未声明变量赋值');
check(/resetBranding\(\)/.test(admin) && /loadBranding, resetBranding/.test(admin), '品牌缓存走合法清理函数');

/* 7. 顶栏自动缩走 / 后台字体生效 / 单层输入框 / 桌面无孤立按钮 */
const comp = read('src/app/styles/components.css');
check(/--sans:\s*var\(--cn-body\)/.test(comp), '正文 --sans 引用后台可配的 --cn-body');
check(/setProperty\('--td-serif'/.test(runtime) && /removeProperty\('--td-serif'\)/.test(runtime), '非系统字体时衬线标题一起跟随，system 时恢复高雅衬线');
check(/fontBody:\s*d\.fontBody \|\| 'system'/.test(runtime), '品牌缓存默认字体为 system');
check(/fontBody:\s*s\.font_body \|\| 'system'/.test(read('src/index.ts')), '/api/config 默认字体为 system');
check(/syncTopbarState/.test(runtime) && /topbar-compact/.test(runtime) && /topbar-hidden/.test(runtime), '顶栏状态由全局单例驱动');
check(/syncTopbarState\(\)/.test(refresh) && /applyLayoutPrefs\(\)/.test(refresh), '切页时重算顶栏与收起偏好');
check(!/b\.classList\.add\('topbar-hidden'\)/.test(runtime), '滚动不再自动让顶栏整条消失（改为显式收起）');
check(/body\.topbar-compact \.topbar\s*\{[^}]*height:\s*46px/s.test(glass), '玻璃层收窄胶囊样式存在');
check(/body\.topbar-hidden \.topbar/s.test(glass), '玻璃层顶栏收起样式存在');
check(/body\.topbar-hidden \.topbar-reveal/.test(glass), '顶栏收起后仍有唤回把手');
check(/getElementById\('tbStow'\)/.test(runtime) && /getElementById\('tbReveal'\)/.test(runtime) && /getElementById\('sideCollapse'\)/.test(runtime), '顶栏收起钮 / 唤回把手 / 侧栏折叠钮均已挂载');
check(/td_side_collapsed/.test(runtime) && /td_topbar_hidden/.test(runtime), '顶栏与侧栏收起状态写入 localStorage');
check(/body\.side-collapsed/.test(glass) && /side-item::after/.test(glass), '侧栏折叠成图标条且悬停显示名称');
const sideDock = (glass.match(/#sideCollapse\s*\{[^}]*position:\s*sticky[^}]*\}/s) || [''])[0];
check(/\.sidebar\s*\{[^}]*flex-direction:\s*column/s.test(glass), '浮岛侧栏为 flex 列，滚动只发生在浮岛内部');
check(/position:\s*sticky/.test(sideDock) && /bottom:\s*0/.test(sideDock), '收起侧边栏按钮 sticky 固定在浮岛底部');
check(/margin-top:\s*auto/.test(sideDock) && /flex:\s*0 0 auto/.test(sideDock), '收起按钮不被菜单挤走、也不被压缩');
check(/backdrop-filter:\s*var\(--lg-blur-sm\)/.test(sideDock), '固定按钮带玻璃底，滚动内容不会透字');
check(/'收起顶栏':\s*'Hide toolbar'/.test(read('src/app/lib/dict.en.ts')), '新增控制按钮有英文词条');
check(/\.side-toggle \{ display: none !important; \}/.test(glass), '桌面/平板隐藏孤立汉堡按钮');
check(/#bellBtn/.test(runtime) && /insertBefore\(b, bell\)/.test(runtime), '主题按钮归入右侧图标组');
const focusBlock = (glass.match(/\.input:focus[\s\S]*?\}/) || [''])[0];
check(!/0 0 0 3px/.test(focusBlock) && /inset 0 0 0 1px/.test(focusBlock), '输入框聚焦为单层（无外部 3px 光环）');
check(/\.reg-field-head\s*\{[^}]*background:\s*transparent/s.test(glass), '字段标题不再叠第二层灰框');
check(/--lg-stroke:\s*rgba\(47, 125, 91/.test(glass), '浅色玻璃描边为可见淡绿');
check(/:not\(\.side-toggle\)/.test(read('src/app/styles/theme-terra.css')), '汉堡按钮被排除出全局按钮基线（避免空灰块）');

/* 8. 官网根路径 = 主页，登录页独立 */
const appRoutes = read('src/app/App.tsx');
check(/'\/\s*':\s*HomePage/.test(appRoutes) && /'\/login':\s*LoginPage/.test(appRoutes), '根路径渲染主页、/login 独立为登录页');
check(/ROUTES\[key\]\s*\|\|\s*HomePage/.test(appRoutes), '未知路径回落主页而非登录页');
check(!/mountCloudShader/.test(appRoutes) && !/cloudShader/.test(appRoutes), 'Reverie 首页不再挂 WebGL 云 shader（首屏更快、更安静）');
check(/\/login\.html/.test(read('src/index.ts')), 'SPA 回落包含 /login.html');
check(/zx-nav-cta"\s+href="\/register"/.test(read('src/app/pages/Home.tsx')), '主页 CTA 指向注册页');
check(!/href="\/">登录/.test(runtime) && !/location\.href\s*=\s*'\/\?login=1'/.test(runtime), '不再有把根路径当登录页的入口');
check(/\/login\?q=/.test(read('src/app/legacy/whois.ts')) && /href="\/login"/.test(read('src/app/legacy/report.ts')), 'WHOIS / 举报的登录链接指向 /login');

/* 9. 切页过渡：Miku 冒出来 + 跳转中气泡（真实素材，不用 SVG 画角色） */
const transition = read('src/app/lib/pageTransition.ts');
check(/mountTransition\(\)/.test(main) && /from '\.\/lib\/pageTransition'/.test(main), '入口挂载切页过渡层');
check(/addEventListener\('popstate',\s*\(\)\s*=>\s*beginTransition\(undefined, prefetchRoute\(location\.href\)\)\)/.test(transition), 'SPA 切页 / 后退触发过渡并预取（事件对象不误当导航回调）');
check(/addEventListener\('td:page-ready', endTransition\)/.test(transition), '页面资料就绪收起过渡');
check(/td:page-ready/.test(runtime), 'refreshRuntime 派发页面就绪信号');
check(/data-no-i18n/.test(transition), '气泡文案不被全局翻译改写');
check(/kind:\s*'image'/.test(transition) && /miku-pop\.png/.test(transition), '默认使用真实 PNG 素材');
check(/'gif'/.test(transition) && /'video'/.test(transition) && /<video/.test(transition), '预留 GIF / MP4 一行切换');
check(!/<svg|createElementNS|image\/svg\+xml/i.test(transition), '角色不是 SVG 绘制');
check(/SHOW_DELAY\s*=\s*0/.test(transition) && /MIN_VISIBLE\s*=\s*360/.test(transition) && /HIDE_ANIM\s*=\s*340/.test(transition) && /FORCE_HIDE\s*=\s*8000/.test(transition), '点击即播、只保底 360ms、340ms 淡出、8s 兜底（不再固定按住 1.1s）');
check(/NAV_HOLD_MIN\s*=\s*200/.test(transition) && /NAV_MAX_WAIT\s*=\s*1400/.test(transition) && /MEDIA_WAIT\s*=\s*180/.test(transition), '数据到手 + Miku 起手才换页，慢数据最多等 1400ms');
check(/DOM_QUIET\s*=\s*180/.test(transition) && /MutationObserver/.test(transition) && /getElementById\('root'\)/.test(transition), '按 #root 内容稳定判定资料就绪（fire-and-forget 页面不再提前收起）');
check(/warmAssets\(/.test(transition) && /WARM_ASSETS/.test(transition) && /decodeAsset/.test(transition), '首屏预热 Miku 与壁纸，切页不再现拉素材');
check(/miku-bouquet-haze\.webp/.test(transition) && /theme === 'dark'/.test(transition) && /picks\.forEach/.test(transition), '只预热当前主题那张壁纸，不再多拉 310K 抢首屏带宽');
check(/Promise\.race/.test(transition) && /waitMedia\(\)/.test(transition), '素材 / 数据等待都有硬上限，网慢不卡死切页');
check(/beginTransition\(action\?/.test(transition) && /navPending/.test(transition) && /runPendingAction/.test(transition), '站内导航延后到数据之后，且兜底隐藏必补一次换页');
check(/if\s*\(navPending\)\s*return/.test(transition), '导航前旧页面派发的 page-ready 不算就绪');
check(!/endTransition[\s\S]{0,200}clearTimeout\(showTimer\)/.test(transition), '就绪信号不能取消显示');
check(/beginTransition\(undefined, prefetchRoute/.test(read('src/app/App.tsx')) && /useLayoutEffect/.test(read('src/app/App.tsx')), 'App 路由 key 变化驱动，每个页面组件都覆盖');
check(/beginTransition\(\(\)\s*=>\s*navigate\(href\), prefetchRoute\(href\)\)/.test(read('src/app/App.tsx')), '站内链接点击瞬间并行预取，不立刻 pushState');
/* 预取层：数据并行、缓存消费、点击透传、根域名不重播 */
const prefetch = read('src/app/lib/prefetch.ts');
check(/ROUTE_DATA/.test(prefetch) && /fetch\(path/.test(prefetch) && /credentials:\s*'same-origin'/.test(prefetch), '预取层按路由并行发起只读同源 GET');
check(/takePrefetched/.test(prefetch) && /TTL\s*=\s*6000/.test(prefetch) && /cache\.delete\(path\)/.test(prefetch), '预取结果一次性消费且有有效期，不会用旧数据');
check(/takePrefetched\(p\)/.test(runtime) && /api\.req\('GET', p\)/.test(runtime), 'api.get 优先消费预取，未命中走正常请求（401 逻辑不绕过）');
check(/if \(!active && !starting\) return/.test(transition) && /t\?\.closest\?\.\('a\[href\]'\)/.test(transition), '过渡期间链接可点改目标，非链接交互被守卫拦下');
check(/\.td-trans \{[^}]*pointer-events:\s*none/.test(glass), '遮罩不吞点击，链接能透传');
check(/meoy\\\.top\|v-1\\\.top/.test(transition) && /if \(hopped\)/.test(transition) && /shouldPlayOnLoad\(\)/.test(transition), '根域名页跳过来的首屏不重播第二遍过渡');
/* 只有跳转才播：刷新 / 直接打开 / 外部进入一律不播 */
check(/if \(shouldPlayOnLoad\(\)\) beginTransition\(\)/.test(transition) && !/mountTransition\(\)[\s\S]{0,40}\n\s*beginTransition\(\);/.test(transition), '入口首屏默认不播过渡，只有检测到跳转意图才播');
check(/navigationType\(\) === 'reload'/.test(transition) && /return false/.test(transition), '刷新（reload）一律不播过渡');
check(/NAV_INTENT_KEY/.test(transition) && /NAV_INTENT_TTL\s*=\s*6000/.test(transition) && /consumeNavigationIntent/.test(transition), '跨文档跳转用短效一次性意图标记，读完即删');
check(/addEventListener\('pagehide'/.test(transition) && /markNavigation\(\)/.test(transition), '整页跳转卸载前写意图，SPA 换页不写');
check(/addEventListener\('pageshow'/.test(transition) && /persisted/.test(transition) && /root\.hidden = true/.test(transition), 'bfcache 后退恢复时收掉残留遮罩，不重播');
check(/prevKey\.current !== key/.test(read('src/app/App.tsx')) && /useRef\(key\)/.test(read('src/app/App.tsx')), 'App 首屏挂载不播过渡，只有路由 key 变化才播');
check(/wasPending/.test(transition) && /重新排一次导航/.test(transition), '过渡中改点别的页面会重新排导航');
check(/td-miku-rise/.test(glass) && /td-miku-breathe/.test(glass) && /td-trans-bubble/.test(glass), '玻璃层含冒出 / 呼吸 / 气泡样式');
check(/\[data-theme="dark"\] \.td-trans/.test(glass) && /prefers-reduced-motion/.test(glass.split('页面切换过渡').pop() || ''), '过渡层深色与减少动态适配');
check(fs.existsSync(path.join(root, 'public/img/transition/miku-pop.png')), 'Miku 透明素材已入库');

/* 10. 根域名静态页：跳控制台时也走同一套过渡，且副本同步 */
const rootPages = [
  ['meoy.top.html', 'src/html/root-meoy.ts'],
  ['v-1.top.html', 'src/html/root-v1.ts'],
];
for (const [f, src] of rootPages) {
  const rp = read(src);
  check(/id="tdTransition"/.test(rp) && /td-miku-rise/.test(rp), `${f} 含 Miku 跳页过渡`);
  check(/addEventListener\("click"/.test(rp) && /preventDefault\(\)/.test(rp), `${f} 拦截控制台链接`);
  check(/prefers-color-scheme: dark/.test(rp), `${f} 深色跟随系统`);
  // 只做仓库内自校验：CI 里没有仓库外的工作区交付副本，不能读它
  check(/setTimeout\(function\(\)\{ location\.href = url; \}, 300\)/.test(rp), `${f} Miku 起手 300ms 就跳，不再干等 760ms`);
  check(/rel\s*=\s*"preload"/.test(rp) && /miku-pop\.png/.test(rp), `${f} 页面加载即预热过渡角色，点击时不再现拉`);
  check((rp.match(/id="tdTransition"/g) || []).length === 1, `${f} 过渡层只挂一份`);
}
check(/\.td-trans\.is-out\s*\{[^}]*pointer-events:\s*none/.test(read('src/app/styles/liquid-glass.css')), '淡出期间放行交互，遮罩不多挡 340ms');

/* 11. 花束 Miku 壁纸 / 控制台 UI 重构 */
const runtimeJs = read('src/app/lib/runtime.ts');
const bloom = glass.split('BLOOM · 花束 Miku').pop() || '';
check(/WALLPAPERS[\s\S]{0,400}key: 'bouquet'/.test(runtimeJs), '花束 Miku 已加入壁纸清单');
check(/localStorage\.getItem\('meoy_wallpaper'\)\s*\|\|\s*'bouquet'/.test(runtimeJs), '首次进入默认花束壁纸');
check(/--bg-img-dark/.test(runtimeJs) && /--bg-haze/.test(runtimeJs) && /data-wallpaper/.test(runtimeJs), '壁纸带深色版 / 氛围版 / 状态属性');
check(/data-no-i18n/.test(runtimeJs) && /--wp-thumb/.test(runtimeJs), '切换器改成缩略圆点且不被翻译改写');
check(/meoy_wallpaper_v2/.test(runtimeJs), '旧壁纸存档一次性升级到花束默认');
for (const f of ['miku-bouquet.webp', 'miku-bouquet-dark.webp', 'miku-bouquet-haze.webp', 'miku-bouquet-thumb.webp']) {
  check(fs.existsSync(path.join(root, 'public/img/wallpaper', f)), `壁纸素材 ${f} 已入库`);
}
check(/display:\s*block\s*!important/.test(bloom), '历史层隐藏的 #bg 在控制台重新启用');
check(/z-index:\s*-1/.test(bloom) && /mix-blend-mode:\s*multiply/.test(bloom), '白底插画以 multiply 融入纸面');
check(/--bg-haze/.test(bloom) && /#bg\[data-wp-loaded="1"\]/.test(bloom) && /bl-wp-fade/.test(bloom), '壁纸先用轻量氛围图铺底，高清解码后淡入');
check(/prefers-reduced-motion[\s\S]{0,300}#bg\[data-wp-loaded="1"\][\s\S]{0,160}animation:\s*none/.test(bloom), '减少动态时壁纸不做淡入');
check(/dataset\.wpLoaded/.test(runtimeJs) && /img\.decode/.test(runtimeJs), 'runtime 解码完主图才打上淡入标记');
check(/brandValue/.test(runtimeJs) && /brandRefreshing/.test(runtimeJs) && /Promise\.resolve\(brandValue\)/.test(runtimeJs), '品牌配置走 stale-while-revalidate，切页不再 await 接口');
check(/export function resetBranding\(\)\s*\{[^}]*brandPromise\s*=\s*null/s.test(runtimeJs), '后台保存后清缓存，下次切页拉新值');
const shellHtml = read('src/html/spa.ts');
check(/rel="preload" as="image" href="\/img\/transition\/miku-pop\.png"/.test(shellHtml), '首屏 preload 过渡角色');
check(/miku-bouquet-haze\.webp/.test(shellHtml) && /miku-bouquet-dark\.webp/.test(shellHtml), '首屏 preload 壁纸浅/深/氛围版');
check(/html\[data-theme="dark"\] body[\s\S]{0,400}background:\s*transparent\s*!important/.test(bloom), '深色 body 以同等特异性压成透明（否则盖住壁纸）');
check(/background-color:\s*var\(--bl-paper\)/.test(bloom) || /html:not\(\[data-theme="dark"\]\)[\s\S]{0,200}background-color/.test(bloom), '纸面渐变移到根元素');
check(/--bl-jade:\s*#2f8f83/.test(bloom) && /--bl-coral/.test(bloom), '取色自插画：青瓷绿主色 + 花色点缀');
check(/bl-petals/.test(bloom) && /prefers-reduced-motion/.test(bloom), '花瓣呼吸动效且尊重减少动态');
check(/\.bgswitch button[\s\S]{0,300}border-radius:\s*50%/.test(bloom), '壁纸切换器为圆形缩略点');
check(/min-width:\s*620px\s*!important/.test(bloom), '窄屏表格不再竖排断字');
check(imports.at(-1) === 'reverie.css', 'Reverie 设计系统为最后加载的视觉权威层');

/* 12. 首屏一次性就绪：不再「一阶段 / 二阶段 / 三阶段慢慢加载出来」 */
const gate = read('src/app/lib/runtime.ts');
const dash = read('src/app/legacy/dashboard.ts');
const dashPage = read('src/app/pages/Dashboard.tsx');
const appSrc = read('src/app/App.tsx');
check(/SHARED_TTL/.test(gate) && /sharedGet/.test(gate) && /pageFetchStart/.test(gate), '同路径在飞 GET 合并成一次，首屏请求纳入在途计数');
check(/sharedGet\.get\(p\)/.test(gate) && /takePrefetched\(p\)/.test(gate), 'api.get 先复用共享 / 预取结果，未命中才发真实请求');
check(/method !== 'GET'[\s\S]{0,80}clearSharedGet\(\)/.test(gate), '写操作立刻清共享缓存，签到 / 释放域名不读旧值');
check(/whenPageFetchesIdle/.test(gate) && /setTimeout\(r, 2500\)/.test(gate), '就绪门控有 2.5s 硬兜底，单个挂死接口不会藏住整页');
check(/page-root\[data-ready="0"\]/.test(gate) && /dataset\.ready = '1'/.test(gate) && /td:page-ready/.test(gate), '全部首屏 GET 结算后才放出页面并宣告过渡收起');
check(/opt\.deferAvatar/.test(gate), '骨架支持由页面快照一次性提供头像，不再先默认后替换');
check(/bumpPageGeneration/.test(gate) && /gen !== pageGeneration/.test(gate) && /bumpPageGeneration\(\)/.test(appSrc), '切页世代：上一页未结算完的就绪回调不会放出新页面骨架');
check(/async function snapshot\(\)/.test(dash) && /Promise\.all\(\[/.test(dash), '控制台首屏五个数据源一次并行出发');
for (const p of ['/api/subdomains', '/api/config', '/api/points/me', '/api/auth/me', '/api/profile']) {
  check(dash.includes(`'${p}'`), `首屏快照包含 ${p}`);
}
check(/function renderAll\(/.test(dash) && /renderPoints\(snap\.points\)/.test(dash), '欢迎卡 / 统计卡 / 积分卡 / 列表由同一个同步函数一次写完');
check(!/async function fillWelcome/.test(dash) && !/api\.get\('\/api\/points\/me'\)\.then\(/.test(dash), '不再有 fire-and-forget 的欢迎语与积分异步补写');
check(/await Promise\.all\(\[\s*snapshot\(\),\s*mountShell\('domains', \{ deferAvatar: true \}\)/.test(dash), 'mountDashboard 真的 await 完整首屏，就绪信号不会提前派发');
check(/renderAvatars\(/.test(dash), '顶栏头像与欢迎卡头像同一帧落地');
check(/data-ready="0"/.test(dashPage) && /id="stDomains">—/.test(dashPage) && /id="wHi">&nbsp;/.test(dashPage), '骨架不放假的 0 / 欢迎回来，数据未到齐前不露脸');
check(/dataset\.ready = '0'/.test(appSrc) && /3000\)/.test(appSrc) && /clearTimeout\(failsafe\)/.test(appSrc), '每个页面挂载先隐藏内容区，并有 3s 放出兜底');
const pageFiles = fs.readdirSync(path.join(root, 'src/app/pages')).filter((f) => f.endsWith('.tsx'));
for (const f of pageFiles) {
  check(/refreshRuntime\(\)/.test(read('src/app/pages/' + f)), `${f} 会触发就绪门控`);
}
check(/READY_FALLBACK/.test(read('src/app/lib/pageTransition.ts')) && /readySignaled \|\| \(now - shownAt >= READY_FALLBACK && stable\)/.test(read('src/app/lib/pageTransition.ts')), '过渡必须等页面宣告整屏就绪，DOM 静默不再单独放行');
check(/readySignaled = false/.test(read('src/app/lib/pageTransition.ts').split('if \(active \|\| starting\)').pop() || ''), '过渡中改点别的页面会作废旧页面的就绪信号');
check(/\.page-root\[data-ready="0"\] \.main/.test(read('src/app/styles/liquid-glass.css')) && /tdPageIn/.test(read('src/app/styles/liquid-glass.css').split('首屏一次性显现').pop() || ''), '未就绪时只藏内容区，就绪后整屏一次淡入（壁纸与玻璃框架照常可见）');


/* 13. 壁纸全站满铺：不再只有右下角一小块、不再把公共页整层隐藏 */
const fullWp = read('src/app/styles/liquid-glass.css').split('BLOOM · 花束 Miku').pop() || '';
check(/background-size:\s*cover\s*!important/.test(fullWp) && !/background-size:\s*auto\s+\d+vh/.test(fullWp), '主图 background-size: cover 满铺，不再 auto 84vh 只占右下角');
check(!/right\s+-2vw\s+bottom\s+-2vh|linear-gradient\(96deg/.test(fullWp), '去掉右侧定位与左侧 86% 白遮罩');
check(/html body\.page-home #bg/.test(fullWp) && /html body\.page-login #bg/.test(fullWp) && /html body\.page-home\.has-cloud #bg/.test(fullWp), '首页 / 登录页 / has-cloud 都启用壁纸，覆盖整个站点');
check(/height:\s*100dvh\s*!important/.test(fullWp) && /inset:\s*0\s*!important/.test(fullWp), '#bg 固定铺满整个视口');
check(/html\[data-wp-loaded="1"\] body #bg/.test(fullWp), '解码状态写在 html 上，切页新建的 #bg 也能换上高清主图');
check(/html\[data-theme="dark"\] body #bg\[data-wp-loaded="1"\]/.test(fullWp), '深色用独立夜色版，满铺不被白底洗亮');
check(/root\.setAttribute\('data-wallpaper'/.test(gate) && /root\.style\.setProperty\('--bg-img'/.test(gate), '壁纸变量挂在 html 上，所有页面 #bg 继承');
check(/function syncWallpaperNodes\(\)/.test(gate) && /refreshRuntime\(\)[\s\S]{0,160}syncWallpaperNodes\(\)/.test(gate), '切页后同步新 #bg 节点，不再叠出两层满屏壁纸');
check(!/document\.body\.prepend\(el\)/.test(gate), '不再额外造一个 body 级 #bg 与页面节点重叠');
check(/syncWallpaperNodes\(\)/.test(gate) && /data-wallpaper/.test(gate), '壁纸切换器对全站所有页面即时生效');

/* 14. 全 TypeScript：仓库不再跟踪 .html / .js / .mjs，页面壳与脚本都由 TS 提供 */
const emitShell = read('scripts/emit-html-shell.ts');
const emitRoot = read('scripts/emit-static-pages.ts');
const pkg = read('package.json');
check(/export const spaShellHtml = String\.raw`/.test(shellHtml), 'SPA 外壳以 TS 模板字符串导出');
check(/export const meoyTopHtml = String\.raw`/.test(read('src/html/root-meoy.ts')) && /export const v1TopHtml = String\.raw`/.test(read('src/html/root-v1.ts')), '两份根域名页同为 TS 模板字符串');
check(/writeFileSync/.test(emitShell) && /spaShellHtml/.test(emitShell), '构建前由 TS 模板生成 index.html');
check(/meoyTopHtml/.test(emitRoot) && /v1TopHtml/.test(emitRoot) && /dist\/root-pages/.test(emitRoot), '静态托管仍可一键导出两份 HTML');
check(/tsx scripts\/emit-html-shell\.ts && vite build/.test(pkg) && /tsx scripts\/emit-html-shell\.ts && vite/.test(pkg), 'build / dev 都先生成外壳');
check(/tsx/.test(pkg) && /"tsx":/.test(pkg), 'tsx 已声明为开发依赖，CI 能执行 .ts 脚本');
check(/rootPageFor/.test(read('src/index.ts')) && /c\.html\(rootPage\)/.test(read('src/index.ts')), 'Worker 按 Host 直出根域名页，不依赖静态 .html');
check(/tailwindcss\(tailwindConfig/.test(read('vite.config.ts')) && !fs.existsSync(path.join(root, 'postcss.config.js')) && !fs.existsSync(path.join(root, 'tailwind.config.js')), 'PostCSS / Tailwind 配置内联进 vite.config.ts，无 .js 配置');
check(fs.existsSync(path.join(root, '.gitattributes')) && fs.existsSync(path.join(root, '.mailmap')) && fs.existsSync(path.join(root, '.gitignore')), '语言统计与贡献者归并配置齐备');
/* 15. 页脚备案号：后台可配 → 服务端清洗 → 公开接口下发 → 全站页脚渲染 */
const cfgApi = read('src/index.ts');
const adminApi = read('src/routes/admin.ts');
const adminUi = read('src/app/legacy/admin.ts');
const icpRuntime = read('src/app/lib/runtime.ts');
const icpCss = read('src/app/styles/liquid-glass.css');
const icpDict = read('src/app/lib/dict.en.ts');
check(/function sanitizeFooterHtml/.test(adminApi) && /footer_icp_html/.test(adminApi), '备案 HTML 由服务端清洗后入库');
check(/rel="noopener noreferrer"/.test(adminApi) && /escText/.test(adminApi) && /escAttr/.test(adminApi), '备案链接统一补 rel 且文本转义');
check(/'footer_icp_html'/.test(cfgApi) && /footerIcpHtml:\s*s\.footer_icp_html === undefined \? DEFAULT_FOOTER_ICP_HTML/.test(cfgApi), '公开 /api/config 下发备案 HTML（未配置时用默认值）');
check(/id="sFooterIcpHtml"/.test(adminUi) && /footerIcpHtml:\s*document\.getElementById\('sFooterIcpHtml'\)/.test(adminUi), '后台站点设置可填写并回填备案 HTML');
check(/export function mountIcpBadge/.test(icpRuntime) && /mountIcpBadge\(typeof b\.footerIcpHtml/.test(icpRuntime), '品牌应用时即时刷新备案号');
check(/try \{ mountIcpBadge\(\); \} catch/.test(icpRuntime), '切页后重新挂载备案号');
check(/data-icp-slot/.test(read('src/app/pages/Home.tsx')), '公共页页脚预留备案插槽');
check(/\.sf-icp/.test(icpCss), '备案号样式在液态玻璃收口层');
check(/'页脚备案号（可选）'/.test(icpDict), '备案设置有英文词条');
const icpDefault = read('src/lib/footerIcp.ts');
check(/DEFAULT_FOOTER_ICP_HTML/.test(icpDefault) && /icp\.gov\.moe\/\?keyword=20269429/.test(icpDefault), '默认备案号指向萌ICP 20269429');
check(/s\.footer_icp_html === undefined \? DEFAULT_FOOTER_ICP_HTML/.test(cfgApi), '未配置时用默认值、主动清空则隐藏');
check(/raw\.footer_icp_html === undefined/.test(adminApi), '后台设置回填默认备案号');
for (const p of ['src/html/root-v1.ts', 'src/html/root-meoy.ts']) {
  const t = read(p);
  check(/id="icpSlot"/.test(t) && /d\.footerIcpHtml/.test(t), `${p} 根域名页从同一接口取备案号`);
  check(/DEFAULT_ICP_HTML/.test(t) && /icp\.gov\.moe\/\?keyword=20269429/.test(t), `${p} 首屏内联默认备案号`);
  check(/typeof d\.footerIcpHtml === "string"/.test(t), `${p} 接口无字段时保留默认备案号`);
}
/* 16. 页脚联系方式：与备案号共用清洗 / 下发 / 注入链路，首次部署即显示 */
const contactDefault = read('src/lib/footerContact.ts');
check(/DEFAULT_FOOTER_CONTACT_HTML/.test(contactDefault) && /t\.me\/\+cTDEQy_0HqcxZDVl/.test(contactDefault), '默认联系方式指向 Telegram 邀请链接');
check(/data-no-i18n/.test(contactDefault), '默认联系方式不被界面翻译器改写（英文模式不冒中文）');
check(/'footer_contact_html'/.test(cfgApi) && /footerContactHtml:\s*s\.footer_contact_html === undefined \? DEFAULT_FOOTER_CONTACT_HTML/.test(cfgApi), '公开 /api/config 下发联系方式 HTML（未配置时用默认值）');
check(/sanitizeFooterHtml\(body\.footerContactHtml\)/.test(adminApi) && /set\('footer_contact_html'/.test(adminApi), '后台保存联系方式复用同一安全清洗器');
check(/raw\.footer_contact_html === undefined/.test(adminApi), '后台设置回填默认联系方式');
check(/id="sFooterContactHtml"/.test(adminUi) && /footerContactHtml:\s*document\.getElementById\('sFooterContactHtml'\)/.test(adminUi), '站点设置可填写并保存联系方式');
check(/export function mountContactBadge/.test(icpRuntime) && /data-contact-slot/.test(icpRuntime), '全站页脚联系方式注入逻辑存在');
check(/mountContactBadge\(typeof b\.footerContactHtml/.test(icpRuntime), '后台保存后联系方式即时刷新');
check(/data-contact-slot/.test(read('src/app/pages/Home.tsx')), '公共页页脚预留联系方式插槽');
check(/\.sf-contact/.test(icpCss) && /\.nk-fcontact:empty/.test(icpCss), '联系方式样式在液态玻璃收口层且空槽隐藏');
check(/'页脚联系方式（可选）'/.test(icpDict) && /'直接粘贴联系链接 HTML/.test(icpDict), '联系方式设置有英文词条');
for (const p of ['src/html/root-v1.ts', 'src/html/root-meoy.ts']) {
  const t = read(p);
  check(/id="contactSlot"/.test(t) && /d\.footerContactHtml/.test(t), `${p} 根域名页从同一接口取联系方式`);
  check(/DEFAULT_CONTACT_HTML/.test(t) && /t\.me\/\+cTDEQy_0HqcxZDVl/.test(t), `${p} 首屏内联默认联系方式`);
  check(/typeof d\.footerContactHtml === "string"/.test(t), `${p} 接口无字段时保留默认联系方式`);
}

// 用 git ls-files 判定「仓库里跟踪了什么」，构建产物 index.html 不应被误判
try {
  const { execFileSync } = await import('node:child_process');
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  const lines = tracked.split('\n').filter(Boolean);
  check(!lines.some((f) => f.endsWith('.html')), '仓库不跟踪任何 .html');
  check(!lines.some((f) => /\.(m?js|cjs)$/.test(f)), '仓库不跟踪任何 .js/.mjs/.cjs');
  check(!lines.some((f) => f.startsWith('root-pages/')), 'root-pages/ 已移除');
} catch {
  check(true, '非 git 环境：跳过 tracked 文件判定');
}

/* 16. Reverie 设计系统：Uiverse Reverie 版式 + 按各库替换按钮/图标 + 全站手机适配 */
const rv = read('src/app/styles/reverie.css');
const rvHome = read('src/app/pages/Home.tsx');
const rvIcons = read('src/app/lib/icons.ts');
const rvLegacy = read('src/app/legacy/home.ts');
const rvDict = read('src/app/lib/dict.en.ts');
const rvPkg = read('package.json');
check(/--rv-paper:\s*#f6f2e8/.test(rv) && /--rv-fern:\s*#2f5d45/.test(rv), 'Reverie 羊皮纸与深蕨绿令牌就位');
check(/\[data-theme="dark"\]/.test(rv) && /--rv-fern:\s*#9dc9a8/.test(rv), '深色模式有独立蕨绿 / 纸面色板');
check(/\.rv-pill\.ink\s*\{[^}]*background:\s*var\(--rv-ink\)/s.test(rv), '墨黑药丸按钮（dark ink pill）');
check(/\.rv-title em\s*\{[^}]*font-style:\s*italic[^}]*color:\s*var\(--rv-fern\)/s.test(rv), '标题只留一处绿色斜体强调');
check(/\.rv-art\s*\{[^}]*background-image:\s*url\('\/img\/wallpaper\//s.test(rv), '画意卡承载壁纸，查询框浮在风景上');
check(/html body\.page-home\.page-reverie\.has-cloud #bg\s*\{[^}]*opacity:\s*\.14 !important/s.test(rv), '首页壁纸仍满铺，只是退成纸面底纹（压住手机端 !important 规则）');
check(/\.rv-head a\.rv-mobile-cta \{ display: none; \}/.test(rv) && /\.rv-head a\.rv-mobile-cta \{ display: inline-flex;/.test(rv), '桌面顶栏不出现重复「注册」药丸，手机端才显示');
check(/@keyframes rvReveal/.test(rv) && /calc\(var\(--i, 0\) \* 80ms\)/.test(rv), 'React Bits / Anime.js 式 stagger 入场（纯 CSS，零依赖）');
check(/@keyframes rvDots/.test(rv), 'Uiverse 三点 loader 用于查询中');
check(/rvUnderline/.test(rv), 'Aceternity Hero Highlight 克制版细线扫光');
check(/:not\(\.side-toggle\)/.test(read('src/app/styles/theme-terra.css')), '汉堡按钮仍被排除，桌面顶栏不出现空灰块');

/* 首页结构：Reverie 类名 + legacy 契约一个不能少 */
for (const cls of ['rv-head', 'rv-hero', 'rv-landscape', 'rv-frame', 'rv-ask', 'rv-sec', 'rv-quote', 'rv-cta', 'rv-foot']) {
  check(rvHome.includes(cls), `首页含 ${cls} 结构`);
}
for (const id of ['searchForm', 'qName', 'qRoot', 'results', 'suffixGrid', 'rtTags', 'rtMore', 'apiHost', 'yr', 'toast']) {
  check(new RegExp(`id="${id}"`).test(rvHome), `首页保留 legacy id #${id}`);
}
check(/data-logo-img/.test(rvHome) && /data-site-name/.test(rvHome) && /data-icp-slot/.test(rvHome), '品牌注入 / 页脚备案插槽未丢');
check(/zx-nav-cta"\s+href="\/register"/.test(rvHome), 'Reverie 版 CTA 仍指向注册页');

/* 图标：统一细线 currentColor、静态页与动态渲染共用一份 */
check(/stroke="currentColor"/.test(rvIcons) && /stroke-width="1\.5"/.test(rvIcons), '全站图标为细线 currentColor（零外链）');
check(!/https?:\/\//.test(rvIcons.replace(/https:\/\/uiverse\.io\/design\/systems\/reverie/g, '')), '图标集不加载任何外部资源');
check(/export function svgIcon/.test(rvIcons) && /ICON_PATHS/.test(rvIcons), '图标集同时服务 TSX 与 legacy innerHTML');
check(/svgIcon\('leaf'/.test(rvLegacy) && /svgIcon\('arrow'/.test(rvLegacy), '动态后缀卡 / 结果卡使用同一套图标');
check(/rv-dots/.test(rvLegacy), '查询中改用 Uiverse 三点 loader');
check(/td-ico/.test(rv), '图标有统一尺寸 / 对齐样式');

/* 英文全局：新首页文案全部有词条 */
for (const k of ['后缀', '开始注册', '可选后缀', '把事情做好', '安静地，', '先挑一个喜欢的前缀，剩下的交给我们。', 'Whois 查询 &', '查询中…']) {
  check(new RegExp(`'${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*:`).test(rvDict), `词典含 Reverie 文案「${k}」`);
}

/* 全站手机适配：不是只改首页，所有页面的通用兜底都在最后一层 */
check(/@media \(max-width: 700px\)/.test(rv) && /@media \(max-width: 360px\)/.test(rv), '700 / 360 两档手机断点');
check(/@media \(max-aspect-ratio: 9\/19\)/.test(rv), '19.5:9 / 20:9 / 21:9 长屏断点');
check(/@media \(orientation: landscape\) and \(max-height: 520px\)/.test(rv), '矮横屏 / 21:9 横屏断点');
check(/@media \(min-width: 701px\) and \(max-width: 1000px\)/.test(rv), '平板 / 折叠展开断点');
check(/@media \(prefers-reduced-motion: reduce\)/.test(rv), '减少动态时关闭全部 Reverie 动画且不藏内容');
check(/\.stats, \.stat-grid[\s\S]{0,400}grid-template-columns: minmax\(0, 1fr\) !important/.test(rv), '手机上控制台多列一律单列');
check(/input:not\(\[type="checkbox"\]\)[\s\S]{0,200}font-size: 16px !important/.test(rv), '手机输入框 16px，iOS 聚焦不缩放');
check(/min-height: 44px/.test(rv), '手机触控目标 ≥44px');
check(/button, \.btn, a\.btn, \.rv-pill, \.rv-pill\.sm, \.rv-more button, \.iconbtn \{ min-height: 44px; \}/.test(rv), 'sm 药丸 /「更多…」也 ≥44px（双类选择器不再盖过兜底）');
check(/\.lang button\{min-height:44px;min-width:44px\}/.test(read('src/html/reverieRootCss.ts')), '根域名页语言切换触控目标 ≥44px');
check(/overflow-x: auto !important/.test(rv), '表格在手机上横向可拖，不裁详情列');
check(/100dvh/.test(rv) || /100dvh/.test(read('src/app/styles/responsive.css')), '浮层用 dvh 跟随 iOS 地址栏');
check(/env\(safe-area-inset/.test(rv), '刘海 / 底部手势条安全区');

/* 不引入任何运行时动画依赖：用户明确反馈过加载慢 */
for (const dep of ['animejs', 'framer-motion', 'motion', 'gsap', '@reactbits', 'aceternity']) {
  check(!new RegExp(`"${dep}"`).test(rvPkg), `未引入 ${dep} 运行时依赖`);
}
/* 15 个页面组件都在，Reverie 只收口视觉，不删任何页面 */
const rvPages = fs.readdirSync(path.join(root, 'src/app/pages')).filter((f) => f.endsWith('.tsx'));
check(rvPages.length >= 15, `全部 ${rvPages.length} 个页面组件保留`);

/* #toast 只是容器：历史上误挂 .toast 卡片类，空容器被刷成底部一块 34×22 灰绿方块 */
const rvAllPages = fs.readdirSync(path.join(root, 'src/app/pages')).filter((f) => f.endsWith('.tsx'));
for (const f of rvAllPages) {
  check(!/className="toast"\s+id="toast"/.test(read(`src/app/pages/${f}`)), `${f} 的 #toast 容器不带卡片类`);
}
check(/#toast:empty[\s\S]{0,140}#toast:not\(:has\(> \*\)\)[\s\S]{0,80}display: none/.test(rv), '空 #toast 不参与布局（底部空方块不再出现）');
check(/#toast > \* \{ pointer-events: auto/.test(rv), '子项提示仍可交互');
check(/\.lang-switch button \{[\s\S]{0,320}border-radius: 999px/.test(rv), '顶栏语言钮为正圆，不再是方砖');
check(/\.lang-switch button \{[\s\S]{0,320}min-height: 44px/.test(rv), '圆形语言钮仍保留 44px 触控目标');

/* 可自定义用户配额：后台可配默认值 → 注册读取 → 首页展示 → 单用户可覆盖 */
const quotaSchema = read('schema.sql');
const quotaAuth = read('src/routes/auth.ts');
const quotaAdminApi = read('src/routes/admin.ts');
const quotaAdminUi = read('src/app/legacy/admin.ts');
const quotaCfg = read('src/index.ts');
const quotaRuntime = read('src/app/lib/runtime.ts');
const quotaHome = read('src/app/pages/Home.tsx');
const quotaDict = read('src/app/lib/dict.en.ts');
check(/INSERT OR IGNORE INTO settings\(key, value\) VALUES \('default_quota', '5'\)/.test(quotaSchema), '新库自带 default_quota 设置');
check(/defaultQuotaOf\(env\)/.test(quotaAuth) && !/Number\(env\.DEFAULT_QUOTA \|\| 5\)/.test(quotaAuth), '注册读取后台默认配额，不再写死 5');
check(/numRule\('default_quota', body\.defaultQuota, -1, 10000/.test(quotaAdminApi), '后台保存校验 -1..10000');
check(/applyQuotaToExisting === true/.test(quotaAdminApi) && /UPDATE users SET quota = \? WHERE role != 'admin'/.test(quotaAdminApi), '可一键同步到现有普通用户');
check(/defaultQuota: await defaultQuotaOf\(c\.env\)/.test(quotaCfg), '公开配置下发 defaultQuota（与注册同口径）');
check(/defaultQuota/.test(quotaRuntime) && /applyDefaultQuota/.test(quotaRuntime), '前端首页额度跟着配置刷新');
check(/data-default-quota/.test(quotaHome) && !/默认 5 个额度/.test(quotaHome), '首页不再硬编码 5 个额度');
for (const id of ['sDefaultQuota', 'sApplyQuota', 'qUseDefault']) {
  check(new RegExp(`id="${id}"`).test(quotaAdminUi), `后台含配额控件 #${id}`);
}
for (const k of ['用户配额', '新用户默认配额', '同步到现有普通用户', '填入全局默认']) {
  check(quotaDict.includes(`'${k}'`), `英文词典含配额文案「${k}」`);
}
const quotaUtil = read('src/lib/util.ts');
check(/parseDefaultQuota/.test(quotaUtil) && /defaultQuotaOf/.test(quotaUtil), '配额解析与读取共用一份实现');
check(/function validQuota/.test(quotaUtil) && /raw\.trim\(\) === ''/.test(quotaUtil), '空串不当成 0（清空配置 ≠ 全员禁申）');
check(/const fromDb = validQuota\(raw\)/.test(quotaUtil) && /parseDefaultQuota\(env\.DEFAULT_QUOTA\)/.test(quotaUtil), '后台脏值逐级回落环境变量，不直接跳内置 5');
check(/const q = await defaultQuotaOf\(c\.env\)/.test(quotaAdminApi), '一键同步复用同一逐级回落实现');

/* 第三方邮箱注册申请 / 精确白名单 */
const erSchema = read('schema.sql');
const erRule = read('src/lib/emailRule.ts');
const erAuth = read('src/routes/auth.ts');
const erPublic = fs.existsSync(path.join(root, 'src/routes/emailRequests.ts'))
  ? read('src/routes/emailRequests.ts') : '';
const erIndex = read('src/index.ts');
const erAdminApi = read('src/routes/admin.ts');
const erAdminUi = read('src/app/legacy/admin.ts');
const erLogin = read('src/app/pages/Login.tsx');
const erLoginCtrl = read('src/app/legacy/index.ts');
const erAdminPage = read('src/app/pages/Admin.tsx');
const erDict = read('src/app/lib/dict.en.ts');
check(/CREATE TABLE IF NOT EXISTS email_allowlist/.test(erSchema) && /CREATE TABLE IF NOT EXISTS email_requests/.test(erSchema), 'D1 有白名单与申请表');
check(/VALUES \('me@stanimir\.cn'/.test(erSchema), '预置白名单含社区申请的 me@stanimir.cn');
check(/explicitlyAllowed/.test(erRule) && /signupEmailOk/.test(erRule), '白名单判定与注册放行共用一份实现');
check(/SEED_ALLOWED_EMAILS/.test(erRule) && /表一旦存在/.test(erRule), '表未建时种子兜底、表存在后管理员可删除');
check(/signupEmailOk\(env, mail\)/.test(erAuth) && !/emailAllowed\(mail, rule, allowedDomains\(env\)\)/.test(erAuth), '注册与发码都走统一放行入口');
check(/app\.post\('\/email-request'/.test(erPublic) && /app\.get\('\/email-request\/status'/.test(erPublic), '公开提交与状态查询接口存在');
check(/emailRequestRoutes/.test(erIndex) && /app\.route\('\/api', emailRequestRoutes\)/.test(erIndex), '公开申请路由已挂载');
check(/\/email-requests\/:id\/approve/.test(erAdminApi) && /\/email-allowlist\/:email/.test(erAdminApi), '后台审批与白名单增删接口存在');
check(/INSERT INTO email_allowlist/.test(erAdminApi) && /status = 'approved'|status = \?, reviewed_at/.test(erAdminApi), '通过申请会写入白名单');
check(/id="emailReqLink"/.test(erLogin), '注册页有第三方邮箱申请入口');
check(/openEmailRequest/.test(erLoginCtrl) && /api\.post\('\/api\/email-request'/.test(erLoginCtrl), '注册页弹窗会提交申请');
check(/data-tab="emailreq"/.test(erAdminPage) && /data-eract="approve"/.test(erAdminUi) && /id="erAdd"/.test(erAdminUi), '后台有邮箱申请页签与审批控件');
for (const k of ['邮箱申请', '邮箱不在允许范围？申请使用此邮箱注册', '申请已提交，请等待管理员审核', '精确邮箱白名单']) {
  check(erDict.includes(`'${k}'`), `英文词典含邮箱申请文案「${k}」`);
}

/* 登录页登录态探测 + 首页顶栏按登录态切换 */
const agShell = read('src/html/spa.ts');
const agRuntime = read('src/app/lib/runtime.ts');
const agLoginCtrl = read('src/app/legacy/index.ts');
const agHome = read('src/app/pages/Home.tsx');
const agDict = read('src/app/lib/dict.en.ts');
check(/__tdAuthProbe/.test(agShell) && /\/api\/auth\/me/.test(agShell), 'head 首屏脚本探测登录态');
check(/p!=='\/login'/.test(agShell) && /location\.replace\('\/dashboard'\)/.test(agShell), '仅登录页探测，命中抢先去控制台（表单不闪）');
check(/export function authProbe/.test(agRuntime) && /w\.__tdAuthProbe/.test(agRuntime), 'runtime 复用首屏探测，SPA 切页可补发');
check(/authProbe\(\)/.test(agLoginCtrl) && /location\.replace\('\/dashboard'\)/.test(agLoginCtrl), '登录页 SPA 切页兜底：已登录不再停在登录页');
check(/authProbe\(\)/.test(agHome) && /readUserCache\(\)/.test(agHome), '首页读缓存首帧切换，再以共享探测校正');
check(/authed\s*\?/.test(agHome) && /href="\/dashboard">→ 去往控制台/.test(agHome), '首页已登录显示「→ 去往控制台」');
check(/href="\/dashboard">→ 控制台/.test(agHome), '手机端 CTA 同步切到控制台');
check(/href="\/login">登录/.test(agHome), '未登录仍保留登录入口');
check(agDict.includes("'→ 去往控制台'") && agDict.includes("'→ 控制台'"), '英文词典含两个整句词条，不夹生');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of errors) console.error('  ✗ ' + m);
console.log(`健康巡检：${ok.length} 通过，${errors.length} 失败`);
if (errors.length) process.exit(1);
