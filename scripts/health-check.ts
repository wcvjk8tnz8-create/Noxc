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

/* 4. 样式层架构：5 层，design-system.css 是颜色权威层，形态层最后加载。
      历史 11 层（含 Reverie / 液态玻璃 / 节点 / 收口层）已按原顺序合并进 shell.css，
      颜色全部令牌化；渐变、毛玻璃、阴影在源头删除，不再靠 !important 层层压盖。 */
const main = read('src/app/main.tsx');
const imports = [...main.matchAll(/import\s+['"]\.\/styles\/([^'"]+)['"]/g)].map((m) => m[1]);
const ORDER = ['shell.css', 'captcha.css', 'oauth.css', 'design-system.css', 'nodeloc-skin.css'];
check(imports.length === 5, `样式入口恰好 5 层（实际 ${imports.length}：${imports.join(', ')})`);
check(imports.slice(0, 4).join(',') === ORDER.slice(0, 4).join(','),
  '4 层加载顺序固定：结构 → 独立组件 → 设计系统（形态层另算）');
check(imports.at(-1) === 'nodeloc-skin.css'
  && imports.indexOf('design-system.css') < imports.indexOf('nodeloc-skin.css'),
  'design-system.css 仍是颜色权威层；形态层 nodeloc-skin.css 最后加载且不改颜色');
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
check(/#f6f2e8|#2f5d45/.test(read('docs-src/.vitepress/theme/custom.css')) === false
  && /--vp-c-brand-1/.test(read('docs-src/.vitepress/theme/custom.css')),
  'VitePress 文档皮肤同步为 Zerexa 零彩色（无羊皮纸 / 蕨绿）');
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
const spaSharedEarly = read('src/lib/spaRoutes.ts');
check(/'login'/.test(spaSharedEarly)
  && /out\.push\('\/' \+ name, '\/' \+ name \+ '\.html'\)/.test(spaSharedEarly),
  'SPA 回落清单由唯一来源生成，自动包含 /login.html');
