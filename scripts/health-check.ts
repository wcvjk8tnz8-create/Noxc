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
/* CSS 架构收敛：11 层 -> 6 层。历史视觉层已合并进 shell.css，
   唯一视觉源为 design-system.css；断言改为校验架构与行为，不再校验历史文件名。 */
const SHELL = 'src/app/styles/shell.css';
const DESIGN = 'src/app/styles/design-system.css';
const shellCss = read(SHELL);
const designCss = read(DESIGN);

/* 1. 样式层括号必须成对 —— 少一个 } 会让后面整段规则失效 */
const css = [
  SHELL,
  'src/app/styles/captcha.css',
  'src/app/styles/oauth.css',
  DESIGN,
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

/* 4. 样式层架构：6 层，design-system.css 是唯一视觉源且最后加载。
      历史 11 层（含 Reverie / 液态玻璃 / 节点 / 收口层）已按原顺序合并进 shell.css，
      颜色全部令牌化；渐变、毛玻璃、阴影在源头删除，不再靠 !important 层层压盖。 */
const main = read('src/app/main.tsx');
const imports = [...main.matchAll(/import\s+['"]\.\/styles\/([^'"]+)['"]/g)].map((m) => m[1]);
const ORDER = ['shell.css', 'captcha.css', 'oauth.css', 'design-system.css'];
check(imports.length === 4, `样式入口恰好 4 层（实际 ${imports.length}：${imports.join(', ')})`);
check(imports.join(',') === ORDER.join(','), '4 层加载顺序固定：结构 → 独立组件 → 设计系统');
check(imports.at(-1) === 'design-system.css', 'design-system.css 最后加载，为唯一视觉源');
check(
  imports.indexOf('captcha.css') < imports.indexOf('design-system.css') &&
  imports.indexOf('oauth.css') < imports.indexOf('design-system.css'),
  'tdcap- / td-oauth- 独立组件先于设计系统，不被全站基线回压'
);
check(!/reverie\.css|liquid-glass\.css|theme-noxc\.css|noxc-node\.css|zerexa-simple\.css|components\.css|index\.css|responsive\.css|motion\.css/.test(main),
      'main.tsx 不再 import 任何历史层（8 层已合并进 shell.css）');
check((designCss.match(/!important/g) || []).length <= 190,
      '收口用 !important 只集中在唯一视觉源（≤190 条，不再散落 11 层）');
check(!/backdrop-filter/.test(shellCss), '结构层零毛玻璃（已在源头删除）');
check(!/gradient\([^;]*#(?!000\b)[0-9a-fA-F]{3,8}/.test(shellCss), '结构层点阵 / 壁纸渐变无硬编码色值（mask 遮罩的 #000 除外）');
check((shellCss.match(/var\(--zx-/g) || []).length > 300, '结构层颜色全部走 --zx-* 令牌');
const nodeLayer = designCss;
check(/--zx-blue:\s*#111318/.test(nodeLayer) && /零彩色/.test(nodeLayer),
  'Zerexa 实拍口径：强调令牌为中性墨，UI 零彩色（logo 图片资产仍保留原色）');
check(!/#f6f2e8|#2f5d45|#1c221d/.test(nodeLayer), '设计系统不残留羊皮纸 / 蕨绿旧色板');
check(!/#f6f2e8|#2f5d45/.test(read('src/html/reverieRootCss.ts')), '根域名页同步为节点色板');
check(!/#f6f2e8|#2f5d45/.test(read('src/html/docs.ts')), '服务文档页同步为节点色板');
const glass = shellCss;
check(/\.modal\s*\{/.test(glass), '结构层保留弹窗骨架');
check(/#toast\s*\{[^}]*background:\s*transparent/s.test(glass), '结构层保留透明 Toast 容器');
check(/transform:\s*translateX\(calc\(-100%/s.test(glass), '结构层保留移动端抽屉收起位移');
check(/body\.side-open \.sidebar\s*\{[^}]*transform:\s*translateX\(0\)/s.test(glass), '结构层保留移动端抽屉展开');
check(/prefers-reduced-motion:\s*reduce/.test(glass), '结构层尊重减少动态偏好');
/* 页头欢迎卡：四角全圆角，且不再残留直角细线框 */
const welcomeBlock = (glass.match(/\.welcome\s*\{[^}]*\}/s) || [''])[0];
check(/border-radius/.test(welcomeBlock) && !/border-radius:\s*0/.test(welcomeBlock), '欢迎卡为全圆角卡片');
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
const comp = read(SHELL);
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
check(/background:\s*var\(--lg-glass\)/.test(sideDock) && /position:\s*sticky/.test(sideDock), '固定按钮有实色底，滚动内容不会透字');
check(/'收起顶栏':\s*'Hide toolbar'/.test(read('src/app/lib/dict.en.ts')), '新增控制按钮有英文词条');
check(/\.side-toggle\s*\{[^}]*display:\s*none/.test(glass), '桌面/平板隐藏孤立汉堡按钮');
check(/#bellBtn/.test(runtime) && /insertBefore\(b, bell\)/.test(runtime), '主题按钮归入右侧图标组');
check(!/0 0 0 3px/.test(shellCss) && /inset 0 0 0 1px/.test(shellCss), '输入框聚焦为单层（无外部 3px 光环）');
check(/\.reg-field-head\s*\{[^}]*background:\s*transparent/s.test(glass), '字段标题不再叠第二层灰框');
/* 旧「淡绿描边 / 青瓷绿」口径已废弃：整站改 Noxc 冷白／墨黑／蓝，
   禁止任何绿或青绿字面量回流，毛玻璃必须由收口层全局关闭。 */
const allStyles = [
  ...css,
  DESIGN,
  'src/html/root-meoy.ts', 'src/html/root-v1.ts', 'src/html/reverieRootCss.ts',
].map((p) => read(p)).join('\n');
const legacyGreens = [
  /--lg-stroke:\s*rgba\(47,\s*125,\s*91/, /--bl-jade:\s*#2f8f83/,
  /--bl-cyan:\s*#6fc9c3/, /rgba\(111,\s*201,\s*195/,
  /rgba\(30,\s*52,\s*50/, /#0c1919\b/, /#101a15\b/, /#e8f3ec\b/,
];
check(legacyGreens.every((r) => !r.test(allStyles)), '全站零绿色／青绿色值（简约 logo 色）');
const sealCss = read(SHELL);
check(/backdrop-filter:\s*none/.test(designCss) && !/backdrop-filter/.test(shellCss),
       '唯一视觉源关闭毛玻璃，结构层在源头已删除');
check(/:not\(\.side-toggle\)/.test(shellCss), '汉堡按钮被排除出全局按钮基线（避免空灰块）');

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
check(/\.td-trans\.is-out\s*\{[^}]*pointer-events:\s*none/.test(read(SHELL)), '淡出期间放行交互，遮罩不多挡 340ms');

/* 11. 花束 Miku 壁纸 / 控制台 UI 重构 */
const runtimeJs = read('src/app/lib/runtime.ts');
const bloom = shellCss.split('from liquid-glass.css').pop() || '';
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
check(/html\[data-theme="dark"\] body[\s\S]{0,400}background:\s*transparent/.test(bloom), '深色 body 透明，壁纸不被盖住（A/B computed 背景一致）');
check(/html:not\(\[data-theme="dark"\]\)/.test(bloom) || /background-color/.test(bloom), '纸面底色在根元素统一');
check(!/--bl-jade:\s*#2f8f83/.test(bloom), '青瓷绿主色已换成 Noxc 蓝且不再回流');
check(/bl-petals/.test(bloom) && /prefers-reduced-motion/.test(bloom), '花瓣呼吸动效且尊重减少动态');
check(/\.bgswitch button/.test(bloom), '壁纸切换器为圆形缩略点');
check(/min-width:\s*620px/.test(bloom), '窄屏表格不再竖排断字');
check(imports.includes('shell.css') && imports.at(-1) === 'design-system.css',
  'design-system.css 为视觉权威层，结构与组件层都在其之前');

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
check(/\.page-root\[data-ready="0"\] \.main/.test(read(SHELL)) && /tdPageIn/.test(shellCss.split('from liquid-glass.css').pop() || ''), '未就绪时只藏内容区，就绪后整屏一次淡入（壁纸与玻璃框架照常可见）');


/* 13. 壁纸全站满铺：不再只有右下角一小块、不再把公共页整层隐藏 */
const fullWp = shellCss.split('from liquid-glass.css').pop() || '';
check(/background-size:\s*cover/.test(fullWp) && !/background-size:\s*auto\s+\d+vh/.test(fullWp), '主图 background-size: cover 满铺，不再 auto 84vh 只占右下角');
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
const icpCss = read(SHELL);
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
const rv = shellCss;
const rvHome = read('src/app/pages/Home.tsx');
const rvIcons = read('src/app/lib/icons.ts');
const rvLegacy = read('src/app/legacy/home.ts');
const rvDict = read('src/app/lib/dict.en.ts');
const rvPkg = read('package.json');
check(/--rv-paper:\s*var\(--zx-paper\)/.test(designCss) && /--rv-fern:\s*var\(--zx-blue\)/.test(designCss), 'Reverie 骨架令牌由唯一设计系统统一为 logo 色');
check(/html\[data-theme="dark"\]/.test(designCss) && /--zx-blue:\s*#f5f7fb/.test(designCss), '深色模式强调色为浅墨，纸面独立反相');
check(/\.rv-pill\.ink/.test(rv) && /\.rv-pill\.ink/.test(designCss), '墨黑药丸按钮（dark ink pill）');
check(/font-style:\s*normal\s*!important[\s\S]{0,220}color:\s*#7d838c/.test(designCss),
  '标题强调改为纯中性灰一档、不斜体（对齐 Zerexa 实拍）');
check(/rv-art[\s\S]{0,120}display:\s*none\s*!important/.test(designCss),
  '对齐实拍：画意卡隐藏，查询框为独立白底圆角长条');
check(/page-home\.page-reverie\.has-cloud #bg/.test(rv), '首页壁纸仍满铺，只是退成纸面底纹');
check(/\.rv-head a\.rv-mobile-cta\s*\{[^}]*display:\s*none/.test(rv) && /\.rv-head a\.rv-mobile-cta\s*\{[^}]*display:\s*inline-flex/.test(rv), '桌面顶栏不出现重复「注册」药丸，手机端才显示');
check(/@keyframes rvReveal/.test(rv) && /calc\(var\(--i, 0\) \* 80ms\)/.test(rv), 'React Bits / Anime.js 式 stagger 入场（纯 CSS，零依赖）');
check(/@keyframes rvDots/.test(rv), 'Uiverse 三点 loader 用于查询中');
check(/rvUnderline/.test(rv), 'Aceternity Hero Highlight 克制版细线扫光');
check(/:not\(\.side-toggle\)/.test(shellCss), '汉堡按钮仍被排除，桌面顶栏不出现空灰块');

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
check(/input:not\(\[type="checkbox"\]\)[\s\S]{0,200}font-size:\s*16px/.test(rv), '手机输入框 16px，iOS 聚焦不缩放');
check(/min-height: 44px/.test(rv), '手机触控目标 ≥44px');
check(/min-height:\s*44px/.test(rv) && /rv-pill\.sm[^}]*min-height:\s*44px/.test(designCss), 'sm 药丸 /「更多…」也 ≥44px（双类选择器不再盖过兜底）');
check(/\.lang button\{min-height:44px;min-width:44px\}/.test(read('src/html/reverieRootCss.ts')), '根域名页语言切换触控目标 ≥44px');
check(/overflow-x: auto !important/.test(rv), '表格在手机上横向可拖，不裁详情列');
check(/100dvh/.test(shellCss), '浮层用 dvh 跟随 iOS 地址栏');
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

/* 系统保留域名（ai / dash / nic 官方预留 + 后台可追加） */
const rvToml = read('wrangler.toml');
const rvLib = read('src/lib/reserved.ts');
const rvSub = read('src/routes/subdomains.ts');
const rvIndex = read('src/index.ts');
const rvAdminApi = read('src/routes/admin.ts');
const rvAdminUi = read('src/app/legacy/admin.ts');
const rsvDict = read('src/app/lib/dict.en.ts');
const rsvServerDict = read('src/lib/i18nServer.ts');
for (const l of ['ai', 'dash', 'nic']) {
  check(new RegExp(`['"]${l}['"]`).test(rvLib), `代码基线含 ${l}（不依赖环境变量是否被 CI 覆盖）`);
  check(new RegExp(`,${l},|${l}"`).test(rvToml), `wrangler 默认名单含 ${l}`);
}
check((rvSub.match(/reservedLabelsOf\(c\.env\)/g) || []).length === 1, '保留名单只在 lookupLabel 解析一次（一次申请不查两次库）');
check(/const isReserved = !!lk\.isReserved/.test(rvSub) && /isReserved,/.test(rvSub), '/check 与真正提交复用同一次判定结果');
check(!/c\.env\.RESERVED_LABELS/.test(rvSub), '注册链路不再各自解析 RESERVED_LABELS（避免两处口径不一致）');
check(/isAdmin/.test(rvSub) && /isReserved && !isAdmin/.test(rvSub), '管理员仍可自建保留域名');
check(/reservedLabels: \[\.\.\.\(await reservedLabelsOf\(c\.env\)\)\]/.test(rvIndex), '公开配置下发当前生效保留名单');
check(/reserved: await reservedOverview\(c\.env\)/.test(rvAdminApi), '后台设置返回基线 / 额外 / 生效三份清单');
check(/normalizeReservedExtra\(body\.reservedLabels\)/.test(rvAdminApi) && /admin\.reserved-labels/.test(rvAdminApi), '后台保存额外名单并写审计日志');
check(/id="sReservedLabels"/.test(rvAdminUi) && /reservedLabels: document\.getElementById\('sReservedLabels'\)/.test(rvAdminUi), '后台有保留域名输入框且随保存提交');
for (const k of ['额外保留名称', '该名称为系统保留，不可申请', '保留域名 · 管理员可用']) {
  check(rsvDict.includes(`'${k}'`), `英文词典含保留域名文案「${k}」`);
}
check(rsvServerDict.includes("'保留域名 · 管理员可用'"), '服务端词典含管理员可见的保留提示');

/* 注册滑块拼图验证：图库 / 三段式票据 / 后台开关 / 全链路接线 */
const cpCore = read('src/lib/captcha.ts');
const cpRoute = read('src/routes/captcha.ts');
const cpIndex = read('src/index.ts');
const cpSub = read('src/routes/subdomains.ts');
const cpAdminApi = read('src/routes/admin.ts');
const cpAdminUi = read('src/app/legacy/admin.ts');
const cpReg = read('src/app/pages/Register.tsx');
const cpLegacy = read('src/app/legacy/register.ts');
const cpComp = read('src/app/components/SliderCaptcha.tsx');
const cpCss = read('src/app/styles/captcha.css');
const cpMain = read('src/app/main.tsx');
const cpSchema = read('schema.sql');
const cpRuntime = read('src/app/lib/runtime.ts');
const cpDict = read('src/app/lib/dict.en.ts');
const cpServerDict = read('src/lib/i18nServer.ts');

for (const n of ['typhoon', 'meoy', 'miku', 'cloud', 'knob']) {
  check(fs.existsSync(path.join(root, `public/img/captcha/${n}.webp`)), `验证图库素材 ${n}.webp 存在`);
}
check(/captcha_nonce/.test(cpSchema) && /captcha_enabled', '1'/.test(cpSchema), 'D1 建一次性 nonce 表并写入默认开启');
check(/export async function captchaEnabled/.test(cpCore) && /captcha_images/.test(cpCore), '开关与图库子集读 settings，默认全开四张');
check(/validateTrace/.test(cpCore) && /uniformT/.test(cpCore), '拖动轨迹做轻量人形判定，挡掉直接 POST');
check(/markUsed\(env, 'c:'/.test(cpCore) && /markUsed\(env, 'p:'/.test(cpCore), 'challenge 与 pass 各消耗一次 nonce（防重放）');
check(/p\.scope !== captchaScope\(userId\)/.test(cpCore), 'pass 票据绑定用户 id，不能跨账号借用');
check(/issueRateOk/.test(cpRoute) && /429/.test(cpRoute), '领取挑战有频控，挡住脚本无限刷票据');
check(
  /app\.use\('\/api\/captcha', requireAuth\)/.test(cpIndex) &&
  /app\.use\('\/api\/captcha\/\*', requireAuth\)/.test(cpIndex),
  'captcha 独立前缀受 requireAuth 保护，未登录领不到挑战'
);
check(
  cpIndex.indexOf("app.route('/api/captcha', captchaRoutes)") >= 0 &&
  cpIndex.indexOf("app.route('/api/captcha', captchaRoutes)") < cpIndex.indexOf("app.route('/api', recordRoutes)"),
  'captcha 挂独立前缀且早于 recordRoutes 的 /subdomains/:id/verify'
);
/* 旧写法挂在 /api/subdomains 下，POST /captcha/verify 会被 records 的
   POST /subdomains/:id/verify 抢先命中，captcha 被当域名 id → 404「子域名不存在」，
   前端拿不到票据 → 按钮一直锁 → 重新滑 → 又 404，形成死循环。 */
check(
  /app\.post\('\/subdomains\/:id\/verify'/.test(read('src/routes/records.ts')) &&
  !/app\.route\('\/api\/subdomains', captchaRoutes\)/.test(cpIndex) &&
  !/\/api\/subdomains\/captcha/.test(cpComp) &&
  !/\/api\/subdomains\/captcha/.test(cpRoute),
  '验证接口已避开 /subdomains/:id/verify 同形路由（死循环根因）'
);
check(
  /\/api\/captcha\/challenge/.test(cpComp) && /\/api\/captcha\/verify/.test(cpComp) &&
  /app\.get\('\/challenge'/.test(cpRoute) && /app\.post\('\/verify'/.test(cpRoute),
  '前后端领取挑战 / 提交验证路径一致'
);
const brokenCaptcha = cpComp.replace('/api/captcha/verify', '/api/subdomains/captcha/verify');
check(
  !/\/api\/captcha\/verify/.test(brokenCaptcha) && brokenCaptcha !== cpComp,
  '反向对照：改回旧路径就会撞上 :id/verify，断言必须失败'
);
check(
  !/\/api\/subdomains\/mine/.test(cpLegacy) &&
  cpSub.indexOf("app.get('/mine', listMine)") >= 0 &&
  cpSub.indexOf("app.get('/mine', listMine)") < cpSub.indexOf("app.get('/:id'"),
  '待审查询不再撞 /:id，/mine 别名注册在 /:id 之前'
);
check(/jpeg\|webp\|ico/.test(cpIndex), '静态资源放行 .webp（验证图不会被根域名重定向截走）');
check(/captchaEnabled: await captchaEnabled\(c\.env\)/.test(cpIndex), '/api/config 下发开关，前后端同一份判定');
check(/consumePass\(c\.env, captchaToken, u\.id\)/.test(cpSub) && /if \(!isAdmin &&/.test(cpSub), '注册提交校验一次性票据，管理员开通豁免');
check(/captchaRequired/.test(cpRoute) && /err\.data = data/.test(cpRuntime), '验证失败可透传 captchaRequired，前端据此重新领图');
check(/captchaToken: cap \? cap\.get\(\) : ''/.test(cpLegacy) && /cap\.reset\(\)/.test(cpLegacy), '注册请求携带票据且提交后立即作废');
check(/id="sCaptchaEnabled"/.test(cpAdminUi) && /id="sCaptchaImages"/.test(cpAdminUi), '后台有验证开关与图库输入框');
check(
  /captchaEnabled: \(document\.getElementById\('sCaptchaEnabled'\) as HTMLInputElement\)\.checked/.test(cpAdminUi) &&
  /captchaImages: \(document\.getElementById\('sCaptchaImages'\) as HTMLInputElement\)\.value/.test(cpAdminUi),
  '后台「保存设置」把开关与图库一起提交（否则开关改不动）'
);
check(/body\.captchaEnabled !== undefined/.test(cpAdminApi) && /body\.captchaImages !== undefined/.test(cpAdminApi), '后台接口接收开关与图库并写审计');
check(/ALLOWED = \['typhoon', 'meoy', 'miku', 'cloud'\]/.test(cpAdminApi), '图库名按白名单过滤，管理员填错不会让验证图 404');
check(/items\.captcha_enabled = '1'/.test(cpAdminApi), '老库未跑迁移时后台显示实际生效的默认值');
check(/<SliderCaptcha key=/.test(cpReg) && /!isAdmin/.test(cpReg), '换域名重新出图，管理员不渲染验证组件');
check(/btn\.disabled = !!\(needed && !tokenRef\.current\)/.test(cpComp), '组件发布时同步按钮禁用态，首屏不会出现「看似可点却点不动」');
check(/onKeyDown/.test(cpComp) && /ArrowRight/.test(cpComp), '键盘方向键 + Enter 通道可用');
check(/验证已过期/.test(cpComp) && /换一张/.test(cpComp), '挑战过期自动换图，可手动换图');
check(/touch-action: none/.test(cpCss) && /min-height: 44px/.test(cpCss), '手机拖动不滚页面，触控目标 ≥44px');
check(/prefers-reduced-motion/.test(cpCss) && /html\[data-theme="dark"\] \.tdcap/.test(cpCss), '深色与减少动态都覆盖');
check(/^[\s\S]*\.tdcap/.test(cpCss) && !/\.btn[^-]/.test(cpCss), '组件层只用 tdcap- 前缀，不回压全站按钮');
check(/import '\.\/styles\/captcha\.css'/.test(cpMain), '组件样式层已挂载');
check(cpServerDict.includes("'请先完成滑块验证'") && cpDict.includes("'安全验证'"), '服务端与前端英文词条齐，英文模式不夹生');

/* 首页公开统计：注册人数 / 已开通域名，不新增首屏请求 */
const stHome = read('src/app/pages/Home.tsx');
const stLegacy = read('src/app/legacy/home.ts');
const stCss = shellCss;
const stLib = read('src/lib/publicStats.ts');
check(/data-stat-users/.test(stHome) && /data-stat-domains/.test(stHome) && /rv-stats/.test(stHome), '首页有注册人数 / 域名数展示位');
check(
  /publicStats: await publicStats\(c\.env\)/.test(cpIndex) && /app\.get\('\/api\/stats'/.test(cpIndex),
  '统计随 /api/config 同一次返回，另有独立只读接口（零新增首屏请求）'
);
check(
  /SELECT COUNT\(\*\) AS n FROM users/.test(stLib) && /status = 'approved'/.test(stLib) && /Promise\.all/.test(stLib),
  '口径：人数取 users 全量，域名数取 status=approved，两条 COUNT 并行'
);
check(
  /querySelectorAll\('\[data-stat-users\]'\)/.test(stLegacy) && /toLocaleString/.test(stLegacy) &&
  !/api\.get\('\/api\/stats'\)/.test(stLegacy),
  '数字千分位，且首页不再额外拉统计接口'
);
check(cpDict.includes("'注册人数'") && cpDict.includes("'已开通域名'"), '统计英文词条齐，英文模式不夹生');
check(/\.rv-stats/.test(stCss) && /max-width: 700px[\s\S]*\.rv-stats/.test(stCss), '手机断点覆盖统计区');

/* 深色可读性：--zx-blue-soft 是「深墨软背景」，不能当文字色 */
const dkCss = read('src/app/styles/design-system.css');
const dkShell = read('src/app/styles/shell.css');
const dkFix = dkCss.slice(dkCss.indexOf('深色可读性收口（2026-11-21 实拍回归）'));
check(dkFix.length > 1000, '深色可读性收口段存在且完整');
check(/--zx-blue-soft:\s*#1c222c/.test(dkCss) && /--zx-body:\s*#b6c0cf/.test(dkCss),
  '深色 --zx-blue-soft 仍是背景语义的深墨、--zx-body 是浅色正文');
/* shell.css 里 19 条历史规则把 --zx-blue-soft 当文字色；收口段必须逐类覆盖 */
const dkTextSelectors = [
  'stat-card .sc-num', 'stat-card .sc-lbl', 'stat-grid .stat', 'stat-v',
  'rv-term-body', 'nk-term-body', 'c-cmd', 'c-str', 'c-key', 'step i',
  'nk-fbottom b', 'notif-panel .np-tag', 'td-trans-bubble', 'top-search kbd',
  'input[disabled]',
];
for (const sel of dkTextSelectors) {
  check(dkFix.includes(`html[data-theme="dark"] ${sel}`) || dkFix.includes(sel),
    `深色文字收口覆盖 ${sel}`);
}
check(/html\[data-theme="dark"\][\s\S]{0,900}color:\s*var\(--zx-ink\) !important/.test(dkFix),
  '统计卡数字收口到最亮浅墨（实测 16.57:1）');
check(/html\[data-theme="dark"\][\s\S]{0,2200}color:\s*var\(--zx-body\) !important/.test(dkFix),
  '标签 / 代码 / 次要文字收口到次级浅灰（实测 9.68:1）');
check(/data-theme="dark"\] \.side-brand b[\s\S]{0,260}background: none !important/.test(dkFix) &&
      /-webkit-text-fill-color: var\(--zx-ink\)/.test(dkFix),
  '品牌名去掉渐变剪裁，深色下是纯浅墨实字');
check(/data-theme="dark"\] \.side-collapse[\s\S]{0,200}background: var\(--zx-paper-2\) !important/.test(dkFix),
  '收起侧边栏按钮补深色背景，不再露浏览器默认灰 #efefef');
check(/\.bgswitch button\.on[\s\S]{0,120}color: var\(--zx-paper-2\) !important/.test(dkFix),
  '壁纸切换选中态不再白字白底');
check(/html body \.quick-row \{\s*grid-template-columns: repeat\(auto-fit/.test(dkFix),
  '快捷入口改自适应列，7 个不必因写死 6 列而孤行');
check(/color:\s*var\(--zx-blue-soft\)/.test(dkShell),
  '结构层仍存在把 --zx-blue-soft 当文字色的历史规则（收口层必须保留，勿删）');

/* Zerexa Domains 实拍对齐：标题黑体 / 零彩色 / 四张特性卡 */check(/sc-ico[\s\S]{0,80}q-ico[\s\S]{0,220}background:\s*var\(--zx-blue-a8\)/.test(designCss),
  '统计卡 / 快捷入口装饰图标压成中性灰，真站零彩色');


const zxHome = read('src/app/pages/Home.tsx');
check(/zx-facts/.test(zxHome) && /zx-fact-v/.test(zxHome) &&
      (zxHome.match(/className="zx-fact"/g) || []).length === 4,
  '首页含真图同款四张特性卡（免费额度 / 开通时效 / 解析方式 / 有效期）');
check(/免费额度/.test(zxHome) && /开通时效/.test(zxHome) && /NS 委托/.test(zxHome) && /长期有效/.test(zxHome),
  '四张卡文案与实拍一致');
check(/font-weight:\s*900\s*!important/.test(designCss) && /letter-spacing:\s*-\.045em/.test(designCss),
  '标题为无衬线超粗黑体（900 / -.045em），不再是衬线');
check(!/#1667f2|#5b93ff|#0b47c4|#8ab4ff|#e8f0ff|#16233c/.test(designCss),
  '设计系统零品牌蓝字面量（纯黑白灰）');
check(/body\.page-home \.rv-head[\s\S]{0,160}background:\s*var\(--zx-paper\)/.test(designCss),
  '首页顶栏纯白 + 发丝线');
check(/rv-ask-btn[\s\S]{0,160}border-radius:\s*0/.test(designCss),
  '查询按钮为右侧直角黑块（真图圆角矩形右半）');

/* 更换邮箱：验证码发到新邮箱，验证通过即写入 */
const ecRoute = read('src/routes/profile.ts');
const ecMail = read('src/lib/mail.ts');
const ecPage = read('src/app/pages/Profile.tsx');
const ecCtrl = read('src/app/legacy/profile.ts');
const ecDict = read('src/app/lib/dict.en.ts');
const ecServerDict = read('src/lib/i18nServer.ts');
const ecSchema = read('schema.sql');
const ecReg = fs.existsSync(path.join(root, 'scripts/email-change-regression.ts'))
  ? read('scripts/email-change-regression.ts') : '';
check(/app\.post\('\/email\/send'/.test(ecRoute) && /app\.post\('\/email\/confirm'/.test(ecRoute),
  '资料路由提供发码与确认两个端点');
check(/EMAIL_CHANGE_SCENE = 'email_change'/.test(ecRoute) && /email_change/.test(ecSchema),
  '更换邮箱用独立验证码场景，与注册 / 重置密码隔离');
check(/email_change: \{ subject: '更换邮箱验证码'/.test(ecMail) && /meta\.action/.test(ecMail),
  '邮件模板按场景出「更换邮箱验证码」，不再误写「注册」');
check(/mailEnabled\(cfg\)/.test(ecRoute) && /mailNotConfigured/.test(ecRoute),
  '未配置邮件服务明确 503，不假装发送成功');
check(/blockedEmailDomain\(mail\)/.test(ecRoute) && !/signupEmailOk/.test(ecRoute),
  '换绑只保留硬性封禁域名，不套注册白名单 / edu 规则');
check(/mail === currentEmail/.test(ecRoute) && /SELECT id FROM users WHERE email = \?/.test(ecRoute),
  '拒绝与当前邮箱相同、以及已被其它账号占用的地址');
check(/60_000/.test(ecRoute) && /AND scene = \? ORDER BY id DESC LIMIT 1/.test(ecRoute),
  '同一新邮箱 60 秒内不重复发码');
check(/checkCode\(c\.env, mail, EMAIL_CHANGE_SCENE, code\)/.test(ecRoute),
  '确认时校验并消耗一次性验证码');
check(/SELECT id FROM users WHERE email = \? AND id <> \?/.test(ecRoute),
  '确认前二次查占用，挡发码到确认之间被抢注');
check(/UPDATE users SET email = \? WHERE id = \?/.test(ecRoute) &&
      /UPDATE oauth_quota_grants SET email = \?/.test(ecRoute),
  '写入 users.email，并同步 /status 的 NodeLoc 领取记录邮箱');
check(/user\.email_change/.test(ecRoute) && /notify\(/.test(ecRoute),
  '换绑写审计日志并发站内通知');
check(/id="btnChangeMail"/.test(ecPage) && /btnChangeMail/.test(ecCtrl),
  '个人资料「安全设置」有更换邮箱入口');
check(/api\.post\('\/api\/profile\/email\/send'/.test(ecCtrl) &&
      /api\.post\('\/api\/profile\/email\/confirm'/.test(ecCtrl) &&
      /btnChgSend/.test(ecCtrl) && /btnChgOk/.test(ecCtrl),
  '弹窗里新邮箱 + 发码 + 验证码 + 确认四件套齐全');
check(/refreshRuntime\(\)/.test(ecCtrl) && /await load\(\)/.test(ecCtrl),
  '成功后刷新资料卡与全局用户态，页面仍显示旧邮箱的 bug 被挡住');
check(!/暂不支持自助修改/.test(ecPage), '旧「暂不支持自助修改」提示已移除');
for (const k of ['更换邮箱', '发送验证码', '确认更换', '邮箱已更换，下次请用新邮箱登录']) {
  check(ecDict.includes(`'${k}'`), `英文词典含更换邮箱文案「${k}」`);
}
for (const k of ['新邮箱不能与当前邮箱相同', '该邮箱已被其它账号使用', '邮箱更新失败，请稍后重试']) {
  check(ecServerDict.includes(`'${k}'`), `服务端词典含错误提示「${k}」`);
}
check(ecReg.length > 3000 && /更换邮箱回归/.test(ecReg) && /不套注册白名单/.test(ecReg),
  '专项回归脚本覆盖完整换绑链路与注册白名单豁免');
check(/modal-card \.field input:not/.test(read('src/app/styles/design-system.css')),
  '弹窗输入框压回纸面，不被历史层染成 30% 墨灰（组件样式，不动全局几何）');

/* NodeLoc OAuth 2.0 接入：把踩过的坑固化成阻断断言 */
const nlSchema = read('schema.sql');
const nlLib = read('src/lib/nodeloc.ts');
const nlRoute = read('src/routes/nodeloc.ts');
const nlIndex = read('src/index.ts');
const nlAdminApi = read('src/routes/admin.ts');
const nlAdminUi = read('src/app/legacy/admin.ts');
const nlLogin = read('src/app/pages/Login.tsx');
const nlLoginCtrl = read('src/app/legacy/index.ts');
const nlProfile = read('src/app/pages/Profile.tsx');
const nlProfileCtrl = read('src/app/legacy/profile.ts');
const nlCss = read('src/app/styles/oauth.css');
const nlDict = read('src/app/lib/dict.en.ts');
const nlI18n = read('src/app/lib/i18n.ts');
const nlServerDict = read('src/lib/i18nServer.ts');

check(/CREATE TABLE IF NOT EXISTS oauth_bindings/.test(nlSchema) && /UNIQUE\(provider, sub\)/.test(nlSchema), 'D1 建绑定表且 provider+sub 唯一');
check(/CREATE TABLE IF NOT EXISTS oauth_states/.test(nlSchema) && /'nodeloc_enabled', '0'/.test(nlSchema), 'D1 建一次性 state 表且默认关闭');
check(/www\.nodeloc\.com\/oauth-provider\/authorize/.test(nlLib) && /oauth-provider\/token/.test(nlLib) && /oauth-provider\/userinfo/.test(nlLib), '三个端点与官方对接文档一致');
check(/NODELOC_USERINFO_LEGACY/.test(nlLib) && /NODELOC_USERINFO_LEGACY/.test(nlRoute), '官方小写 userinfo 优先，旧拼写 userInfo 兜底');
check(/scopeEmailOn = true/.test(nlLib) && /scope: 'openid profile email'/.test(nlLib),
  'email 权限恒开不可关闭，授权 scope 必带 email');
check(/nodeloc_scope_email_v2/.test(nlSchema) && /nodeloc_scope_email', '1'/.test(nlSchema), '旧库 email 权限 0 一次性升级为 1');
check(/state !== cookieState\(c\)/.test(nlRoute) && /consumeState\(c, state\)/.test(nlRoute), 'state 同时校验 Cookie 与 D1，挡 CSRF');
check(/DELETE FROM oauth_states WHERE state = \? AND exp >= \? RETURNING/.test(nlRoute), 'state 一次性原子领取，挡重放');
check(/client_secret: cfg\.clientSecret/.test(nlRoute) && /Authorization: `Basic/.test(nlRoute), 'Secret 只在服务端换 token，且兼容 Basic 认证');
check(/function extractEmail/.test(nlRoute) && /async function emailSub/.test(nlRoute) && /只有邮箱时由邮箱派生/.test(nlRoute),
  '资料读取只必需 email：多路径取值、缺 sub 由邮箱派生稳定标识');
check(/防账号接管/.test(nlRoute) && /st\.mode === 'bind'/.test(nlRoute), '不拿 userinfo 邮箱认领已有账号，绑定只由本人发起');
check(/oauth:disabled:/.test(nlRoute) && !/pseudoEmail|nl\.\$\{hex\}@oauth\.local/.test(nlRoute),
  '不再生成乱码内部邮箱；OAuth 账号仍无可用密码');
check(
  nlIndex.indexOf("app.route('/api/auth/nodeloc', nodelocRoutes)") < nlIndex.indexOf("app.route('/api/auth', authRoutes)"),
  'OAuth 路由先于 /api/auth 挂载，否则会被子应用吞成 404'
);
check(/nodelocEnabled: await nodelocEnabled\(c\.env\)/.test(nlIndex) && !/clientSecret:/.test(nlIndex), '公开配置只下发开关，不下发任何密钥');
check(/'nodeloc_client_secret'\]/.test(nlAdminApi) && /body\.nodelocClientSecret/.test(nlAdminApi), '后台 Secret 只回掩码、留空不覆盖');
check(/id="sNodelocEnabled"/.test(nlAdminUi) && /id="sNodelocClientId"/.test(nlAdminUi) && /id="sNodelocClientSecret"/.test(nlAdminUi), '后台有开关与两个凭据输入框');
check(/nodelocClientId: document\.getElementById\('sNodelocClientId'\)\.value/.test(nlAdminUi), '后台「保存设置」提交凭据，开关不会改不动');
check(/id="nodelocWrap" hidden/.test(nlLogin) && /cfg\.nodelocEnabled/.test(nlLoginCtrl), '登录按钮默认隐藏，只有开关齐备才显示');
check(/id="btnNodelocBind"/.test(nlProfile) && /nodelocStartUrl\('\?bind=1'\)/.test(nlProfileCtrl), '个人资料可绑定 / 解绑 NodeLoc');
check(/使用 NodeLoc 登录/.test(nlDict) && /回调地址必须是以 https:\/\//.test(nlServerDict), '前后端英文词条齐，不夹生');
check(/min-height: 44px/.test(nlCss) && /data-theme="dark"/.test(nlCss) && /prefers-reduced-motion/.test(nlCss), '按钮 ≥44px、深色与减少动态都覆盖');
check(/html\[data-theme="dark"\][\s\S]{0,220}color:\s*var\(--zx-ink\)/.test(nlCss),
  '深色按钮文字用浅墨而非深蓝底令牌，保证可读');

check(/CREATE TABLE IF NOT EXISTS oauth_quota_grants/.test(nlSchema) && /UNIQUE\(provider, user_id\)/.test(nlSchema),
  'D1 建绑定奖励领取表，provider+user_id 唯一');
check(/NODELOC_BIND_QUOTA_BONUS = 5/.test(nlLib), '绑定奖励固定为 +5 配额');
check(/INSERT OR IGNORE INTO oauth_quota_grants/.test(nlRoute) && /meta\?\.changes \|\| 0\) > 0/.test(nlRoute),
  '奖励用 INSERT OR IGNORE 原子领取，只发一次');
check(/UPDATE users SET quota = \? WHERE id = \?/.test(nlRoute) && /role\) === 'admin' \|\| Number\(u\.quota\) < 0/.test(nlRoute),
  '配额累加，且跳过管理员与 -1 不限量账号');
check(/oauth=bound&bonus=/.test(nlRoute) && /配额 \+/.test(nlProfileCtrl), '绑定成功把实际奖励数带回页面并提示');
check(/NodeLoc 账号已绑定，配额 \\\+\(\\d\+\)/.test(nlI18n) && /st\.email/.test(nlProfileCtrl),
  '动态奖励文案有英文映射，个人资料页显示读到的邮箱');

/* NodeLoc 账号必须用真实邮箱：不再造 nl.<hex>@oauth.local 乱码，存量自动回填 */
check(!/nl\.\$\{hex\}@oauth\.local/.test(nlRoute) && !/return `nl\./.test(nlRoute),
  '源码里不再有任何生成 @oauth.local 内部邮箱的路径');
check(/const mail = String\(info\.email \|\| ''\)\.trim\(\)\.toLowerCase\(\)/.test(nlRoute) &&
      /email_blocked/.test(nlRoute) && /email_taken/.test(nlRoute),
  '自动建号直接用 NodeLoc 真实邮箱，且拒绝被封域名 / 已占用邮箱（防接管）');
check(/if \(!email\) return \{ __noEmail: true \}/.test(nlRoute) &&
      /if \(info\.__noEmail\) return back\(c, 'email_required'\)/.test(nlRoute),
  '拿不到邮箱就明确拒绝，不静默降级成乱码账号');
check(/async function repairOauthEmail/.test(nlRoute) && /await repairOauthEmail\(c, Number\(binding\.user_id\), info\.email\)/.test(nlRoute),
  '存量 nl.<hex>@oauth.local 账号下次登录回填真实邮箱');
check(/isOauthInternalEmail\(String\(u\.email \|\| ''\)\)/.test(nlRoute) &&
      /SELECT id FROM users WHERE email = \? AND id <> \?/.test(nlRoute),
  '回填只针对内部占位邮箱，且绝不覆盖其它账号已占用的邮箱');
check(/misBanned/.test(nlRoute) && /status = 'active', ban_reason = NULL/.test(nlRoute),
  '被密码登录误封的 NodeLoc 账号在回填时一并恢复');
check(/export function isOauthInternalEmail/.test(read('src/lib/emailRule.ts')) &&
      /isOauthInternalEmail\(mail\)/.test(read('src/routes/auth.ts')),
  '密码登录豁免 NodeLoc 内部账号，不再就地封禁导致 OAuth 登录被锁');
check(/void scopeEmail/.test(nlLib) && /nodeloc_scope_email', '1'/.test(nlAdminApi),
  '后台保存把 email 权限恒写 1，旧设置不再生效');
check(!/sNodelocScopeEmail/.test(nlAdminUi), '后台不再提供关闭 email 权限的开关');
for (const code of ['email_required', 'email_taken', 'email_blocked']) {
  check(nlLoginCtrl.includes(`${code}:`) && nlRoute.includes(`'${code}'`) && nlDict.includes(code === 'email_required'
    ? '未能读取 NodeLoc 邮箱' : code === 'email_taken' ? '该邮箱已在本站注册' : 'NodeLoc 返回的邮箱域名'),
    `错误码 ${code} 前后端与英文词典齐`);
}


/* HTTPS 强制 + 官方 logo：NodeLoc 只接受 HTTPS 回调，登录 / 绑定 / 回调全链路归一 */
const nlUrl = read('src/app/lib/oauthUrl.ts');
check(/nodelocStartUrl\(\)/.test(nlLogin) && /https:\/\/\$\{host\}/.test(nlUrl),
  '登录按钮 href 为 https 绝对地址（仍走站内 /start 生成一次性 state）');
check(/nodelocStartUrl\('\?bind=1'\)/.test(nlProfileCtrl), '个人资料绑定入口同为 https 绝对地址');
check(!/href="\/api\/auth\/nodeloc\/start"/.test(nlLogin) &&
      !/location\.href = '\/api\/auth\/nodeloc\/start/.test(nlProfileCtrl),
  '登录 / 绑定不再留 http 相对路径明文');
check(!/href="https:\/\/www\.nodeloc\.com\/oauth-provider\/authorize/.test(nlLogin),
  '按钮不直连 provider authorize（否则 state / Cookie / D1 校验失效）');
check(/u\.protocol = 'https:'/.test(nlLib) && /httpsCallbackUrl\(c\)/.test(nlAdminApi),
  '回调地址在服务端强制 https，后台展示与授权请求同源');
check(nlAdminApi.includes('!/^https:\\/\\//i.test(r)'),
  '后台自定义回调只接受 https://，http:// 一律拒绝');
check(!/http:\/\/www\.nodeloc\.com/.test(nlLib + nlRoute + nlAdminApi + nlAdminUi + nlIndex),
  'NodeLoc 端点零 http 明文');
check(/nodeloc-logo\.png/.test(nlLogin) &&
      fs.existsSync(path.join(root, 'public/img/nodeloc-logo.png')),
  '登录按钮使用官方 NodeLoc logo（透明 PNG 已入库）');
check(!/td-oauth-mark">NL</.test(nlLogin) && /td-oauth-mark img/.test(nlCss),
  'NL 文字占位移除，徽标样式改为图片');

/* 提交后弹窗验证 + DNSHE 一键 NS：把这次两个真因固化成阻断断言 */
const mdReg = read('src/app/pages/Register.tsx');
const mdLegacy = read('src/app/legacy/register.ts');
const mdComp = read('src/app/components/SliderCaptcha.tsx');
const mdCss = read('src/app/styles/captcha.css');
const mdRec = read('src/lib/records.ts');
const mdIndex = read('src/index.ts');
const mdDomain = read('src/app/legacy/domain.ts');
const mdDomainPage = read('src/app/pages/Domain.tsx');
const mdDict = read('src/app/lib/dict.en.ts');
const mdI18n = read('src/app/lib/i18n.ts');

check(
  /__TD_CAPTCHA_OPEN__/.test(mdLegacy) && /open\(function\(\)\{ doSubmit\(\); \}/.test(mdLegacy) &&
  mdLegacy.indexOf('__TD_CAPTCHA_OPEN__') > mdLegacy.indexOf("getElementById('btnApply').onclick"),
  '只有点击「提交注册」且票据为空才打开弹窗，验证通过回调继续提交'
);
check(
  mdReg.indexOf('{capOpen &&') > mdReg.indexOf('id="toast"') &&
  mdReg.indexOf('{capOpen &&') > mdReg.indexOf('</main>'),
  '弹窗挂在所有 reg-pane / main 之外，刷新与直接进页面都不会出现'
);
check(
  /\{capOpen && !isAdmin && \(/.test(mdReg) && /<SliderCaptcha key=/.test(mdReg),
  '管理员不渲染验证，每次打开用新 key 重新领图'
);
check(
  /__TD_CAPTCHA_TICKET__/.test(mdComp) && /__TD_CAPTCHA_TICKET__/.test(mdLegacy) &&
  !/delete \(window as any\)\.__TD_CAPTCHA_TICKET__/.test(mdComp),
  '票据持久挂在 window，弹窗卸载后提交仍读得到，清理时只删旧读取口'
);
const brokenTicket = mdComp.replace(/__TD_CAPTCHA_TICKET__/g, '__TD_CAPTCHA__');
check(
  !/__TD_CAPTCHA_TICKET__/.test(brokenTicket) && brokenTicket !== mdComp,
  '反向对照：票据不持久时弹窗一关就丢，断言必须失败'
);
check(
  /enabled === false/.test(mdComp) && /onSkip/.test(mdComp) && /onSkip/.test(mdReg),
  '后台关闭验证时弹窗直接放行，不制造死路'
);
check(
  /modal/.test(mdComp) && /if \(btn && !modal\) btn\.disabled/.test(mdComp),
  '弹窗模式不预先锁死提交按钮（按钮就是打开验证的入口）'
);
check(
  /\.tdcap-overlay/.test(mdCss) && /\.tdcap-dialog/.test(mdCss) && /min-height: 44px/.test(mdCss),
  '弹窗遮罩 / 对话框 / 44px 关闭按钮齐备，手机可点'
);
check(
  /html\[data-theme="dark"\] \.tdcap-dialog/.test(mdCss) &&
  /prefers-reduced-motion[\s\S]*\.tdcap-overlay/.test(mdCss),
  '弹窗深色与减少动态都覆盖'
);
check(
  /CAPTCHA_ENABLED/.test(mdLegacy) && /cfg\.captchaEnabled/.test(mdLegacy) &&
  /captchaEnabled: await captchaEnabled\(c\.env\)/.test(mdIndex),
  '是否弹窗与后端注册接口读同一份 /api/config 判定'
);
check(
  /ns1\.dnshe\.org/.test(mdRec) && /ns2\.dnshe\.org/.test(mdRec) &&
  /HOSTING_NS_PRESETS/.test(mdRec),
  'DNSHE 托管 NS 预设为用户给出的两台服务器'
);
const mdDelegation = read('src/lib/delegation.ts');
check(
  /ns: \['ns1\.dnshe\.com', 'ns2\.dnshe\.com'\]/.test(mdDelegation) &&
  /api005\.dnshe\.com/.test(mdDelegation) && /注册分发|专属于/.test(mdDelegation),
  '委派页保留 .com：专属于 DNSHE 注册域名的 NS / API 端点；一键托管的 .org 预设另算'
);
check(
  /NS: \{/.test(mdRec) && /case 'NS'/.test(mdRec) &&
  /TYPE_NAMES = Object\.keys\(RECORD_TYPES\)/.test(mdRec),
  'NS 就是普通 DNS 记录类型，走同一套类型清单与校验'
);
check(/hostingNsPresets: HOSTING_NS_PRESETS/.test(mdIndex), '预设随 /api/config 下发，前端不写死服务器名');
check(
  /data-ns-preset/.test(mdDomain) && /type: 'NS', host: '@'/.test(mdDomain) &&
  /\/api\/subdomains\/' \+ subId \+ '\/records/.test(mdDomain),
  '一键按钮走同一个 DNS 记录接口，在 @ 写入两条 NS'
);
const mdSlice = mdDomain.slice(mdDomain.indexOf('async function addHostingNs'), mdDomain.indexOf('function renderRecords'));
check(
  mdSlice.length > 0 && !/delegation/.test(mdSlice),
  '一键功能不另建托管表 / 不走独立接口，NS 记录可编辑可删除'
);
check(
  /const dup = records\.some/.test(mdDomain) && /已有相同 NS 记录，已跳过/.test(mdDomain),
  '幂等：重复点击不会写出重复 NS'
);
check(
  /NS 记录也是普通 DNS 记录/.test(mdDomainPage) && /一键添加 DNSHE NS/.test(mdDict) &&
  /已添加 \(\\d\+\) 条 NS 记录/.test(mdI18n),
  '页面说明、英文词条与动态数量句式都齐，英文模式不夹生'
);

/* 站内服务文档入口：导航 / 页脚 / 根域名页 / 静态导出都要指向 /docs */
const docIndex = read('src/index.ts');
const docRuntime = read('src/app/lib/runtime.ts');
const docHome = read('src/app/pages/Home.tsx');
check(
  /href="\/docs"/.test(docRuntime) && /href="\/docs"/.test(docHome) &&
  /服务文档/.test(mdDict),
  '控制台 / 首页 / 英文词条都有服务文档入口'
);
check(
  /data-go="\/docs"/.test(read('src/html/root-meoy.ts')) &&
  /data-go="\/docs"/.test(read('src/html/root-v1.ts')),
  '两个根域名页也挂服务文档入口'
);
check(
  /docs\.html/.test(read('scripts/emit-static-pages.ts')),
  '静态托管也能一键导出 docs.html'
);

/* 服务文档静态直出页：TypeScript 模板 + 8 张截图 + 图 7→图 8 的关键一步 */
const docStatic = read('src/html/docs.ts');
const docApp = read('src/app/App.tsx');
check(
  !/'\/docs'\s*:\s*[A-Za-z]+Page/.test(docApp) && !/import DocsPage/.test(docApp),
  '/docs 不注册成 SPA 路由：站内链接整页跳到直出页，不会被拦截成首页'
);
check(
  /import \{ docsHtml \} from '\.\/html\/docs\.js'/.test(docIndex) &&
  /path === '\/docs' \|\| path === '\/docs\.html'/.test(docIndex) &&
  /c\.html\(docsHtml\)/.test(docIndex),
  '/docs 由 TypeScript 模板在 Worker 直出，不经 SPA / 不发首屏接口'
);
check(
  /<style>/.test(docStatic) && /<\/style>/.test(docStatic) &&
  /data-en=/.test(docStatic) && /viewport/.test(docStatic) &&
  !/<script[^>]+src="https?:/.test(docStatic),
  '文档页自带样式 / 中英词条 / 手机 viewport，不依赖外部字体与脚本'
);
check(
  Array.from({ length: 8 }, (_, i) => i + 1).every((n) =>
    new RegExp('fig' + n + '\\.png').test(docStatic) &&
    fs.existsSync(path.join(root, 'public/img/docs/fig' + n + '.png'))),
  '图 1～图 8 全部引用且八张截图都在 public/img/docs 下'
);
const staticBridge = docStatic.slice(docStatic.indexOf('fig7.png'), docStatic.indexOf('fig8.png'));
check(
  /Add DNS records/.test(docStatic) && /Check again/.test(docStatic) &&
  /Cancel/.test(docStatic) && staticBridge.length > 0 &&
  /Add DNS records/.test(staticBridge) && /Check again/.test(staticBridge),
  '文档明确写出：图 7 必须点 Add DNS records 才会出现图 8'
);
check(
  /ns1\.dnshe\.org/.test(docStatic) && /ns1\.dnshe\.com/.test(docStatic) &&
  /专属于在 DNSHE 注册的域名/.test(docStatic) && /api005\.dnshe\.com/.test(docStatic),
  '静态文档同样写清 .org / .com 两套 NS 与 API 网关区别'
);
const staticNoBridge = docStatic.replace(/Add DNS records/g, 'Check again');
check(
  !/Add DNS records/.test(staticNoBridge) && staticNoBridge !== docStatic,
  '反向对照：拿掉 Add DNS records，静态文档断言必须失败'
);

/* 首推后缀不得改写主域名 / 默认 Zone：曾误把 ROOT_DOMAIN 改成 noxc.uk，
   meoy.top 不再回落现有 CF_ZONE_ID，后台被迫重新配置主域名。 */
const wranglerToml = read('wrangler.toml');
check(/ROOT_DOMAIN = "meoy\.top"/.test(wranglerToml), '主域名仍为 meoy.top（首推只改展示排序）');
check(!/ROOT_DOMAIN = "noxc\.uk"/.test(wranglerToml), '默认根域名没有被首推后缀覆盖');
check(/preferNoxc/.test(read('src/app/legacy/home.ts')), 'noxc.uk 仍排在后缀选择器首位');
for (const f of ['public/img/logo.jpg', 'public/img/logo.png', 'public/favicon.ico',
                 'public/img/apple-touch-icon.png', 'public/img/og-image.png', 'public/manifest.webmanifest']) {
  check(fs.existsSync(path.join(root, f)), `Noxc 品牌资源存在 ${f}`);
}

/* 主 logo 去掉下方 NOXC 字样后：静态页内联图标必须与 /img/favicon.png 同源，
   否则会出现「站内换了图、两个根域名页和文档页仍是旧图标」。 */
const inlineFavicon = fs.readFileSync(path.join(root, 'public/img/favicon.png')).toString('base64');
for (const f of ['src/html/root-meoy.ts', 'src/html/root-v1.ts', 'src/html/docs.ts']) {
  check(read(f).includes(`data:image/png;base64,${inlineFavicon}`), `内联 favicon 已同步为新图形 ${f}`);
}
for (const f of ['public/img/logo-transparent.png', 'public/img/logo-light.png']) {
  check(fs.existsSync(path.join(root, f)), `主 logo 备用版存在 ${f}`);
}
check(/logo-light\.png/.test(shellCss), '深色主题已切到反白 logo');

/* 语言切换按钮曾靠 padding + normal 行高凑 44px，字体异步加载时会落到 43.x
   亚像素，手机端触控目标回归偶发失败。改成固定盒模型后必须保持。 */
for (const f of ['src/html/root-meoy.ts', 'src/html/root-v1.ts']) {
  const css = read(f);
  check(/\.lang button\{[^}]*min-height:44px[^}]*display:inline-flex/.test(css),
    `${f} 语言按钮为固定 44px 盒模型（不依赖字体行高）`);
}

for (const m of ok) console.log('  ✓ ' + m);
for (const m of errors) console.error('  ✗ ' + m);
console.log(`健康巡检：${ok.length} 通过，${errors.length} 失败`);
if (errors.length) process.exit(1);
