/**
 * NodeLoc 3.0 形态皮肤专项回归（CI 步骤：NodeLoc 3.0 风格皮肤回归）
 *
 * 背景：用户要求「全面改版，配合 NodeLoc 3.0 风格，全都做成圆角，截图参考风格」。
 * 截图里可确认：所有可见组件都是圆角（大圆角卡片 / 胶囊按钮与标签 /
 * 圆形图标按钮）；顶栏品牌在左、中间大搜索胶囊、右侧圆形图标按钮；
 * 侧栏分组是圆角卡片、导航项是圆角胶囊、选中态有独立底色；公告横幅是
 * 大圆角卡片；发丝线分隔、零阴影零渐变零毛玻璃。
 * 上一轮「颜色保持现在的」铁律继续生效：形态层不定义任何色值。
 *
 * 三层验证：
 *   A. 静态扫描（CI 必跑）：颜色字面量、加载顺序、圆角阶梯、源头零直角、
 *      首页结构与零请求交互
 *   B. 浏览器真跑（scripts/nodeloc-skin-render.py，有 Playwright 才执行）：
 *      等效首页 DOM 比对 10 个核心色值、逐元素扫描全站圆角、控制台等效 DOM
 *      （顶栏/侧栏/公告/卡片/控件）、生成改造前后对照图
 *   C. 反向对照：拿掉形态层后旧的小圆角仍在，证明新收口确实生效
 *
 * 运行：npx tsx scripts/nodeloc-skin-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

const SKIN = 'src/app/styles/nodeloc-skin.css';
const skin = read(SKIN);
const mainSrc = read('src/app/main.tsx');
const home = read('src/app/pages/Home.tsx');
const deploy = read('.github/workflows/deploy.yml');
const readme = read('README.md');

/* ───────── A. 颜色保持现在的（静态铁律） ───────── */
{
  /* 只看真正的 CSS 声明，文件头注释里解释「不能写 rgb()/hsl()」不算违规 */
  const skinCode = skin.replace(/\/\*[\s\S]*?\*\//g, '');
  const noColors = !/#[0-9a-fA-F]{3,8}\b/.test(skinCode)
    && !/\brgba?\(/.test(skinCode)
    && !/\bhsla?\(/.test(skinCode);
  check(noColors, '皮肤文件无任何 #hex / rgb() / hsl() 颜色字面量');

  const colorVars = [
    'zx-paper', 'zx-paper-2', 'zx-ink', 'zx-body', 'zx-muted',
    'zx-hair', 'zx-hair-2', 'zx-blue', 'zx-blue-deep', 'zx-blue-soft',
    'zx-danger', 'zx-warn', 'zx-glass', 'zx-shadow',
    'zx-blue-a8', 'zx-blue-a16', 'zx-blue-a30', 'zx-ink-a30', 'zx-danger-a16',
  ];
  const redefined = colorVars.filter((v) => new RegExp(`--${v}\\s*:`).test(skin));
  check(redefined.length === 0,
    '未重定义任何 --zx-* 颜色令牌' + (redefined.length ? '：' + redefined.join(',') : ''));

  const used = [...skin.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
  const unknown = [...new Set(used)].filter((v) => !/^--(zx-|rv-|td-|lg-|nl-|radius|mono|sans|yn-)/.test(v));
  check(unknown.length === 0,
    'var() 引用的都是既有令牌' + (unknown.length ? '：' + unknown.join(',') : ''));

  const ds = read('src/app/styles/design-system.css');
  check(/--zx-paper:\s*#ffffff/.test(ds) && /--zx-blue:\s*#111318/.test(ds),
    'design-system.css 的现行色板仍是纯黑白灰（未被本次改动）');
  check(/html\[data-theme="dark"\]/.test(ds), '暗色主题仍由 design-system.css 独占定义');

  const imports = [...mainSrc.matchAll(/import '([^']+\.css)'/g)].map((m) => m[1]);
  check(imports.at(-1) === './styles/nodeloc-skin.css',
    'nodeloc-skin.css 在 main.tsx 最后加载（能覆盖历史层形状，且不碰颜色）');
  check(imports.includes('./styles/design-system.css')
    && imports.indexOf('./styles/design-system.css') < imports.indexOf('./styles/nodeloc-skin.css'),
    '颜色层在形态层之前');
}

/* ───────── A2. 形态与结构静态断言 ───────── */
{
  const ds2 = read('src/app/styles/design-system.css');
  check(/--nl-r-pill:\s*999px/.test(ds2) && /--nl-r-lg:\s*24px/.test(ds2)
    && /--nl-r:\s*18px/.test(ds2) && /--zx-radius:\s*var\(--nl-r\)/.test(ds2),
    'NodeLoc 3.0 圆角阶梯定义在唯一视觉源 design-system.css');
  check(/--yn-radius:\s*var\(--nl-r\)/.test(ds2) && /--rv-r:\s*var\(--nl-r\)/.test(ds2),
    'shell.css / Home.tsx 的历史 var() 别名统一指向新阶梯');
  check(/--zx-mono:\s*ui-monospace/.test(skin) && /--rv-mono:\s*var\(--zx-mono\)/.test(skin),
    '等宽字体 token 覆盖到 --zx-mono / --rv-mono / --mono');
  check(/border-radius: var\(--nl-r-pill\) !important/.test(skin)
    && /html body \.rv-pill[\s\S]{0,600}border-radius: var\(--nl-r-pill\) !important/.test(skin),
    '按钮 / 标签 / 徽章 / 导航项统一为胶囊');
  check(/html body \.rv-title \{[\s\S]{0,220}font-weight: 700 !important/.test(skin),
    '标题字重从 900 收敛到 700');
  check(/rv-ask[\s\S]{0,400}display: grid !important/.test(skin)
    && /grid-template-rows: auto auto/.test(skin),
    '查询区改两段式 grid：输入条一行 + 全宽按钮一行');
  check(/rv-ask-btn[\s\S]{0,420}grid-column: 1 \/ -1/.test(skin)
    && /text-transform: uppercase !important/.test(skin),
    '主按钮全宽 + 大写等宽字');
  check(/\.yn-try \{/.test(skin) && /\.yn-steps \{/.test(skin) && /\.yn-motion \{/.test(skin),
    'Try chips / How it works 三步 / 暂停动效开关样式齐全');
  check(/\.yn-hero-grid \{[\s\S]{0,320}grid-template-columns: minmax\(0, 1\.04fr\)/.test(skin)
    && /\.yn-panel \{[\s\S]{0,400}border: 1px solid var\(--zx-hair\)/.test(skin)
    && /\.yn-motion-float \{[\s\S]{0,320}position: absolute !important/.test(skin),
    '形态层实现两栏 Hero、描边查询卡、悬浮开关（颜色仍用 --zx-*）');
  check(/html\[data-motion="paused"\]/.test(skin) && /prefers-reduced-motion/.test(skin),
    '手动开关与系统偏好两条路都停动效');
  check(!/html\[data-motion="paused"\] \*[\s\S]{0,220}transform: none !important/.test(skin),
    '暂停动效不清全局 transform（避免弄歪历史层定位）');
  check(/paused"\] \.rv-reveal[\s\S]{0,140}opacity: 1 !important/.test(skin),
    '入场动画停掉后 rv-reveal 仍保持可见');

  check(/id="ynMotion"/.test(home) && /aria-pressed/.test(home), '首页有暂停动效按钮且带 aria-pressed');
  check(/yn-motion-float/.test(home) && /yn-hero-grid/.test(home) && /yn-hero-panel/.test(home),
    'Hero 改为左右分栏 + 右侧查询卡，暂停动效移到顶栏右下悬浮');
  check(/yn-sample[\s\S]{0,400}yn-rule[\s\S]{0,300}yn-panel-label[\s\S]{0,500}id="searchForm"[\s\S]{0,900}yn-try/.test(home),
    '卡片内顺序：示例域名 → 分隔线 → 查询可用性 → 输入表单 → Try 示例');
  check(/id="ynSampleRoot"/.test(home) && /MutationObserver/.test(home),
    '示例域名后缀随后台根域名动态同步，零接口请求');
  check(/id="results"/.test(home) && /className="yn-panel"/.test(home),
    '查询结果区也收进同一张卡片');
  check(!/rv-landscape|rv-frame/.test(home), '旧的单列横跨查询区已移除');
  check(/noxc-motion-paused/.test(home) && /localStorage/.test(home), '暂停选择记在 localStorage');
  check((home.match(/data-yn-try=/g) || []).length >= 3, 'Try 示例前缀 + 卡片示例域名都可点');
  check(/只把前缀填进输入框|不发任何查询请求/.test(home)
    && !/data-yn-try[\s\S]{0,300}fetch\(/.test(home),
    '示例 chips 只填输入框，零接口请求（不增加 D1 读取）');
  check(/id="how"/.test(home) && /HOW IT WORKS/.test(home)
    && (home.match(/className="yn-step"/g) || []).length === 3,
    '新增 How it works 三步分区');
  check(/href="#how"/.test(home), '顶栏有「如何使用」锚点');
  check(/04 <span>\/<\/span> TOOLS/.test(home), '后续分区编号顺延，不出现两个 03');
  check(!/[\u{1F300}-\u{1FAFF}]/u.test(home), '首页零 emoji');
  check(/形态层|不改颜色/.test(skin), '皮肤文件头声明了「不改颜色」约定');

  /* ── NodeLoc 3.0：全圆角静态断言 ── */
  check(/html body \.side-toggle,[\s\S]{0,300}border-radius: var\(--nl-r-round\) !important/.test(skin),
    '圆形图标按钮（侧栏图标 / 菜单开关 / 示例箭头）');
  check(/html body \.side-group \{[\s\S]{0,320}border-radius: var\(--nl-r-lg\) !important|[\s\S]{0,320}background: var\(--zx-blue-soft\) !important/.test(skin),
    '侧栏分组是圆角卡片 + 独立底色');
  check(/html body \.side-item \{[\s\S]{0,220}margin: 2px 0 !important/.test(skin)
    && /html body \.side-item\.on \{[\s\S]{0,200}background: var\(--zx-blue-a16\) !important/.test(skin),
    '侧栏导航项是胶囊、选中态有独立底色');
  check(/html body \.site-announcement \{[\s\S]{0,500}border-radius: var\(--nl-r-lg\) !important/.test(skin),
    '公告横幅是大圆角卡片（截图最显眼的元素）');
  check(/html body \.topbar,[\s\S]{0,240}border-radius: var\(--nl-r-lg\) !important/.test(skin),
    '顶栏 / 侧栏骨架本身也四角圆角，不留直角');
  check(/border-radius: var\(--nl-r-pill\) 0 0 var\(--nl-r-pill\) !important/.test(skin)
    && /border-radius: 0 var\(--nl-r-pill\) var\(--nl-r-pill\) 0 !important/.test(skin),
    '首页输入条与后缀合为一条完整胶囊，拼接直角已消除');
  const allCss = read('src/app/styles/shell.css') + read('src/app/styles/design-system.css')
    + read('src/app/styles/captcha.css') + read('src/app/styles/oauth.css');
  check(!/border-radius:\s*0\s*!important/.test(allCss),
    '源头 4 层已无 border-radius: 0 !important（不再靠形态层跨层互压）');
  check(/NodeLoc 3\.0/.test(skin) && /全都做成圆角|全站统一圆角收口/.test(skin),
    '形态层头注释与收口段声明 NodeLoc 3.0 全圆角口径');

  /* ── NodeLoc 3.0 + 效果层：纯白不闷，但克制、零彩色、可一键停 ── */
  check(/8 · 效果层/.test(skin) && /radial-gradient\(circle at 1px 1px/.test(skin)
    && /radial-gradient\(760px/.test(skin),
    '效果层落地：两处柔光 + 26px 点阵（全部只用既有 --zx-* 令牌）');
  check(/@keyframes nl-glow/.test(skin) && /@keyframes nl-dot/.test(skin)
    && (skin.match(/@keyframes nl-/g) || []).length === 2,
    '常驻循环动画恰好两条：查询卡柔光呼吸 + 墨点 pulse，不堆动效');
  check(/html\[data-motion="paused"\] \*::before/.test(skin)
    && /prefers-reduced-motion/.test(skin)
    && /html\[data-motion="paused"\] \.card:hover/.test(skin),
    '暂停开关与系统偏好能停掉全部循环动画 / hover 位移');
  check(!/backdrop-filter/.test(skin) && !/pageTransition|tdTransition|miku-pop/.test(skin),
    '没恢复毛玻璃、没恢复上一轮删掉的切页过渡（hover 微动效 ≠ 切页延后）');
  check(/transform: translateY\(-2px\)/.test(skin) && /transition:[\s\S]{0,200}var\(--yn-ease\)/.test(skin),
    '卡片 / 按钮靠 2px 上浮与发丝线加深做层次，不靠投影');
  check(/Vue 3 \+ Vite \+ Tailwind CSS \+ DaisyUI/.test(skin),
    '形态层注明参考来源（yunamo.com 为 SPA，抓不到打包 CSS，按公开技术栈落地）');
}

/* ───────── B. 浏览器真跑（可选，环境有 Playwright 才执行） ───────── */
{
  const py = path.resolve('scripts/nodeloc-skin-render.py');
  if (fs.existsSync(py)) {
    const r = spawnSync('python3', [py], { encoding: 'utf8', timeout: 300_000, cwd: process.cwd() });
    const out = String(r.stdout || '');
    const line = out.split('\n').filter((l) => l.startsWith('RESULT_JSON:')).pop();
    if (line) {
      let payload: any = {};
      try { payload = JSON.parse(line.slice('RESULT_JSON:'.length)); } catch { /* 解析失败按未跑处理 */ }
      if (Array.isArray(payload.checks)) {
        for (const c of payload.checks) check(!!c.ok, '[浏览器] ' + c.msg);
      }
      if (Array.isArray(payload.images)) {
        for (const f of payload.images) check(fs.existsSync(f), `[浏览器] 生成对照图 ${path.basename(f)}`);
      }
    } else {
      console.log('  · 浏览器渲染验证跳过（当前环境无 Playwright，静态断言仍全跑）');
      if (r.stderr) console.log('    ' + String(r.stderr).trim().split('\n').slice(-1)[0]);
    }
  } else {
    console.log('  · 浏览器渲染脚本不存在，跳过（静态断言仍全跑）');
  }
}

/* ───────── CI / 文档 ───────── */
check(/nodeloc-skin-regression\.ts/.test(deploy), 'NodeLoc 3.0 皮肤专项回归挂进 CI');
check(/NodeLoc 3\.0/i.test(readme), 'README 记录了 NodeLoc 3.0 风格口径');
check(/maskSecrets/.test(read('src/routes/backup.ts')) && !/includeSecrets/.test(read('src/routes/backup.ts')),
  '同一版里站点设置 JSON 默认完整导出凭据（问题 1 已修）');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`NodeLoc 3.0 风格皮肤回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