check(/zx-nav-cta"\s+href="\/register"/.test(read('src/app/pages/Home.tsx')), '主页 CTA 指向注册页');
check(!/href="\/">登录/.test(runtime) && !/location\.href\s*=\s*'\/\?login=1'/.test(runtime), '不再有把根路径当登录页的入口');
check(/\/login\?q=/.test(read('src/app/legacy/whois.ts')) && /href="\/login"/.test(read('src/app/legacy/report.ts')), 'WHOIS / 举报的登录链接指向 /login');

/* 9. 切页过渡已移除：点击立即换页，不再延后导航 / 预热素材 / 播动画 */
const main9 = read('src/app/main.tsx');
const app9 = read('src/app/App.tsx');
const prefetch9 = read('src/app/lib/prefetch.ts');
const shell9 = read('src/html/spa.ts');
check(!fs.existsSync(path.join(root, 'src/app/lib/pageTransition.ts')),
  '过渡模块已删除，不再打进前端包');
check(!/pageTransition|mountTransition|beginTransition|endTransition/.test(
  main9 + app9 + read('src/app/lib/runtime.ts')),
  '入口 / App / runtime 不再引用任何过渡 API');
check(/void prefetchRoute\(href\);\s*navigate\(href\)/.test(app9),
  '站内链接并行预取后立即 navigate，不再延后 200~1400ms');
check(!/beginTransition|useRef\(key\)|prevKey/.test(app9), 'App 不再有路由过渡驱动');
check(/waitPrefetched/.test(prefetch9) && /waitPrefetched\(p\)/.test(read('src/app/lib/runtime.ts')),
  '立即换页后 api.get 复用在飞的预取，零重复请求');
check(/if \(!e \|\| !e\.ok\) return null/.test(prefetch9) && /e\.promise/.test(prefetch9),
  '在飞预取不再被 takePrefetched 提前丢弃');
check(!/td-trans|td-miku|miku-pop/.test(read(SHELL))
  && !/td-trans/.test(read('src/app/styles/design-system.css')),
  'CSS 里的过渡遮罩 / 角色样式已删除');
check(fs.existsSync(path.join(root, 'public/_headers'))
  && /max-age=31536000, immutable/.test(read('public/_headers')),
  '静态资源长缓存：带 hash 的 assets immutable');

/* 9b. DC 积分优惠码：注册域名时抵扣（不是充值） */
const dcLib = read('src/lib/discountCode.ts');
const dcSub = read('src/routes/subdomains.ts');
const dcReg = read('src/app/legacy/register.ts');
const dcRegPage = read('src/app/pages/Register.tsx');
check(/export async function resolveDiscountCode/.test(dcLib)
  && /export async function consumeDiscountCode/.test(dcLib)
  && /export async function rollbackDiscountCode/.test(dcLib),
  'DC 码解析 / 消耗 / 回滚三步集中在一处');
check(/Math\.min\(base\.payable, value\)/.test(dcLib),
  '只抵本次应付部分，不找零、不把面值变现成余额');
check(/resolveDiscountCode\(c\.env\.DB, discountCode, u\.id, cost\)/.test(dcSub)
  && /-payable/.test(dcSub) && /discountInvalid/.test(dcSub),
  '注册接口按「实付」判余额与扣分，券无效有明确标志');
check(/if \(useDiscount\) await rollbackDiscountCode/.test(dcSub),
  '域名唯一约束撞车时回滚券');
check(/&discountCode=/.test(dcReg) && /discountCode: dcValue\(\)/.test(dcReg)
  && /id="discountCode"/.test(dcRegPage),
  '注册页可填 DC 码：查价与提交都带上');
const dcCI = read('.github/workflows/deploy.yml');
check(/discount-code-regression\.ts/.test(dcCI),
  'DC 码注册抵扣专项回归进 CI');
check(/node-version: 24[\s\S]{0,400}discount-code-regression\.ts[\s\S]{0,400}node-version: 20/.test(dcCI),
  'CI 在 DC 抵扣回归处临时切 Node 24（node:sqlite 真跑 schema）并切回 20 构建部署');

/* 9b. 奖励中心：已生成的券可编辑（用量 / 面值 / 有效期 / 备注） */
const rcRedeem = read('src/routes/redeem.ts');
const rcCtrl = read('src/app/legacy/rewards.ts');
const rcPage = read('src/app/pages/Rewards.tsx');
const rcI18n = read('src/lib/i18nServer.ts');
check(/app\.put\('\/admin\/:id'/.test(rcRedeem)
  && /redeem\.edit/.test(rcRedeem)
  && /AND used_count <= \?/.test(rcRedeem) && /AND used_count = \?/.test(rcRedeem),
  '编辑券接口存在：部分更新 + 审计 + 两类并发兜底');
check(/data-ed=/.test(rcCtrl) && /api\.put\('\/api\/redeem\/admin\/'/.test(rcCtrl)
  && /id="eMax"/.test(rcPage) && /id="eUsed"/.test(rcPage) && /id="eExpiry"/.test(rcPage),
  '奖励中心列表有编辑按钮与总用量 / 已用量 / 到期表单');
check(/券刚被使用过，请刷新列表后重试/.test(rcI18n)
  && /已用量（/.test(rcI18n), '编辑券的服务端提示有英文词条');
check(/rewards-regression\.ts/.test(read('.github/workflows/deploy.yml')),
  '组合任务 / DC 码 / 编辑券专项回归进 CI');

/* 10. 根域名静态页：过渡同步移除，查询框改为立即跳 WHOIS */
const rootPages = [
  ['meoy.top.html', 'src/html/root-meoy.ts'],
  ['v-1.top.html', 'src/html/root-v1.ts'],
];
for (const [f, src] of rootPages) {
  const rp = read(src);
  check(!/tdTransition|td-trans|miku-pop|nav-intent/.test(rp), `${f} 过渡层 / 素材预热已移除`);
  check(/checker"\)\.addEventListener\("submit"/.test(rp) && /location\.href = PANEL/.test(rp),
    `${f} 查询框提交仍跳 WHOIS，且改为立即跳转`);
  check(!/setTimeout\(function\(\)\{ location\.href = url; \}, 300\)/.test(rp),
    `${f} 不再有 300ms 延后跳转`);
  check(/prefers-color-scheme:\s*dark/.test(rp), `${f} 深色跟随系统`);
  check((rp.match(/addEventListener\("submit"/g) || []).length === 1,
    `${f} 查询框只保留一个提交监听（校验与跳转已合并）`);
}

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
check(!/miku-pop\.png/.test(shellHtml) && /miku-bouquet-haze\.webp/.test(shellHtml),
  '首屏只预载 1 张氛围底纹，不再预载过渡角色与浅/深壁纸');
check((shellHtml.match(/rel="preload" as="image"/g) || []).length === 1,
  '首屏图片 preload 从 4 张收到 1 张，少抢 3 个并发槽');
check(/html\[data-theme="dark"\] body[\s\S]{0,400}background:\s*transparent/.test(bloom), '深色 body 透明，壁纸不被盖住（A/B computed 背景一致）');
check(/html:not\(\[data-theme="dark"\]\)/.test(bloom) || /background-color/.test(bloom), '纸面底色在根元素统一');
check(!/--bl-jade:\s*#2f8f83/.test(bloom), '青瓷绿主色已换成 Noxc 蓝且不再回流');
check(/bl-petals/.test(bloom) && /prefers-reduced-motion/.test(bloom), '花瓣呼吸动效且尊重减少动态');
check(/\.bgswitch button/.test(bloom), '壁纸切换器为圆形缩略点');
check(/min-width:\s*620px/.test(bloom), '窄屏表格不再竖排断字');
check(imports.includes('shell.css') && imports.indexOf('design-system.css') === 3
  && imports.at(-1) === 'nodeloc-skin.css',
  'design-system.css 为颜色权威层，结构 / 组件层在其之前，形态层在其之后');

/* 12. 首屏一次性就绪：不再「一阶段 / 二阶段 / 三阶段慢慢加载出来」 */
const gate = read('src/app/lib/runtime.ts');
const dash = read('src/app/legacy/dashboard.ts');
const dashPage = read('src/app/pages/Dashboard.tsx');
const appSrc = read('src/app/App.tsx');
check(/SHARED_TTL/.test(gate) && /sharedGet/.test(gate) && /pageFetchStart/.test(gate), '同路径在飞 GET 合并成一次，首屏请求纳入在途计数');
check(/sharedGet\.get\(p\)/.test(gate) && /takePrefetched\(p\)/.test(gate), 'api.get 先复用共享 / 预取结果，未命中才发真实请求');
check(/method !== 'GET'[\s\S]{0,80}clearSharedGet\(\)/.test(gate), '写操作立刻清共享缓存，签到 / 释放域名不读旧值');
check(/whenPageFetchesIdle/.test(gate) && /setTimeout\(r, 800\)/.test(gate), '就绪门控收紧到 800ms 硬兜底，慢接口不让整页干等');
check(/page-root\[data-ready="0"\]/.test(gate) && /dataset\.ready = '1'/.test(gate) && /td:page-ready/.test(gate), '全部首屏 GET 结算后放出页面并宣告就绪（过渡层已不监听）');
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
check(/dataset\.ready = '0'/.test(appSrc) && /1200\)/.test(appSrc) && /clearTimeout\(failsafe\)/.test(appSrc), '每个页面挂载先隐藏内容区，放出兜底从 3s 收紧到 1.2s');
const pageFiles = fs.readdirSync(path.join(root, 'src/app/pages')).filter((f) => f.endsWith('.tsx'));
for (const f of pageFiles) {
  check(/refreshRuntime\(\)/.test(read('src/app/pages/' + f)), `${f} 会触发就绪门控`);
}
check(/\.page-root\[data-ready="0"\] \.main/.test(read(SHELL))
  && /\.page-root\[data-ready="1"\] \.main \{\s*opacity: 1 !important/.test(read(SHELL))
  && !/tdPageIn/.test(read(SHELL)),
  '未就绪时只藏内容区，就绪后立即显示（不再补 420ms 淡入）');


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

/* 首页结构：Reverie 骨架 + Yunamo 两栏查询卡 + legacy 契约一个不能少 */
for (const cls of ['rv-head', 'rv-hero', 'rv-ask', 'rv-sec', 'rv-quote', 'rv-cta', 'rv-foot']) {
  check(rvHome.includes(cls), `首页含 ${cls} 结构`);
}
for (const cls of ['yn-hero-grid', 'yn-hero-copy', 'yn-hero-panel', 'yn-panel', 'yn-sample', 'yn-rule', 'yn-panel-label', 'yn-try', 'yn-motion-float']) {
  check(rvHome.includes(cls), `首页含 Yunamo 结构 ${cls}`);
}
check(!/rv-landscape|rv-frame/.test(rvHome), '旧的单列横跨查询区已收进右侧卡片');
check(/yn-sample[\s\S]{0,400}yn-rule[\s\S]{0,300}yn-panel-label[\s\S]{0,500}id="searchForm"[\s\S]{0,900}yn-try/.test(rvHome),
  '查询卡内顺序：示例域名 → 分隔线 → 查询可用性 → 输入表单 → Try 示例');
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
check(/defaultQuota: quota/.test(quotaCfg) && /defaultQuotaOf\(c\.env\),/.test(quotaCfg),
  '公开配置下发 defaultQuota（与注册同口径，且并入并发取值）');
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
check(/reservedLabels: reserved/.test(rvIndex) && /reservedLabelsOf\(c\.env\)\.then/.test(rvIndex),
  '公开配置下发当前生效保留名单（并入并发取值）');
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
check(/captchaEnabled: captcha/.test(cpIndex) && /captchaEnabled\(c\.env\),/.test(cpIndex),
  '/api/config 下发开关，前后端同一份判定（并入并发取值）');
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
  /publicStats: stats/.test(cpIndex) && /publicStats\(c\.env\),/.test(cpIndex)
  && /app\.get\('\/api\/stats'/.test(cpIndex),
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

/* GitHub OAuth + Star 奖励 + 按后缀注册次数 */
const ghLib = read('src/lib/github.ts');
const ghRoute = read('src/routes/github.ts');
const ghIndex = read('src/index.ts');
const ghCfg = read('src/types.d.ts');
const ghAdminApi = read('src/routes/admin.ts');
const ghAdminUi = read('src/app/legacy/admin.ts');
const ghLogin = read('src/app/pages/Login.tsx');
const ghLoginCtrl = read('src/app/legacy/index.ts');
const ghProfile = read('src/app/pages/Profile.tsx');
const ghProfileCtrl = read('src/app/legacy/profile.ts');
const ghSchema = read('schema.sql');
const ghStore = read('src/lib/oauthStore.ts');
const rlLib = read('src/lib/rootLimits.ts');
const rlSub = read('src/routes/subdomains.ts');
const ghDict = read('src/app/lib/dict.en.ts');
const ghServerDict = read('src/lib/i18nServer.ts');

check(/export async function githubConfig/.test(ghLib) && /GITHUB_CALLBACK_PATH/.test(ghLib) &&
      /httpsCallbackUrl/.test(ghLib) && /normalizeStarRepo/.test(ghLib) &&
      /DEFAULT_STAR_REPO/.test(ghLib) && /DEFAULT_STAR_BONUS/.test(ghLib),
  'GitHub 配置库导出后台 / 路由需要的全部符号');
check(/read:user user:email public_repo/.test(ghLib),
  '授权 scope 含 public_repo，Star 校验端点才可用');
check(/export async function checkStarred/.test(ghLib) && /\/user\/starred\//.test(ghLib),
  'Star 实时向 GitHub 复核，不缓存判定');
check(/app\.route\('\/api\/auth\/github', githubRoutes\)/.test(ghIndex) &&
      ghIndex.indexOf("app.route('/api/auth/github', githubRoutes)") < ghIndex.indexOf("app.route('/api/auth', authRoutes)"),
  'GitHub 路由先于 /api/auth 挂载，否则被吞成 404');
check(/githubEnabled: github/.test(ghIndex) && /githubEnabled\(c\.env\),/.test(ghIndex) && !/accessToken:/.test(ghIndex),
  '公开配置只下发开关，不下发 token / Secret');
check(/app\.post\('\/claim-star'/.test(ghRoute) && /app\.get\('\/status'/.test(ghRoute) &&
      /app\.post\('\/unbind'/.test(ghRoute), 'GitHub 路由含绑定状态 / 领奖 / 解绑');
check(/oauth_quota_grants/.test(ghRoute) && /GITHUB_STAR_PROVIDER/.test(ghRoute) && /INSERT OR IGNORE/.test(ghRoute),
  'Star 奖励每个本地账号只领一次，不叠加');
check(/access_token/.test(ghSchema) && /ALTER TABLE oauth_bindings ADD COLUMN access_token/.test(ghStore),
  'access_token 列由 schema + 运行时补列双重保障，且只存服务端');
check(/gh_disabled/.test(ghLoginCtrl) && /id="githubWrap" hidden/.test(ghLogin) &&
      /cfg\.githubEnabled/.test(ghLoginCtrl), '登录按钮默认隐藏，配置齐备才显示，错误码独立');
check(/id="githubRow" hidden/.test(ghProfile) && /btnGithubClaim/.test(ghProfile) &&
      /githubStartUrl\('\?bind=1'\)/.test(ghProfileCtrl) && /\/api\/auth\/github\/claim-star/.test(ghProfileCtrl),
  '个人资料可绑定 GitHub、去点 Star、领取奖励');
check(/github_client_secret/.test(ghAdminApi) && /rootRegLimits/.test(ghAdminApi) &&
      /id="sGithubEnabled"/.test(ghAdminUi) && /rootRegLimitsBox/.test(ghAdminUi),
  '后台可配 GitHub OAuth、Star 仓库与每后缀注册次数');
check(/'第三方登录 · GitHub'/.test(ghDict) && /Star 奖励已领取过/.test(ghServerDict),
  '前后端英文词典覆盖新功能，英文模式不夹生');

check(/export function parseRootRegLimits/.test(rlLib) && /export function serializeRootRegLimits/.test(rlLib) &&
      /export async function rootRegLimitOf/.test(rlLib) && /export async function userRootRegCount/.test(rlLib) &&
      /export async function bumpRootRegCount/.test(rlLib),
  '注册次数库导出后台 / 注册路由需要的全部符号');
check(/CREATE TABLE IF NOT EXISTS root_reg_counts/.test(ghSchema) &&
      /CREATE TABLE IF NOT EXISTS root_reg_counts/.test(ghStore),
  '累计计数表在 schema 与运行时补列里都存在，老库可用');
check(/ON CONFLICT\(user_id, root_domain\) DO UPDATE SET/.test(rlLib) && /count = root_reg_counts\.count \+ 1/.test(rlLib),
  '累计计数只增不减，释放域名不退还次数');
check(/rootRegLimitOf\(c\.env, reqRoot\)/.test(rlSub) && /bumpRootRegCount\(c\.env\.DB/.test(rlSub),
  '注册路由在扣积分前校验上限，成功后才累加计数');
check(/root_reg_limits/.test(ghSchema) && /ROOT_REG_LIMITS\?/.test(ghCfg),
  '注册次数配置支持后台设置与环境变量两种来源');
check(/scripts\/github-regression\.ts/.test(read('.github/workflows/deploy.yml')) &&
      /scripts\/root-limit-regression\.ts/.test(read('.github/workflows/deploy.yml')),
  'GitHub / 注册次数两套回归已挂进部署工作流');

/* 首页 i18n：英文模式零中文残留 */
const hiHome = read('src/app/pages/Home.tsx');
const hiI18n = read('src/app/lib/i18n.ts');
const hiDict = read('src/app/lib/dict.en.ts');
const hiReg = fs.existsSync(path.join(root, 'scripts/home-i18n-regression.ts'))
  ? read('scripts/home-i18n-regression.ts') : '';
check(/function applyDataEn/.test(hiI18n) &&
      /querySelectorAll<Element>\('\[data-en\]'\)/.test(hiI18n) &&
      /closest\?\.\('\[data-en\]'\)/.test(hiI18n),
  '首页 i18n：运行时支持 data-en 整段替换、代码块注释、切回中文还原');
check((hiHome.match(/data-en=/g) || []).length >= 4 &&
  /data-en="SUFFIX"/.test(hiHome) && /data-en="DOMAINS"/.test(hiHome) &&
  /data-en="USERS"/.test(hiHome),
  '首页 i18n：主标题 / 后缀段 / 代码注释 / 展开表头均挂 data-en');
check(/免费注册子域名，通过 NS 委托掌控解析/.test(hiDict) &&
      /免费额度、自动配置、NS 委托和独立控制台/.test(hiDict) &&
      /'服务概览': 'At a glance'/.test(hiDict),
  '首页 i18n：两条最长说明与「服务概览」都有整句词条，不靠短词拼贴');
check(hiReg.length > 1000 && /零中文残留/.test(hiReg),
  '首页 i18n：有逐条抽取 Home.tsx 中文的回归脚本');
check(/home-i18n-regression\.ts/.test(read('.github/workflows/deploy.yml')),
  '首页 i18n 回归已挂进部署工作流');

/* 底部署名：Zerexa 改版后不被任意 <footer> 吞掉 */
const ftRuntime = read('src/app/lib/runtime.ts');
check(!/document\.querySelector\('\.site-foot'\)\s*\|\|\s*document\.querySelector\('footer'\)/.test(ftRuntime),
  '底部署名不再被任意 footer 吞掉（旧过宽去重已删除）');
check(/if \(document\.querySelector\('\.site-foot'\)\) return;/.test(ftRuntime) &&
      /Noxc \+ GitHub 链接/.test(ftRuntime) && /href="\/docs">服务文档/.test(ftRuntime),
  'mountSiteFooter 只对自己去重，仍注入 Noxc / GitHub / 服务文档');
check(/refreshRuntime[\s\S]{0,400}mountSiteFooter\(\)/.test(ftRuntime),
  '切页后 refreshRuntime 仍会重挂底部署名');

/* @oauth.local 已解封（漏洞根因是 edu 判定，不是这个域名） */
const ubRule = read('src/lib/emailRule.ts');
const ubSchema = read('schema.sql');
const ubAuth = read('src/routes/auth.ts');
const ubEc = read('scripts/email-change-regression.ts');
check(!/^\s*'oauth\.local',\s*$/m.test(ubRule), 'BLOCKED_EMAIL_DOMAINS 不再含 oauth.local');
check(/OAUTH_INTERNAL_DOMAINS/.test(ubRule) &&
      /OAUTH_INTERNAL_DOMAINS\.some\([^\n]*domain\.endsWith\('\.' \+ d\)\)\) return null/.test(ubRule),
  '对 oauth.local 精确豁免保留 TLD local，其它 .local / .test 仍拒绝');
check(!/lower\(email\) LIKE '%@oauth\.local'\s*OR\s*lower\(email\) LIKE '%@%\.oauth\.local'\s*OR\s*lower\(email\) LIKE '%@mailinator/.test(ubSchema),
  'schema 封禁语句不再封 oauth.local');
check(/UPDATE users SET status = 'active', ban_reason = NULL[\s\S]{0,260}lower\(email\) LIKE '%@oauth\.local'/.test(ubSchema),
  'schema 幂等解封上一版误封的 oauth.local 存量账号');
check(/ban_reason = '违规注册：一次性 \/ 非公开邮箱域名'/.test(ubSchema),
  '解封只认那次自动封禁的 ban_reason，不覆盖管理员手动封禁');
check(/oauth\.local 已解封/.test(ubAuth), '登录接口注释同步，不再把 oauth.local 当违规域名');
check(/@oauth\.local 已解封，可以正常发码/.test(ubEc), '换绑回归覆盖 oauth.local 解封');
check(/BLOCKED_EMAIL_DOMAINS = \[[\s\S]{0,80}'mailinator\.com'/.test(ubRule),
  '真临时邮箱域名仍在封禁名单里，解封没有放宽其它域名');
check(/scripts\/email-rule-regression\.ts/.test(read('.github/workflows/deploy.yml')),
  'emailRule 纯函数回归已挂进部署工作流');

/* 用户案例每次部署不丢：schema.sql 不再重建业务表 */
const spSchema = read('schema.sql');
const spLib = read('src/lib/showcase.ts');
const spIndex = read('src/index.ts');
const spReg = fs.existsSync(path.join(root, 'scripts/schema-persistence.py'))
  ? read('scripts/schema-persistence.py') : '';
check(!/ALTER TABLE subdomains RENAME|CREATE TABLE IF NOT EXISTS subdomains_mr|DROP TABLE IF EXISTS subdomains_old_mr/.test(spSchema),
  '用户案例每次部署不丢：schema.sql 不再 RENAME / 重建 subdomains 表');
check(/root_domain\s+TEXT\s+NOT NULL DEFAULT ''/.test(spSchema) &&
      /showcase\s+INTEGER NOT NULL DEFAULT 0/.test(spSchema) &&
      /showcase_title TEXT/.test(spSchema) && /showcase_desc  TEXT/.test(spSchema),
  '主表一次建成最终结构：root_domain + showcase 四列都在');
check(/export async function ensureCoreColumns/.test(spLib) &&
      /add\('root_domain'/.test(spLib) && /UPDATE subdomains SET root_domain/.test(spLib),
  '老库缺列改由 Worker 运行时 PRAGMA+ALTER 补齐并回填 root_domain');
check(/app\.use\('\*', bootstrap\)/.test(spIndex)
  && /ensureMigrations\(c\.env\)/.test(read('src/middleware/bootstrap.ts'))
  && /runtime_migrations_v3/.test(read('src/lib/runtimeMigrations.ts')),
  '补列收进 bootstrap + settings marker 跨 isolate 幂等（不再每请求跑 PRAGMA/全表回填）');
check(spReg.length > 1000 && /第 2 次部署/.test(spReg) && /展示开关被重置为 0/.test(spReg),
  'CI 跑真实 SQLite 双次部署回归，防止重建表问题回流');
check(/python3 scripts\/schema-persistence\.py/.test(read('.github/workflows/deploy.yml')),
  '持久化回归已挂进部署工作流');

/* SSL 证书入口已移除 */
check(!/data-act="ssl"/.test(read('src/app/pages/Domain.tsx')) &&
      !/a === 'ssl'/.test(read('src/app/legacy/domain.ts')),
  '域名详情不再有「SSL 证书」按钮与处理分支');
check(!/'SSL 证书'/.test(read('src/app/lib/dict.en.ts')), 'SSL 证书词条已从词典移除');

/* 前台不再使用彩色 emoji */
const noEmojiFiles = [
  'src/app/pages/Domain.tsx', 'src/app/pages/Register.tsx',
  'src/app/pages/Showcase.tsx', 'src/lib/showcase.ts',
  'src/app/legacy/register.ts',
  'docs-src/.vitepress/config.mts', 'docs-src/index.md', 'docs-src/en/index.md',
];
const PICTO = /[\u{1F300}-\u{1FAFF}\u2764\u26A0\u2705\u274C\u2728\u2139]/u;
for (const f of noEmojiFiles) {
  check(!PICTO.test(read(f)), `前台无彩色 emoji：${f}`);
}
check(/it\.emoji \|\| it\.fqdn\.slice\(0, 1\)\.toUpperCase\(\)/.test(read('src/app/pages/Showcase.tsx')),
  '案例卡片图标留空时用域名首字母兜底，不再塞默认 emoji');

/* KV / R2 自动绑定 */
const bdToml = read('wrangler.toml');
const bdCi = read('.github/workflows/deploy.yml');
const bdKv = read('scripts/ensure-kv.ts');
const bdTypes = read('src/types.d.ts');
const bdCfg = read('src/index.ts');
const bdUpload = read('src/routes/profile.ts');
check(/\[\[r2_buckets\]\][\s\S]{0,120}binding = "AVATARS"/.test(bdToml),
  'R2 绑定直接写在 wrangler.toml（桶名固定，CI 自动建桶）');
check(/scripts\/ensure-kv\.ts/.test(bdCi) && /KV_NAMESPACE_ID/.test(bdCi),
  'CI 有 KV 自动准备步骤，支持 Variables 复用已有 namespace');
check(/storage\/kv\/namespaces/.test(bdKv) && /\[\[kv_namespaces\]\]/.test(bdKv) &&
      /KV_ENABLED=false/.test(bdKv), 'ensure-kv 覆盖查找 / 创建 / 降级移除绑定');
check(/KV\?:/.test(bdTypes), 'Env 类型声明含 KV 绑定（判空使用）');
check(/kvBound: !!c\.env\.KV/.test(bdCfg) && /avatarUpload: !!c\.env\.AVATARS/.test(bdCfg),
  '/api/config 返回绑定状态，前端上传按钮随绑定自动出现');
check(!/AVATAR_ENABLED/.test(bdUpload) && !/AVATAR_ENABLED/.test(bdCfg),
  '头像上传不再要求手工配 AVATAR_ENABLED，绑定存在即启用');
check(/检查绑定状态/.test(bdCi), '部署前打印 wrangler.toml 的绑定状态，便于排查');

/* 深色可读性：--zx-blue-soft 是「深墨软背景」，不能当文字色 */
const dkCss = read('src/app/styles/design-system.css');
const dkShell = read('src/app/styles/shell.css');
const dkFix = dkCss.slice(dkCss.indexOf('深色可读性收口（2026-11-21 实拍回归）'));
check(dkFix.length > 1000, '深色可读性收口段存在且完整');
check(/--zx-blue-soft:\s*#1c222c/.test(dkCss) && /--zx-body:\s*#b6c0cf/.test(dkCss),
  '深色 --zx-blue-soft 仍是背景语义的深墨、--zx-body 是浅色正文');
/* shell.css 里 18 条历史规则把 --zx-blue-soft 当文字色；收口段必须逐类覆盖 */
const dkTextSelectors = [
  'stat-card .sc-num', 'stat-card .sc-lbl', 'stat-grid .stat', 'stat-v',
  'rv-term-body', 'nk-term-body', 'c-cmd', 'c-str', 'c-key', 'step i',
  'nk-fbottom b', 'notif-panel .np-tag', 'top-search kbd',
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
check(/免费额度/.test(zxHome) && /开通时效/.test(zxHome) && /NS 委托/.test(zxHome) && /有效期/.test(zxHome)
   && /id="factValidDays"/.test(zxHome) && !/长期有效/.test(zxHome),
  '四张卡文案与实拍一致，且「有效期」随站点设置动态填充（不再写长期有效）');
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
check(/nodelocEnabled: nodeloc/.test(nlIndex) && /nodelocEnabled\(c\.env\),/.test(nlIndex)
  && !/clientSecret:/.test(nlIndex), '公开配置只下发开关，不下发任何密钥');
check(/'nodeloc_client_secret'/.test(nlAdminApi) && /'github_client_secret'/.test(nlAdminApi) &&
        /body\.nodelocClientSecret/.test(nlAdminApi) && /body\.githubClientSecret/.test(nlAdminApi),
  '后台 Secret（NodeLoc / GitHub）只回掩码、留空不覆盖');
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
  /captchaEnabled: captcha/.test(mdIndex) && /captchaEnabled\(c\.env\),/.test(mdIndex),
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
  /dist\/client\/docs\//.test(read('scripts/copy-docs.ts')) &&
  /vitepress build docs-src/.test(read('package.json')),
  'VitePress 产物由构建脚本并入 dist/client/docs/，随 Worker 一起部署'
);

/* 服务文档：VitePress 静态站（原来是一整份 TypeScript 模板字符串）。
   产物由 scripts/copy-docs.ts 并入 dist/client/docs/，Worker 把 /docs/*
   交给 ASSETS。中英双语、8 张截图、图 7→图 8 的关键一步都保留。 */
const vpConfig = read('docs-src/.vitepress/config.mts');
const vpTheme = read('docs-src/.vitepress/theme/index.ts');
const vpAnn = read('docs-src/.vitepress/theme/announcement.ts');
const vpCss = read('docs-src/.vitepress/theme/custom.css');
const vpDnshe = read('docs-src/dnshe.md');
const vpDnsheEn = read('docs-src/en/dnshe.md');
const vpAllPages = [
  'index.md', 'quick-start.md', 'accounts.md', 'dns.md', 'dnshe.md',
  'settings.md', 'showcase.md', 'faq.md',
].flatMap((f) => ['docs-src/' + f, 'docs-src/en/' + f]);
const docApp = read('src/app/App.tsx');
check(
  !/'\/docs'\s*:\s*[A-Za-z]+Page/.test(docApp) && !/import DocsPage/.test(docApp),
  '/docs 不注册成 SPA 路由，不会被 React 拦截成首页'
);
check(
  /base: '\/docs\/'/.test(vpConfig) && /locales:/.test(vpConfig) &&
  /zh-CN/.test(vpConfig) && /English/.test(vpConfig),
  'VitePress 配置：base /docs/ + 中英双语 locales'
);
check(
  vpAllPages.every((f) => fs.existsSync(path.join(root, f))),
  '中英各 8 个文档页面齐全（共 16 页）'
);
check(
  Array.from({ length: 8 }, (_, i) => i + 1).every((n) =>
    /\.\.?\/img\/fig\d+\.png/.test(vpDnshe) &&
    fs.existsSync(path.join(root, 'docs-src/img/fig' + n + '.png')) &&
    fs.existsSync(path.join(root, 'public/img/docs/fig' + n + '.png'))),
  '图 1～图 8 在 VitePress public 与原资源目录都存在，且文档有图片引用'
);
check(
  Array.from({ length: 8 }, (_, i) => i + 1).every((n) =>
    vpDnshe.includes('/img/fig' + n + '.png') && vpDnsheEn.includes('/img/fig' + n + '.png')),
  '中英 DNSHE 章节都按顺序引用了 fig1～fig8'
);
check(
  /Add DNS records/.test(vpDnshe) && /Check again/.test(vpDnshe) &&
  /Cancel/.test(vpDnshe) && /Fig 8|图 8/.test(vpDnshe) &&
  /Add DNS records/.test(vpDnsheEn) && /Check again/.test(vpDnsheEn),
  '文档明确写出：图 7 必须点 Add DNS records 才会出现图 8（中英双语）'
);
const vpBridge = vpDnshe.slice(vpDnshe.indexOf('fig7.png'), vpDnshe.indexOf('fig8.png'));
check(vpBridge.length > 0 && /Add DNS records/.test(vpBridge) && /Check again/.test(vpBridge),
  '图 7 → 图 8 之间的正文确实写明了三个按钮的作用');
check(
  /ns1\.dnshe\.org/.test(vpDnshe) && /ns1\.dnshe\.com/.test(vpDnshe) &&
  /在 DNSHE 注册的域名/.test(vpDnshe) && /api005\.dnshe\.com/.test(vpDnshe) &&
  /ns1\.dnshe\.org/.test(vpDnsheEn) &&
  /专属于在 DNSHE 注册的域名/.test(read('docs-src/dns.md')),
  '文档写清 .org / .com 两套 NS 与 API 网关区别'
);
const vpNoBridge = vpDnshe.replace(/Add DNS records/g, 'Check again');
check(!/Add DNS records/.test(vpNoBridge) && vpNoBridge !== vpDnshe,
  '反向对照：拿掉 Add DNS records，文档断言必须失败');
check(
  /'layout-top'/.test(vpTheme) && /loadAnnouncement\(\)/.test(vpTheme) &&
  /siteAnnouncement/.test(vpTheme) && !/v-html\s*[:=]/.test(vpTheme),
  'VitePress 用 layout-top 插槽挂站点公告，h() 纯文本子节点'
);
check(/fetch\('\/api\/config'/.test(vpAnn) && /announcement\.value\s*=/.test(vpAnn),
  '文档页公告异步补挂，接口失败保持隐藏，不阻塞首屏');
check(
  /async function docsAsset/.test(docIndex) &&
  !/new URL\('\/docs\/index\.html', c\.req\.url\)/.test(docIndex) &&
  !/docsHtml/.test(docIndex) && !/c\.html\(docsHtml\)/.test(docIndex),
  '/docs 走 VitePress 静态产物，ASSETS 规范化 3xx 由 docsAsset 内部消化，不再外吐重定向'
);
check(
  /docs:build/.test(read('package.json')) &&
  /vitepress build docs-src/.test(read('package.json')) &&
  /npm run docs:build/.test(read('package.json')),
  'npm run build 串起 Vite + VitePress 两条构建链'
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
for (const f of ['src/html/root-meoy.ts', 'src/html/root-v1.ts']) {
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

/* 积分默认值单一来源：schema.sql 的 INSERT 与 pointDefaults.ts 必须逐项一致，
   且前端页面不得再写死 5 / 35 / 10 —— 否则后台改了设置，页面说明又对不上实际扣费。 */
const pd = read('src/lib/pointDefaults.ts');
const pdVal = (k) => {
  const m = pd.match(new RegExp('\\b' + k + ':\\s*(\\d+)'));
  return m ? m[1] : null;
};
const schemaPd = read('schema.sql');
const schemaInsert = (k) => {
  const m = schemaPd.match(new RegExp("INSERT OR IGNORE INTO settings\\(key, value\\) VALUES \\('" + k + "', '(\\d+)'\\)"));
  return m ? m[1] : null;
};
for (const [k, sk] of [['checkin', 'checkin_points'], ['domainCost', 'domain_cost'],
                       ['shortCost', 'short_domain_cost'], ['shortLen', 'short_domain_len'],
                       ['initial', 'initial_points']]) {
  check(pdVal(k) !== null && pdVal(k) === schemaInsert(sk),
    `积分默认值 ${k} 在 pointDefaults.ts 与 schema.sql 一致（${pdVal(k)}）`);
}
check(/points_defaults_v2/.test(schemaPd) && /NOT EXISTS/.test(schemaPd),
  '积分默认值迁移是一次性的，不覆盖管理员自定义值');
for (const f of ['src/routes/points.ts', 'src/index.ts', 'src/lib/points.ts',
                 'src/app/legacy/admin.ts', 'src/app/legacy/register.ts',
                 'src/app/pages/Checkin.tsx']) {
  check(/POINT_DEFAULTS/.test(read(f)), `${f} 引用统一默认值（无散落硬编码）`);
}
check(!/普通域名消耗 5 分/.test(read('src/app/pages/Register.tsx'))
   && /faqPointRules/.test(read('src/app/pages/Register.tsx'))
   && /faqPointRules/.test(read('src/app/legacy/register.ts')),
  '注册须知积分说明随 /api/config 动态渲染');
check(read('src/app/lib/i18n.ts').includes('当前规则：普通域名 (\\d+) 分')
   && read('src/app/lib/i18n.ts').includes('Current rules: standard'),
  '动态规则行有英文句式（英文模式不会夹生）');

/* 用户案例展示奖励：每账号一次性 +6000（后台可改），开启展示即发、
   关闭不回收、重复开启不叠加、管理员跳过、关闭奖励设 0。
   必须同时挂在 PATCH 开关与 /api/points/me（存量用户惰性补发）两处。 */
const rewardLib = read('src/lib/showcaseReward.ts');
const rewardPd = read('src/lib/pointDefaults.ts');
check(/SHOWCASE_REWARD_POINTS\s*=\s*6000/.test(rewardPd), '展示奖励默认 6000 分写在唯一常量源');
check(/showcase_reward_points', '6000'\)/.test(schemaPd)
   && /CREATE TABLE IF NOT EXISTS showcase_rewards/.test(schemaPd)
   && /user_id\s+INTEGER PRIMARY KEY/.test(schemaPd),
  'schema 有展示奖励表与 6000 默认值，主键天然防并发重复发放');
check(/INSERT OR IGNORE INTO showcase_rewards/.test(rewardLib)
   && /meta\?\.changes/.test(rewardLib),
  '奖励用 INSERT OR IGNORE + changes 判定，并发下只发一次');
check(/status = 'approved'/.test(rewardLib)
   && /String\(user\.role\) === 'admin'/.test(rewardLib)
   && /UNLIMITED_POINTS/.test(rewardLib),
  '只有已开通域名算展示，管理员 / 无限积分账号跳过');
check(!/showcase\s*=\s*0[\s\S]{0,200}DELETE FROM showcase_rewards/.test(rewardLib),
  '关闭展示不回收奖励');
check(/ensureShowcaseReward\(c\.env, Number\(row\.user_id\)\)/.test(read('src/routes/subdomains.ts'))
   && /showcaseReward/.test(read('src/routes/subdomains.ts')),
  'PATCH 展示开关即时发奖，且发给域名所有者而非操作者');
check(/ensureShowcaseReward\(c\.env, u\.id\)/.test(read('src/routes/points.ts')),
  '/api/points/me 为存量已展示用户惰性补发');
check(/showcaseRewardPoints: showcasePts/.test(read('src/index.ts'))
   && /sShowcaseReward/.test(read('src/app/legacy/admin.ts'))
   && /showcaseRewardPoints: document/.test(read('src/app/legacy/admin.ts'))
   && /'showcase_reward_points', body\.showcaseRewardPoints/.test(read('src/routes/admin.ts')),
  '奖励积分可在后台设置，且 /api/config 下发当前值');
check(/const \[effectiveRoots, ai, emailRule, reserved, captcha, nodeloc, github,[\s\S]{0,120}showcasePts, expiry, quota, stats\] = await Promise\.all\(/.test(read('src/index.ts')),
  '/api/config 冷缓存路径：11 个独立子项并发发起，不再串行累加 RTT');
check(read('src/app/lib/i18n.ts').includes('已开启展示，积分 \\+(\\d+)')
   && read('src/app/lib/dict.en.ts').includes('Showcase bonus points (once per account)'),
  '展示奖励提示有英文句式与新词条');
check(/开启展示还能获得积分奖励/.test(read('src/app/pages/Showcase.tsx'))
   && /\+6000/.test(read('docs-src/showcase.md')) && /\+6000/.test(read('docs-src/en/showcase.md')),
  '展示页与服务文档都写明奖励规则');

/* 域名有效期 / 续期：窗口默认取「有效期的一半」（少于一半即可续期），
   且首页 / 注册须知 / 条款都不得再写死 365 / 180。 */
const expLib = read('src/lib/expiry.ts');
const expHome = read('src/app/legacy/home.ts');
const expReg = read('src/app/legacy/register.ts');
const expRegTsx = read('src/app/pages/Register.tsx');
const expAdminTs = read('src/app/legacy/admin.ts');
check(/RENEW_HALF_RATIO\s*=\s*0\.5/.test(expLib)
   && /Math\.floor\(v \* RENEW_HALF_RATIO\)/.test(expLib)
   && /export function renewalWindowDays/.test(expLib)
   && /export function expiryTipText/.test(expLib),
  '续期窗口按有效期一半推算，且有统一文案函数');
check(/renewWindowAuto/.test(expLib) && /renew_window_days', ''\)/.test(schemaPd),
  '留空 = 自动口径，后台可显式覆盖');
check(/renew_window_half_v2/.test(schemaPd) && /NOT EXISTS/.test(schemaPd)
   && /value = '180'/.test(schemaPd),
  '老库旧默认 180 一次性清空，管理员自定义值保留');
check(/expiry,/.test(read('src/index.ts')) && /expiryRules\(c\.env\),/.test(read('src/index.ts')),
  '/api/config 下发生效后的有效期与续期窗口');
check(/expiryTipText\(rules\)/.test(expHome) && /cfg\.expiry/.test(expHome)
   && !/单次注册 365 天/.test(expHome),
  '首页后缀卡文案随站点设置变，不再写死 365 / 180');
check(/factValidDays/.test(expHome) && /id="factValidDays"/.test(zxHome),
  '首页四张特性卡的「有效期」也随站点设置变');
check(/faqExpiry/.test(expRegTsx) && /faqExpiry/.test(expReg)
   && /expiryTipText\(cfg\.expiry\)/.test(expReg)
   && !/单次注册 \d+ 天/.test(expRegTsx) && !/有效期 365 天/.test(expRegTsx),
  '注册须知有效期说明动态渲染，首屏兜底也不写死天数');
check(/expiry: await expiryRules\(c\.env\)/.test(read('src/routes/admin.ts'))
   && !/secrets:\s*\{[\s\S]{0,260}expiry:/.test(read('src/routes/admin.ts')),
  '后台设置 expiry 在顶层（不再误塞 secrets 导致输入框永远显示写死值）');
check(/value="" placeholder="自动"/.test(expAdminTs)
   && /renewWindowAuto \? '' :/.test(expAdminTs)
   && /1-3650 天之间/.test(read('src/routes/admin.ts')),
  '后台续期窗口留空 = 自动，保存时有范围校验');
check(!/到期前 180 天/.test(read('src/routes/terms.ts'))
   && !/renewable within 180 days/.test(read('src/lib/i18nServer.ts'))
   && /少于一半/.test(read('src/routes/terms.ts')),
  '服务条款改为「剩余少于一半即可续期」，不再写死 180 天');
check(read('src/app/lib/i18n.ts').includes('单次注册 (\\d+) 天，到期前 (\\d+) 天可续期')
   && read('src/app/lib/i18n.ts').includes('自动：(\\d+) 天'),
  '动态有效期文案与后台 placeholder 都有英文句式');
check(!/单次注册 365 天，到期前 180 天可续期/.test(read('src/app/lib/dict.en.ts')),
  '词典里不再有写死 365 / 180 的整句词条');

/* 修改密码改为邮箱验证码：不再要原密码；发码只认会话邮箱；场景独立；两处入口共用弹窗。 */
const pwMail = read('src/lib/mail.ts');
const pwAuth = read('src/routes/auth.ts');
const pwModal = read('src/app/lib/passwordChange.ts');
const pwProfile = read('src/app/legacy/profile.ts');
const pwDash = read('src/app/legacy/dashboard.ts');
const pwDict = read('src/app/lib/dict.en.ts');
const pwServerDict = read('src/lib/i18nServer.ts');
const pwReg = read('scripts/password-change-regression.ts');
const pwCI = read('.github/workflows/deploy.yml');
check(/PASSWORD_CHANGE_SCENE\s*=\s*'password_change'/.test(pwMail)
   && /\[PASSWORD_CHANGE_SCENE\]: \{ subject: '修改密码验证码', action: '修改账号密码' \}/.test(pwMail),
  '改密验证码有独立场景与专属邮件标题/正文');
check(/app\.post\('\/password\/send-code'/.test(pwAuth)
   && /String\(u\.email/.test(pwAuth)
   && /mailEnabled\(cfg\)/.test(pwAuth)
   && /issueCode\(c\.env, mail, PASSWORD_CHANGE_SCENE/.test(pwAuth)
   && /60_000/.test(pwAuth),
  '发码端点为登录态，只发到会话邮箱，带邮件配置检查与 60 秒节流');
check(/checkCode\(c\.env, mail, PASSWORD_CHANGE_SCENE/.test(pwAuth)
   && /user\.password_code/.test(pwAuth)
   && /DELETE FROM sessions WHERE user_id = \? AND token != \?/.test(pwAuth),
  '改密校验一次性验证码、写审计并踢掉其它会话');
check(!/verifyPassword\(String\(oldPassword/.test(pwAuth)
   && !/原密码不正确/.test(pwAuth)
   && /needRefresh/.test(pwAuth),
  '后端彻底不要原密码，旧前端明确提示刷新');
check((pwAuth.match(/!\['register', 'reset'\]\.includes\(/g) || []).length >= 2
   && !/'password_change'\]\.includes/.test(pwAuth),
  '公开发码 / 公开校验接口白名单都只有 register / reset，未开放改密场景');
check(/isOauthInternalEmail\(m\)/.test(pwAuth) && /'local', 'localhost', 'internal', 'test'/.test(pwAuth),
  '占位邮箱与保留 TLD 明确提示先换邮箱，不假装发码');
check(/openPasswordChangeModal\(\)/.test(pwProfile) && /openPasswordChangeModal\(\)/.test(pwDash)
   && /from '\.\.\/lib\/passwordChange'/.test(pwDash)
   && /from '\.\.\/lib\/passwordChange'/.test(pwProfile),
  '控制台与个人资料共用同一个验证码改密弹窗');
check(!/oldPassword|currentPassword|pOld|id="op"/.test(pwProfile + pwDash)
   && /不再需要输入原密码/.test(read('src/app/pages/Profile.tsx')),
  '前端不再出现原密码输入框或旧字段，说明文案明确「不再需要输入原密码」');
check(/btnPwdSend/.test(pwModal) && /pwdCode/.test(pwModal) && /pwdNew/.test(pwModal)
   && /\/api\/auth\/password\/send-code/.test(pwModal)
   && /placeholder="验证码将发送至当前账号邮箱"/.test(pwModal)
   && /纯数字倒计时/.test(pwModal),
  '弹窗含发码 / 验证码 / 新密码，邮箱提示用 placeholder 以便英文模式翻译');
check(/修改密码需通过账号邮箱的验证码确认/.test(read('src/app/pages/Profile.tsx')),
  '安全设置说明改为邮箱验证码口径');
for (const k of ['当前账号邮箱', '验证码已发送到当前账号邮箱，10 分钟内有效',
                 '请先获取并填写验证码', '确认修改',
                 '密码修改已改为邮箱验证码，请刷新页面后重试']) {
  check(pwDict.includes(`'${k}'`), `前端词典含改密文案「${k}」`);
}
for (const k of ["'密码修改已改为邮箱验证码，请刷新页面后重试'",
                 "'当前账号邮箱无法接收邮件", "'账号已被封禁，无法修改密码'"]) {
  check(pwServerDict.includes(k), `服务端词典含改密提示「${k.slice(1, 13)}…」`);
}
check(!/'原密码不正确'/.test(pwDict + pwServerDict) && !/'原密码':/.test(pwDict),
  '旧「原密码」相关词条已清理');
check(/修改密码验证码回归/.test(pwReg) && /password-change-regression\.ts/.test(pwCI),
  '专项回归脚本进了 CI，覆盖发码/一次性/场景隔离/会话与审计');

/* 站点公告：后台「站点设置」的字段以前是死的 —— /api/config 没查这个 key，
   且旧渲染只在 mountShell()（要求 .main）里插，前台每个页面都看不到。 */
const anCfg = read('src/index.ts');
const anRuntime = read('src/app/lib/runtime.ts');
const anDesign = read('src/app/styles/design-system.css');
const anShared = read('src/html/announcement.ts');
const anVpTheme = read('docs-src/.vitepress/theme/index.ts');
const anVpAnn = read('docs-src/.vitepress/theme/announcement.ts');
const anRoot1 = read('src/html/root-meoy.ts');
const anRoot2 = read('src/html/root-v1.ts');
const anSchema = read('schema.sql');
const anReg = read('scripts/announcement-regression.ts');
const anCI = read('.github/workflows/deploy.yml');
check(/CONFIG_KEYS[\s\S]{0,900}'announcement'/.test(anCfg)
  && /pickSettings\(c\.env, CONFIG_KEYS\)/.test(anCfg)
  && /announcement: String\(s\.announcement/.test(anCfg),
  '/api/config 配置白名单含 announcement 并下发（统一配置层，历史根因 1）');
check(/export function mountAnnouncement/.test(anRuntime)
  && /body\.textContent = msg/.test(anRuntime)
  && /data-no-i18n/.test(anRuntime),
  '公告条用 textContent 渲染并标 data-no-i18n，不解析 HTML、英文模式不改写');
check(/document\.querySelector\('\.main'\) \|\| document\.body/.test(anRuntime)
  && !/shellNotice|cfg\.notice \|\| cfg\.announcement/.test(anRuntime),
  '全站挂载（控制台插 .main、其余插 body），旧的只在控制台渲染逻辑已删');
check(/void loadBranding\(\)\.then\(\(b\) => mountAnnouncement\(b\.announcement\)\)/.test(anRuntime)
  && /try \{ mountAnnouncement\(b\.announcement\); \} catch \{\}/.test(anRuntime),
  'refreshRuntime 每次切页挂载 + applyBranding 后台保存即时生效');
check(/bar\.className = 'site-announcement'/.test(anRuntime)
  && /html body \.site-announcement/.test(anDesign)
  && /white-space: normal/.test(anDesign),
  '专用 class 与样式（可换行、纯文档流），不复用 .notice 卡片');
for (const [label, t] of [['meoy.top', anRoot1], ['v-1.top', anRoot2]] as [string, string][]) {
  check(/ANNOUNCEMENT_CSS/.test(t) && /ANNOUNCEMENT_BODY/.test(t)
    && /ANNOUNCEMENT_JS/.test(t) && /renderAnnouncement\(/.test(t),
    `${label} 独立模板也显示公告（共享片段，不依赖 SPA 运行时）`);
}
check(/s\.textContent\s*=\s*t/.test(anShared), '共享片段同样纯文本渲染，防 XSS');
check(/'layout-top'/.test(anVpTheme) && /h\('span', \{ class: 'sa-text' \}/.test(anVpTheme)
  && !/v-html\s*[:=]/.test(anVpTheme) && /fetch\('\/api\/config'/.test(anVpAnn),
  'VitePress 文档页也显示站点公告（layout-top 插槽 + 纯文本）');
check(/VALUES \('announcement', ''\)/.test(anSchema), '全新库公告默认留空，不再写死旧品牌欢迎语');
check(/\| 站点公告 \| 空 \| 纯文本/.test(read('README.md')), 'README 不再写「预留」');
check(/站点公告回归/.test(anReg) && /announcement-regression\.ts/.test(anCI),
  '公告专项回归进 CI，覆盖真跑 /api/config + 挂载链路 + 浏览器实拍');

/* SPA 直达回落：/report /abuse 曾只在前端 ROUTES 里、没进 Worker 的
   SPA_PATHS，直接打开 / 刷新 / 根域名外链跳过去就被 ASSETS 判 404 空 body，
   整页白屏。现在改成唯一来源 spaRoutes.ts + 真跑 Hono 的专项回归。 */
const srIndex = read('src/index.ts');
const srApp = read('src/app/App.tsx');
const srShared = read('src/lib/spaRoutes.ts');
const srReg = read('scripts/spa-routes-regression.ts');
const srCI = read('.github/workflows/deploy.yml');
const srRoutes = Array.from(
  (srApp.split('const ROUTES')[1].split('};')[0]).matchAll(/'(\/[^']+)'\s*:/g)
).map((m) => m[1]);
check(srRoutes.length >= 30, `巡检解析到前端 ROUTES ${srRoutes.length} 条`);
check(/export const SPA_PAGE_NAMES/.test(srShared)
  && /'report'/.test(srShared) && /'abuse'/.test(srShared),
  'SPA 回落唯一来源含 report / abuse（本次白屏根因）');
check(/const SPA_PATHS = new Set\(spaFallbackPaths\(\)\)/.test(srIndex)
  && /import \{ spaFallbackPaths \} from '\.\/lib\/spaRoutes\.js'/.test(srIndex),
  'Worker 用唯一来源生成回落清单，不再手写第二份');
const srMissing = srRoutes.filter((r) => {
  // '/' 与 '/index.html' 由 spaFallbackPaths() 直接输出，不对应页面名
  if (r === '/' || r === '/index.html') return false;
  const name = r.replace(/^\//, '').replace(/\.html$/, '');
  return !new RegExp(`'${name}'`).test(srShared);
});
check(srMissing.length === 0, `前端每个直达路径都在唯一来源里有页面名${srMissing.length ? '，缺：' + srMissing.join(', ') : ''}`);
check(/SPA 直达回落回归/.test(srReg) && /spa-routes-regression\.ts/.test(srCI),
  '专项回归进 CI：真跑 Hono 验证 /report 回落、未知路径不误伤、/docs 走 VitePress 静态页');

/* 首页「已开通域名」展开：按根域名分组 + 最热后缀 HOT。
   以前 publicStats 只回两个总数，首页没法看到各后缀分别注册了多少。 */
const sbLib = read('src/lib/publicStats.ts');
const sbHome = read('src/app/pages/Home.tsx');
const sbCtrl = read('src/app/legacy/home.ts');
const sbCss = read('src/app/styles/design-system.css');
const sbReg = read('scripts/stats-breakdown-regression.ts');
const sbCI = read('.github/workflows/deploy.yml');
const sbPkg = read('package.json');
check(/GROUP BY d/.test(sbLib) && /COUNT\(DISTINCT user_id\)/.test(sbLib)
  && /effectiveRootList/.test(sbLib) && /hottest/.test(sbLib),
  '公开统计按根域名分组：域名数 / 去重用户数 / 0 值补齐 / 最热后缀');
check(/id="statDomainsToggle"/.test(sbHome) && /id="statBreakdown"/.test(sbHome)
  && /id="statHottest"/.test(sbHome) && /aria-expanded/.test(sbHome),
  '首页统计条可展开，且有不展开也能看到的最热提示');
check(/renderBreakdown/.test(sbCtrl) && /renderHottest/.test(sbCtrl)
  && /nk-badge-hot/.test(sbCtrl) && /rv-bd-hot/.test(sbCtrl)
  && /HOTTEST = String\(st\.hottest/.test(sbCtrl),
  '控制器渲染清单与 HOT 徽标，最热后缀来自接口而非写死');
check(/startI18n/.test(sbCtrl), '动态渲染的展开表头也走 i18n');
check(/\.rv-breakdown/.test(sbCss) && /\.nk-badge-hot/.test(sbCss),
  '展开面板与 HOT 样式在唯一视觉源里');
check(/统计展开回归/.test(sbReg) && /stats-breakdown-regression\.ts/.test(sbCI),
  '统计展开回归进 CI：跨 Node 版本内存 D1 + /api/config 下发 + 浏览器实拍');

/* VitePress 文档：构建链接进 CI，产物由 copy-docs.ts 并入静态目录 */
check(/vitepress/.test(sbPkg) && /docs:build/.test(sbPkg)
  && /npm run docs:build/.test(sbPkg),
  'npm run build 串起 Vite + VitePress 两条构建链');
check(/校验 VitePress 文档产物/.test(sbCI) && /dist\/client\/docs\/en\/index\.html/.test(sbCI),
  'CI 校验 VitePress 中英产物与截图确实落地');

/* /docs 无限重定向：VitePress 改版时把 /docs 显式改写成 /docs/index.html，
   ASSETS 又规范化 301 回 /docs/，Worker 去尾斜杠又变 /docs → Safari 报
   「太多重新导向」。docsAsset() 在内部消化 3xx，绝不外吐给浏览器。 */
const drIdx = read('src/index.ts');
const drReg = read('scripts/docs-redirect-regression.ts');
const drCI = read('.github/workflows/deploy.yml');
const drReadme = read('README.md');
check(/async function docsAsset\(/.test(drIdx) && /seen\.has\(key\)/.test(drIdx)
  && /redirect loop/.test(drIdx),
  'docsAsset 内部跟随 ASSETS 规范化 3xx + 自指检测 + 不外吐 3xx');
check(!/new URL\('\/docs\/index\.html', c\.req\.url\)/.test(drIdx),
  '旧的「/docs 显式改写 index.html」写法已删除（循环根因）');
check(/docsAsset\(c, '\/docs\/'\)/.test(drIdx) && /docsAsset\(c, reqUrl\.pathname\)/.test(drIdx),
  '/docs 与 /docs/* 统一走内部消化');
check(/服务文档重定向循环回归/.test(drCI) && /docs-redirect-regression\.ts/.test(drReg),
  '专项回归进 CI：模拟 ASSETS 规范化 + 病态自指 + 反向对照');
check(/太多重新导向/.test(drReadme), 'README 记录了这次循环的根因与规避方式');

/* 一键创建 Token 预填链接：必须是完整 7 项权限的深链，且放在部署章节开头 */
const tkReadme = read('README.md');
const tkUrl = (tkReadme.match(/\[创建 Noxc Deploy Token（用户 Token）\]\((https:[^)]+)\)/) || [])[1] || '';
check(tkUrl.includes('permissionGroupKeys=') && tkUrl.includes('name=Noxc%20Deploy%20Token')
  && tkUrl.includes('workers_kv_storage') && tkUrl.includes('workers_r2')
  && tkUrl.includes('accountId=%2A') && tkUrl.includes('zoneId=all'),
  'README 一键创建链接含 7 项预填权限、名称与 Account/Zone 范围');
check(tkReadme.indexOf('## 三、部署步骤') < tkReadme.indexOf('创建 Noxc Deploy Token')
  && tkReadme.indexOf('创建 Noxc Deploy Token') < tkReadme.indexOf('| 需要什么 |'),
  '一键创建链接位于部署章节开头、凭据表格之前（第一眼就能看到）');

/* 按后缀单独暂停新申请：只拦「新建子域名」，不影响已注册域名与其它后缀。
   名单存 settings.root_apply_paused，applyGate 是全局 + 按后缀的唯一来源。 */
const rpGate = read('src/lib/applyGate.ts');
const rpIdx = read('src/index.ts');
const rpSub = read('src/routes/subdomains.ts');
const rpAdm = read('src/routes/admin.ts');
const rpAdmUi = read('src/app/legacy/admin.ts');
const rpHome = read('src/app/legacy/home.ts');
const rpReg = read('src/app/legacy/register.ts');
const rpCss = read('src/app/styles/design-system.css');
const rpDocsZh = read('docs-src/settings.md');
const rpDocsEn = read('docs-src/en/settings.md');
const rpReadme = read('README.md');
const rpRegS = read('scripts/root-apply-pause-regression.ts');
const rpCI = read('.github/workflows/deploy.yml');
check(/root_apply_paused/.test(rpGate) && /ROOT_APPLY_PAUSED/.test(rpGate)
  && /parsePausedRoots/.test(rpGate) && /isRootApplyPaused/.test(rpGate),
  '按后缀暂停名单：解析 / 序列化 / 环境变量强制 / 唯一来源都在 applyGate');
check(/pausedRoots/.test(rpIdx) && /rootApplyPausedFromEnv/.test(rpIdx),
  '/api/config 下发暂停名单与环境变量标志');
check(/isRootApplyPaused\(gate, reqRoot\)/.test(rpSub)
  && /u\.role !== 'admin'/.test(rpSub),
  '注册接口拦截按后缀暂停，管理员自建豁免');
check(/rootApplyPaused/.test(rpAdm) && /root-apply-paused/.test(rpAdm),
  '后台设置可读写名单并写审计');
check(/rootApplyPausedBox/.test(rpAdmUi) && /rootApplyPaused:/.test(rpAdmUi),
  '站点设置页有勾选区并进保存 payload');
check(/PAUSED_ROOTS/.test(rpHome) && /nk-badge-paused/.test(rpHome)
  && /该后缀已暂停新申请/.test(rpHome),
  '首页后缀卡片标注、暂停后缀不再给注册入口');
check(/syncApplyPause/.test(rpReg) && /clearApplyPaused/.test(rpReg)
  && /PAUSED_ROOTS/.test(rpReg) && /currentLang/.test(rpReg),
  '注册页切后缀锁定 / 解锁，英文提示不残留中文');
check(/\.nk-badge-paused/.test(rpCss), '暂停徽标有专属样式');
check(/按后缀单独暂停新申请/.test(rpDocsZh) && /Pause applications per suffix/.test(rpDocsEn)
  && /按后缀单独暂停新申请/.test(rpReadme),
  '中英文档与 README 都写明「只拦新建、已注册域名不受影响」口径');
check(/按后缀暂停申请回归/.test(rpCI) && /root-apply-pause-regression\.ts/.test(rpRegS),
  '专项回归进 CI（真跑注册接口 + 反向对照）');

/* 域名详情页：顶部整页切换器 + 自助验证不再有会误导的局部下拉。
   以前 #vDomain 只改 verifyTargetId，切到别的域名后 DNS 记录列表仍是旧的，
   再点「添加记录」又写回原域名，用户会看到「两条相同的 @ 记录」。 */
const dsPage = read('src/app/pages/Domain.tsx');
const dsCtl = read('src/app/legacy/domain.ts');
const dsRec = read('src/routes/records.ts');
const dsDocsZh = read('docs-src/dns.md');
const dsDocsEn = read('docs-src/en/dns.md');
const dsReadme = read('README.md');
const dsCI = read('.github/workflows/deploy.yml');
const dsReg = read('scripts/domain-switch-records-regression.ts');
check(/id="domainSwitcher"/.test(dsPage) && !/id="vDomain"/.test(dsPage),
  '顶部整页切换器存在，自助验证局部下拉已移除');
check(/location\.href = '\/domain\?id='/.test(dsCtl) && /&tab=/.test(dsCtl)
  && !/verifyTargetId/.test(dsCtl),
  '切换域名整页重载并保留标签页，自助验证固定写当前域名');
check(/if \(saving\) return/.test(dsCtl) && /saveBtn\.disabled = true/.test(dsCtl),
  '保存按钮防重复提交（响应慢时连点不会写两条）');
check(/const dup = await c\.env\.DB\.prepare/.test(dsRec) && /duplicate: true/.test(dsRec),
  '后端同名同类型同值幂等返回，不写第二条 Cloudflare 记录');
check(/Promise\.all\(\[\s*api\.get\('\/api\/config'\)/.test(dsCtl)
  && /const \[provRes, delRes\] = await Promise\.all/.test(dsCtl),
  '域名详情页首屏请求并行化，不再串行等五段往返');
check((dsPage.match(/id="presets"/g) || []).length === 1
  && /#presets \.preset/.test(dsCtl),
  '重复 id="presets" 已删，预设点击不再误绑委派页卡片');
check(/切换域名/.test(dsDocsZh) && /Switch domain/.test(dsDocsEn)
  && /切换域名/.test(dsReadme), '中英文档与 README 写明整页切换口径');
check(/域名详情切换与记录重复回归/.test(dsCI)
  && /domain-switch-records-regression\.ts/.test(dsReg), '专项回归进 CI');

/* 按后缀暂停后「一定无法点击提交注册」：
   旧 React onCapPass 无条件 btn.disabled=false 会冲掉暂停锁。
   现在统一走 src/app/lib/applyPause.ts，allowed=false 绝不解锁。 */
const apLib = read('src/app/lib/applyPause.ts');
const apReg = read('src/app/legacy/register.ts');
const apPage = read('src/app/pages/Register.tsx');
const apCss = read('src/app/styles/design-system.css');
const apWhois = read('src/app/legacy/whois.ts');
const apDocsZh = read('docs-src/settings.md');
const apDocsEn = read('docs-src/en/settings.md');
const apReadme = read('README.md');
const apCI = read('.github/workflows/deploy.yml');
const apRegS = read('scripts/apply-pause-lock-regression.ts');
check(/export function unlockApplyButton\(el: any, allowed: boolean\)/.test(apLib)
  && /if \(!el \|\| !allowed\) return/.test(apLib),
  '按钮解锁唯一入口：allowed=false 绝不解锁');
check(/lockApplyButton\(btn\)/.test(apReg) && /unlockApplyButton\(/.test(apReg)
  && !/btn\.disabled = false/.test(apReg),
  'legacy 用统一锁函数，无散装重新启用');
check(!/btn\.disabled = false/.test(apPage)
  && /unlockApplyButton\(btn, !locked\)/.test(apPage),
  'React 滑块回调不再无条件启用按钮（暂停锁不被冲掉）');
check(/__TD_APPLY_LOCKED__/.test(apReg) && /__TD_APPLY_LOCKED__/.test(apPage)
  && /__TD_CAPTCHA_CLOSE__/.test(apReg) && /__TD_CAPTCHA_CLOSE__/.test(apPage),
  'legacy 与 React 共用判定，暂停时关闭已打开的验证弹窗');
const apDo = apReg.slice(apReg.indexOf('async function doSubmit()'), apReg.indexOf('async function doSubmit()') + 400);
check(/applyLockNow\(\)/.test(apDo) && /if \(applyLockNow\(\)\.paused\)/.test(apReg),
  'doSubmit 与 loadPending 都再核一次当前后缀');
check(/pointer-events: none !important/.test(apCss) && /is-apply-paused/.test(apCss),
  'CSS 兜底：旧缓存 JS 也点不动');
check(/isApplyPausedFor/.test(apWhois) && /该后缀已暂停新申请/.test(apWhois),
  'WHOIS 对暂停后缀不给申请入口');
check(/无法点击提交注册/.test(apDocsZh) && /cannot be clicked/i.test(apDocsEn)
  && /无法点击提交注册/.test(apReadme),
  '中英文档与 README 写明硬锁口径');
check(/提交注册硬锁回归/.test(apCI) && /apply-pause-lock-regression\.ts/.test(apRegS),
  '专项回归进 CI');

/* 被暂停根域名：不可见 / 不可点 / 自动切主推。
   旧版把后缀选择器一起 disabled，切到暂停后缀就再也切不回来。 */
const pvLib = read('src/app/lib/applyPause.ts');
const pvReg = read('src/app/legacy/register.ts');
const pvHome = read('src/app/legacy/home.ts');
const pvWhois = read('src/app/legacy/whois.ts');
const pvTpl = read('src/html/root-meoy.ts');
/* 三份根域名静态落地页是仓库外的独立交付物（巡检明确禁止仓库跟踪 .html），
   CI 里可能不存在。用条件读取：本地有就严格查，CI 没有则只依赖仓库内的
   TS 模板断言，绝不因为找不到文件让整个巡检崩掉。 */
const maybeRead = (p: string) => { try { return read(p); } catch { return ''; } };
const pvHtml = maybeRead('../root-pages/noxc.uk.html');
const pvCss = read('src/app/styles/design-system.css');
const pvDocsZh = read('docs-src/settings.md');
const pvDocsEn = read('docs-src/en/settings.md');
const pvReadme = read('README.md');
const pvCI = read('.github/workflows/deploy.yml');
const pvRegS = read('scripts/paused-root-visibility-regression.ts');
check(/export function availableRoots/.test(pvLib) && /export function sortPreferred/.test(pvLib)
  && /export function rootsForPicker/.test(pvLib)
  && /PRIMARY_ROOT = 'noxc.uk'/.test(pvLib) && /paused\.has\(d\)/.test(pvLib),
  '可申请过滤 / 选择器全量列表 / 主推判定收敛在唯一共享模块');
check(/list = rootsForPicker\(list\)/.test(pvReg) && /function autoSwitchToPrimary/.test(pvReg)
  && /history\.replaceState/.test(pvReg),
  '注册页保留暂停项（灰显不可点）、自动切主推并改写 URL');
check(/disabled aria-disabled="true"/.test(pvReg) && /function primaryRoot\(\)\{ return preferredRoot\(ROOTS\); \}/.test(pvReg),
  '暂停项看得见但点不动，默认/自动切换只认开放后缀');
check(/if \(isApplyPausedFor\(d\)\)/.test(pvReg) && !/rootPickerBtn/.test(
  pvReg.slice(pvReg.indexOf('function setApplyPaused'), pvReg.indexOf('function clearApplyPaused'))),
  '选择器永不锁死，旧缓存点到暂停项也跳主推');
check(/const preferNoxc = \(list\) => sortPreferred\(list\)/.test(pvHome),
  '首页可申请后缀卡片 / 查询下拉仍剔除暂停后缀');
check(!/\.filter\(\(r\) => !isApplyPausedFor\(r\.domain\)\)/.test(pvHome)
  && !/if \(isApplyPausedFor\(HOTTEST\)\) HOTTEST = ''/.test(pvHome)
  && /rv-bd-paused/.test(pvHome),
  '统计展开与 HOT 照常显示暂停后缀（暂停 ≠ 不存在），只做灰显标注');
check(/sortPreferred\(/.test(pvWhois) && /__NOXC_PRIMARY_ROOT__/.test(pvTpl)
  && (!pvHtml || /__NOXC_PRIMARY_ROOT__/.test(pvHtml)),
  'WHOIS 与根域名落地页同样过滤并回落主推（仓库外静态页存在时一并核对）');
check(/\.root-opt\[data-paused="1"\]/.test(pvCss) && /\.rv-bd-paused/.test(pvCss),
  'CSS 点击兜底与统计灰显标注都存在');
check(/自动切换|主推域名/.test(pvDocsZh) && /automatically|primary suffix/i.test(pvDocsEn)
  && /主推域名/.test(pvReadme), '中英文档与 README 写明自动切换口径');
check(/暂停后缀可见性回归/.test(pvCI) && /paused-root-visibility-regression\.ts/.test(pvRegS),
  '专项回归进 CI');

/* D1 读取优化 + 第三方域名接入：5M rows read 事故防回流 */
const d1Stats = read('src/lib/publicStats.ts');
const d1Cache = read('src/lib/configCache.ts');
const d1Idx = read('src/index.ts');
const d1Runtime = read('src/app/lib/runtime.ts');
const d1Reg = read('src/app/legacy/register.ts');
const d1Schema = read('schema.sql');
const d1Route = read('src/routes/externalDomains.ts');
const d1Dash = read('src/app/pages/Dashboard.tsx');
const d1Whois = read('src/routes/whois.ts');
const d1DocsZh = read('docs-src/settings.md');
const d1DocsEn = read('docs-src/en/settings.md');
const d1Readme = read('README.md');
const d1CI = read('.github/workflows/deploy.yml');
const d1RegS = read('scripts/d1-read-external-domain-regression.ts');
check(/public_stats_snapshot/.test(d1Stats) && /snapshotTtl/.test(d1Stats)
  && /invalidatePublicStats/.test(d1Stats),
  '公开统计：settings 表一行 JSON 快照 + 写路径主动失效');
check(/getConfigCache\(\)/.test(d1Idx) && /c\.req\.query\('_'\)/.test(d1Idx)
  && /invalidatePublicConfig\(\)/.test(d1Idx) && /CONFIG_CACHE_CONTROL/.test(d1Idx),
  'config 整响应缓存 + cache-buster + 全局写后失效');
check(/Date\.now\(\) - brandAt > 60_000/.test(d1Runtime)
  && /600\);/.test(d1Reg) && /15_000/.test(d1Reg) && /checkSeq/.test(d1Reg),
  '前端 SWR 60 秒节流 + 注册页打字节流');
check(/CREATE TABLE IF NOT EXISTS external_domains/.test(d1Schema)
  && /idx_external_user/.test(d1Schema)
  && !/external_domains/.test(d1Stats),
  '外部域名独立表 + 用户索引，不参与公开统计全表扫描');
check(/EXTERNAL_LABEL = '（外部域名）'/.test(d1Route)
  && /externalLabel: EXTERNAL_LABEL/.test(d1Whois)
  && /id="externalCard"/.test(d1Dash),
  '列表 / WHOIS / 控制台统一标（外部域名）');
const extTable = d1Schema.slice(d1Schema.indexOf('CREATE TABLE IF NOT EXISTS external_domains'),
  d1Schema.indexOf('CREATE INDEX IF NOT EXISTS idx_external_user'));
check(/apiKey/.test(d1Route) && !/api_?key|token/i.test(extTable.replace(/verify_token/g, '')),
  '供应商 API key 只在请求中使用，不落库');
check(/checkOwnership/.test(d1Route) && /verify_status/.test(d1Route)
  && /connectProvider/.test(d1Route) && /addRecord/.test(d1Route),
  '外部域名三步流程：TXT 验证 → 连接供应商 → 写 DNS 记录');
check(/nsWarning/.test(d1Route) && /NS 尚未指向该供应商/.test(d1Route),
  '接口明确提示「NS 未改前记录不生效」，不假装加了 TXT 就能解析');
check(/applyCard[\s\S]{0,400}<ExternalDomains \/>/.test(d1Dash),
  '第三方域名接入放在「注册域名」卡片下面');
check(/isNameInDomain/.test(read('src/lib/providerDns.ts'))
  && /cloudflare-dns\.com\/dns-query/.test(read('src/lib/externalVerify.ts')),
  '写入名称限定在本域名内，TXT 验证走 DoH');
check(/外部域名|D1 读取优化/.test(d1DocsZh) && /external domain|D1 read/i.test(d1DocsEn)
  && /附录 Z · 故障排查与已知错误（固定放在文末）/.test(d1Readme)
  && d1Readme.lastIndexOf('## 附录 Z') > d1Readme.lastIndexOf('## 附录 ·'),
  '中英文档与 README 写明外部域名；错误统一放文末');
check(/D1 读取与第三方域名回归/.test(d1CI)
  && /d1-read-external-domain-regression\.ts/.test(d1RegS), '专项回归进 CI');

/* ── 第二轮 D1 读取优化防回流（2026-11-23，日读取 1.52M/5M 后继续优化） ── */
const idxSrc = read('src/index.ts');
const bootSrc = read('src/middleware/bootstrap.ts');
const scSrc = read('src/lib/settingsCache.ts');
const phase2 = read('scripts/d1-read-phase2-regression.ts');
check(/app\.use\('\*', bootstrap\)/.test(idxSrc)
  && !/app\.use\('\*', attachUser\)/.test(idxSrc)
  && !/await ensureCoreColumns\(c\.env\)/.test(idxSrc)
  && !/await ensureOauthTables\(c\.env\)/.test(idxSrc),
  'index.ts 只挂 bootstrap，旧的逐请求 D1 中间件不再叠层');
check(/app\.use\('\*', bootstrap\)/.test(idxSrc)
  && /isStaticAsset\(path\)\) return next\(\)/.test(bootSrc),
  '静态资源整段跳过数据库上下文（第二轮主要收益）');
check(/invalidatePublicConfig\(\);[\s\S]{0,600}invalidateSettings\(\);/.test(idxSrc),
  '写操作同时失效 config 与统一配置缓存，保存即生效不破');
check(/inflight\.get\(key\)|const pending = fresh/.test(scSrc)
  && /inflight\.set\(key, task\)/.test(scSrc),
  '统一配置层有并发 in-flight 去重，Promise.all 不会击穿缓存');
check(/WeakMap/.test(scSrc) && /readSettingFresh/.test(scSrc),
  '按 D1 binding 隔离缓存，凭据类读取仍直查不走缓存');
check(/if \(added\.includes\('root_domain'\)\)[\s\S]{0,300}UPDATE subdomains SET root_domain/.test(read('src/lib/showcase.ts')),
  '正常库不再每 isolate 跑全表回填 UPDATE');
check(/runtime_migrations_v3/.test(read('src/lib/runtimeMigrations.ts')),
  '运行时补列用 settings marker 做跨 isolate 幂等');
const unified = ['rootStore','emailRule','reserved','captcha','nodeloc','github',
  'showcaseReward','expiry','util','applyGate','aiReview'];
for (const m of unified) {
  check(/settingsCache\.js/.test(read(`src/lib/${m}.ts`)),
    `${m}.ts 已接入统一配置层，不再逐 key 查 settings`);
}
check(/d1-read-phase2-regression\.ts/.test(read('.github/workflows/deploy.yml'))
  && /静态资源零 D1/.test(phase2),
  '第二轮专项回归进 CI 且覆盖静态资源零 D1');
check(/EXTERNAL_DOMAINS_COMING_SOON = true/.test(d1Route)
  && /app\.use\('\*'/.test(d1Route) && /503/.test(d1Route)
  && /即将上线/.test(d1Dash) && /即将上线/.test(read('src/app/pages/Register.tsx'))
  && /即将上线/.test(d1Readme),
  '第三方域名接入标「即将上线」：前后端统一闸门，接口不可用');
check(!/dashboard#externalCard/.test(read('src/app/pages/Register.tsx'))
  && !/api\.(post|del)\(/.test(d1Dash.slice(d1Dash.indexOf('function ExternalDomains'), d1Dash.indexOf('/** Dashboard'))),
  '注册页不给跳转、控制台卡片不含表单提交');




/* ── 数据备份导出 / 重新汇入防回流 ── */
const bkFmt = read('src/lib/backupFormat.ts');
const bkRoute = read('src/routes/backup.ts');
const bkIdx = read('src/index.ts');
const bkAdmin = read('src/app/pages/Admin.tsx');
const bkLegacy = read('src/app/legacy/admin.ts');
const bkReg = read('scripts/backup-regression.ts');
check(/USERS_COLS|SUBDOMAINS_COLS/.test(bkFmt)
  && /csvCell|parseCsv|csvToObjects/.test(bkFmt)
  && /SETTINGS_FORMAT = 'noxc-settings-backup'/.test(bkFmt),
  '备份格式层：固定列清单 / CSV 编解码 / JSON format 标记');
check(/SENSITIVE_SETTING_KEYS/.test(bkFmt) && /isInternalSettingKey/.test(bkFmt),
  '凭据 key 识别、内部运行态 key 排除');
check(/maskSecrets/.test(read('src/routes/backup.ts'))
  && !/includeSecrets/.test(read('src/routes/backup.ts'))
  && /emptyKeys/.test(read('src/routes/backup.ts')),
  '站点设置 JSON 默认完整导出凭据；只有 maskSecrets=1 才脱敏，并标注 emptyKeys');
check(/生成脱敏副本/.test(read('src/app/legacy/admin.ts')),
  '后台导出面板默认不脱敏，脱敏是可选副本');
check(/app\.route\('\/api\/admin\/backup', backupRoutes\)/.test(bkIdx)
  && /requireAdmin\(c\)/.test(bkRoute),
  '备份路由挂在管理员前缀下，且路由内二次校验身份');
check(/dryRun/.test(bkRoute) && /dryRun === true/.test(bkRoute)
  && /dryRun: true/.test(bkLegacy) && /dryRun: false/.test(bkLegacy)
  && /bkConfirm'\)\.disabled = false/.test(bkLegacy),
  '汇入两步：预览不写库，确认才入库');
check(/密码哈希与角色永远不动|永不覆盖|不覆盖/.test(bkRoute)
  && /脱敏的空密钥/.test(bkRoute),
  'replace 不改密码哈希 / 角色，空密钥不冲掉现有配置');
check(/owner_email/.test(bkFmt) && /owner_email/.test(bkRoute),
  '子域名备份带所属邮箱，跨库可重建归属');
check(/data-tab="backup"/.test(bkAdmin) && /bkExpSubs|bkExpUsers|bkExpSettings/.test(bkLegacy),
  '后台「数据备份」页签与三个导出按钮都在');
check(!/[\u{1F300}-\u{1FAFF}]/u.test(bkLegacy.slice(bkLegacy.indexOf('数据备份：导出'), bkLegacy.indexOf("if (tab === 'settings')"))),
  '备份面板零 emoji');
check(/backup\\\/import/.test(bkIdx) && /invalidatePublicStats/.test(bkIdx),
  '汇入用户 / 子域名会失效公开统计快照');
check(/### 14\. 数据备份/.test(read('README.md'))
  && /### Z\.6 数据备份/.test(read('README.md')),
  'README 正文说明能力、注意事项按约定收在文末附录 Z');
check(/backup-regression\.ts/.test(read('.github/workflows/deploy.yml'))
  && /导出 → 清空 → 汇入|round-trip/.test(bkReg),
  '备份专项回归进 CI 且覆盖完整 round-trip');


/* ── NodeLoc 3.0 形态层防回流（颜色保持现在的） ── */
const ynSkin = read('src/app/styles/nodeloc-skin.css');
const ynMain = read('src/app/main.tsx');
const ynHome = read('src/app/pages/Home.tsx');
const ynCode = ynSkin.replace(/\/\*[\s\S]*?\*\//g, '');
check(!/#[0-9a-fA-F]{3,8}\b/.test(ynCode) && !/\brgba?\(/.test(ynCode) && !/\bhsla?\(/.test(ynCode),
  '形态层零颜色字面量，明/暗色值仍由 design-system.css 独占');
check(!/--zx-(paper|ink|blue|body|muted|hair|danger|warn)\s*:/.test(ynCode),
  '形态层不重定义 --zx-* 颜色令牌');
const ynImports = [...ynMain.matchAll(/import '([^']+\.css)'/g)].map((m) => m[1]);
check(ynImports.at(-1) === './styles/nodeloc-skin.css', '形态层最后加载，删掉即可回滚');
check(/--nl-r-pill|var\(--nl-r-lg\)/.test(ynSkin) && /--zx-mono:\s*ui-monospace/.test(ynSkin)
  && /rv-ask[\s\S]{0,400}display: grid !important/.test(ynSkin),
  'NodeLoc 3.0 圆角收口 / 等宽字 / 两段式查询都在形态层');
check(/html body \.side-group \{/.test(ynSkin) && /html body \.site-announcement \{/.test(ynSkin)
  && /border-radius: var\(--nl-r-round\) !important/.test(ynSkin),
  '侧栏分组圆角卡 / 公告横幅 / 圆形图标按钮都在形态层');
check(/8 · 效果层/.test(ynSkin) && /radial-gradient\(circle at 1px 1px/.test(ynSkin)
  && /@keyframes nl-glow/.test(ynSkin) && /@keyframes nl-dot/.test(ynSkin)
  && (ynSkin.match(/@keyframes nl-/g) || []).length === 2,
  '效果层：柔光 + 点阵 + 恰好两条循环呼吸动画，纯白不闷');
check(!/backdrop-filter/.test(ynSkin) && !/pageTransition|tdTransition|miku-pop/.test(ynSkin),
  '效果层没恢复毛玻璃，也没恢复已删除的切页过渡');
const ynAll = read('src/app/styles/shell.css') + read('src/app/styles/design-system.css');
check(!/border-radius:\s*0\s*!important/.test(ynAll),
  '源头零直角：shell.css / design-system.css 不再有 border-radius: 0 !important');
check(/id="ynMotion"/.test(ynHome) && /noxc-motion-paused/.test(ynHome)
  && /id="how"/.test(ynHome) && /data-yn-try=/.test(ynHome),
  '暂停动效 / How it works / Try 示例都在首页');
check(/不发任何查询请求/.test(ynHome), 'Try 示例零接口请求，不增加 D1 读取');
check(/nodeloc-skin-regression\.ts/.test(read('.github/workflows/deploy.yml')),
  'NodeLoc 3.0 皮肤专项回归进 CI');
check(/### 15\. 界面风格/.test(read('README.md'))
  && /### Z\.7 界面风格与形态层的常见错误/.test(read('README.md')),
  'README 正文描述能力、错误按约定收在文末 Z.7');

/* ── AnyNS（n.ht 社区）管理 API 防回流 ── */
const anynsClient = read('src/lib/anynsDns.ts');
const anynsDeleg = read('src/lib/delegation.ts');
const anynsProv = read('src/lib/providerDns.ts');
const anynsExt = read('src/routes/externalDomains.ts');
const anynsReg = read('scripts/anyns-api-regression.ts');
check(/https:\/\/anyns\.io/.test(anynsClient) && /nhtdns_/.test(anynsClient)
  && /\/api\/dns\/v1\/zones/.test(anynsClient)
  && /\/api\/dns\/v1\/zones\/:id\/records|\/api\/dns\/v1\/zones\/\$\{encodeURIComponent/.test(anynsClient),
  'AnyNS 客户端走官方文档端点与 nhtdns_ 管理令牌');
check(/provider\.key === 'anyns'/.test(anynsDeleg)
  && /anynsEnsureZone/.test(anynsDeleg)
  && /management: true/.test(anynsDeleg),
  'NS 委派预设 anyns 已挂官方管理 API，不再是 api:null');
check(/providerKey === 'anyns'/.test(anynsProv)
  && /anynsRelativeName/.test(anynsProv)
  && /ANYNS_RECORD_TYPES/.test(anynsProv),
  '第三方域名接入支持 anyns 供应商（相对名 / 记录类型守卫）');
check(/PROVIDERS = \['cloudflare', 'dnshe', 'seus', 'anyns'\]/.test(anynsExt)
  && /EXTERNAL_DOMAINS_COMING_SOON = true/.test(anynsExt),
  '供应商清单扩为四家，但「即将上线」闸门未被擅自打开');
check(/anyns-api-regression\.ts/.test(anynsReg) && /anyns-api-regression\.ts/.test(read('.github/workflows/deploy.yml')),
  'AnyNS 专项回归挂进 CI');
check(/### 19\. AnyNS/.test(read('README.md')) && /### Z\.10 AnyNS/.test(read('README.md')),
  'README 正文写能力、错误按约定收在文末 Z.10');

/* ── meoy.top 暂停解析 + 站点级 AnyNS 后端（n.ht 社区管理 API）防回流 ── */
const dnsPauseLib = read('src/lib/dnsPause.ts');
const anynsBackendLib = read('src/lib/anynsBackend.ts');
const cfLib = read('src/lib/cf.ts');
const migrationReg = read('scripts/anyns-migration-regression.ts');
check(/DNS_PAUSED_DEFAULT = ''/.test(dnsPauseLib)
  && /DEFAULT_MIGRATION_NOTICE = ''/.test(dnsPauseLib)
  && /DNS_PAUSED_LABEL = '暂停解析'/.test(dnsPauseLib)
  && /settingsCache/.test(dnsPauseLib),
  '迁移完成：默认不暂停、不下发迁移提示，状态文案与统一配置缓存保留');
check(!/UPDATE subdomains SET status/.test(dnsPauseLib)
  && /status 仍是 approved|保留 status/.test(dnsPauseLib),
  '暂停解析不批量改 subdomains.status，公开统计 / 续期 / 配额不受影响');
check(/ANYNS_API_TOKEN/.test(anynsBackendLib)
  && /anyns_api_token/.test(anynsBackendLib)
  && /anynsServerConfigFull/.test(anynsBackendLib)
  && /anynsRelativeName/.test(anynsBackendLib),
  '站点级 AnyNS 令牌来自 Worker Secret 或后台站点设置，根域名用官方 @ 相对名');
check(/p.backend === 'anyns'/.test(cfLib)
  && /anynsRootEnabled/.test(cfLib)
  && (cfLib.match(/backend === 'anyns'/g) || []).length >= 4,
  'cf.ts 四个写/读入口都接了 AnyNS 后端');
check(/dnsWriteBlock/.test(read('src/routes/records.ts'))
  && /dnsPausedRoots/.test(read('src/index.ts'))
  && /mountMigrationNotice/.test(read('src/app/lib/runtime.ts')),
  '写闸门 / config 下发 / 迁移提示条三处一致');
check(/anyns-migration-regression\.ts/.test(migrationReg)
  && /anyns-migration-regression\.ts/.test(read('.github/workflows/deploy.yml')),
  '暂停解析专项回归挂进 CI');
/* 迁移收尾：重新开启 meoy.top 解析（一次性幂等迁移，不误伤管理员后续设置） */
const schemaSrc = read('schema.sql');
check(/VALUES \('dns_paused_roots', ''\)/.test(schemaSrc)
  && /VALUES \('dns_migration_notice', ''\)/.test(schemaSrc)
  && /runtime_migrations_dns_pause_anyns_done/.test(schemaSrc)
  && /AND value = 'meoy\.top'/.test(schemaSrc)
  && /UPDATE settings SET value = ''/.test(schemaSrc),
  'schema 默认恢复解析 + 一次性幂等迁移清线上旧值，marker 防重复清');
check(/DNS_PAUSED_DEFAULT/.test(read('src/index.ts'))
  && !/DEFAULT_MIGRATION_NOTICE/.test(read('src/index.ts'))
  && !/\? 'meoy\.top' :/.test(read('src/index.ts'))
  && /dnsPausedRoots: raw\.dns_paused_roots === undefined \? '' :/.test(read('src/routes/admin.ts')),
  '公开 config 与后台 GET 默认值也为空，不再默认冻结解析');
check(/解析已恢复/.test(read('src/app/legacy/admin.ts'))
  && /dnsPauseStateHint/.test(read('src/app/legacy/admin.ts')),
  '后台站点设置显示「解析已恢复」状态提示');
check(/老库跑一次 schema/.test(migrationReg) && /node:sqlite/.test(migrationReg),
  '专项回归用 node:sqlite 真跑 schema 迁移幂等性');
check(/### 21\. meoy\.top/.test(read('README.md')) && /### Z\.12/.test(read('README.md')),
  'README 正文写能力、错误按约定收在文末 Z.12');
/* 后台「站点设置 → AnyNS」：令牌可填、只回掩码、保存即生效 */
const admSettings = read('src/routes/admin.ts');
const admSettingsUi = read('src/app/legacy/admin.ts');
check(/'anyns_api_token'/.test(admSettings) && /anynsApiToken/.test(admSettings)
  && /anynsClearToken/.test(admSettings) && /tokenMasked/.test(admSettings),
  '后台 GET 只回掩码、POST 可保存 / 清除 AnyNS 令牌');
check(/invalidateSettings\(\)/.test(admSettings)
  && /clearDnsProviderCache\(\)/.test(admSettings)
  && /clearAnynsConfigCache\(\)/.test(admSettings),
  '保存后统一失效三层缓存，设置立即生效');
check(/id="sAnynsToken"/.test(admSettingsUi) && /id="sDnsPausedRoots"/.test(admSettingsUi)
  && /anynsApiToken:/.test(admSettingsUi) && /d\.anyns/.test(admSettingsUi),
  '站点设置页面有 AnyNS 卡片、保存字段与掩码渲染');
check(/'anyns_api_token'/.test(read('src/lib/backupFormat.ts')),
  '备份脱敏副本会把 anyns_api_token 置空');
check(/anyns_api_token/.test(read('schema.sql')),
  'schema 预置空的配置项，后台首次打开不会显示 undefined');

/* 后台「根域名管理」：拉取 AnyNS 域名 + 下拉 AnyNS 选项 */
const rootStoreSrc = read('src/lib/rootStore.ts');
const anynsBackendSrc = read('src/lib/anynsBackend.ts');
const cfBackendSrc = read('src/lib/cf.ts');
check(/const BACKENDS = \['spaceship', 'cloudflare', 'anyns'\]/.test(rootStoreSrc)
  && /anyns_zone_ids/.test(rootStoreSrc) && /anynsZoneId/.test(rootStoreSrc),
  '根域名后端白名单含 anyns，AnyNS zone 映射与 CF Zone 分开存');
check(/anynsAdminFetchDomains/.test(anynsBackendSrc)
  && /anynsAdminAddRoots/.test(anynsBackendSrc)
  && /anynsListZones/.test(anynsBackendSrc)
  && /invalidateSettings\(\);[\s\S]{0,200}setDnsBackend/.test(anynsBackendSrc),
  '拉取域名 / 批量导入齐全，且写入之间失效缓存避免互相覆盖');
check(/value="anyns"/.test(admSettingsUi) && /id="anFetch"/.test(admSettingsUi)
  && /openAnynsPicker/.test(admSettingsUi) && /ANYNS DNS/.test(admSettingsUi),
  '根域名管理有 AnyNS 下拉选项、拉取按钮与选择弹窗');
check(/anyns\/domains/.test(admSettings) && /anyns\/add/.test(admSettings),
  '后台有 AnyNS 拉取与导入接口');
check(cfBackendSrc.indexOf("explicit === 'spaceship' || explicit === 'cloudflare') return explicit")
    < cfBackendSrc.indexOf("explicit === 'anyns' || anynsRootEnabled"),
  '显式后端优先于 ANYNS_ROOTS 自动推断，下拉能切回 Cloudflare');
check(/### 根域名管理：拉取域名/.test(read('README.md'))
  && /批量勾选只生效最后一个/.test(read('README.md')),
  'README 写清拉取流程、下拉选项与批量踩踏错误');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of errors) console.error('  ✗ ' + m);
console.log(`健康巡检：${ok.length} 通过，${errors.length} 失败`);
if (errors.length) process.exit(1);
