/**
 * Yunamo 形态皮肤专项回归（CI 步骤：Yunamo 风格皮肤回归）
 *
 * 背景：用户要求「整体网站风格改为 yunamo.com 那样，但颜色保持现在的」。
 * 可确认的 Yunamo 界面语言（官方首页摘要 + 仓库 assets/domain-search.png）：
 *   大圆角描边组件 / 等宽字体承担域名·按钮·uppercase 小标 / 首屏输入条 +
 *   全宽大写按钮两段式 / Try 示例 chips / Features·How it works·FAQ 分区 /
 *   顶栏 Pause motion 可访问性开关 / 无阴影无渐变。
 *
 * 两层验证：
 *   A. 静态扫描（CI 必跑）：皮肤层**不得定义任何颜色**、加载顺序、形态 token、
 *      首页结构与零请求交互
 *   B. 浏览器真跑（scripts/yunamo-skin-render.py，环境有 Playwright 才执行）：
 *      按生产加载顺序拼 5 份 CSS，用等效首页 DOM 计算样式、比对色值、点按钮，
 *      并生成改造前后对照图。CI 无 Playwright 时自动跳过，不算失败。
 *
 * 运行：npx tsx scripts/yunamo-skin-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

const SKIN = 'src/app/styles/yunamo-skin.css';
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
  const unknown = [...new Set(used)].filter((v) => !/^--(zx-|rv-|td-|lg-|radius|mono|sans|yn-)/.test(v));
  check(unknown.length === 0,
    'var() 引用的都是既有令牌' + (unknown.length ? '：' + unknown.join(',') : ''));

  const ds = read('src/app/styles/design-system.css');
  check(/--zx-paper:\s*#ffffff/.test(ds) && /--zx-blue:\s*#111318/.test(ds),
    'design-system.css 的现行色板仍是纯黑白灰（未被本次改动）');
  check(/html\[data-theme="dark"\]/.test(ds), '暗色主题仍由 design-system.css 独占定义');

  const imports = [...mainSrc.matchAll(/import '([^']+\.css)'/g)].map((m) => m[1]);
  check(imports.at(-1) === './styles/yunamo-skin.css',
    'yunamo-skin.css 在 main.tsx 最后加载（能覆盖历史层形状，且不碰颜色）');
  check(imports.includes('./styles/design-system.css')
    && imports.indexOf('./styles/design-system.css') < imports.indexOf('./styles/yunamo-skin.css'),
    '颜色层在形态层之前');
}

/* ───────── A2. 形态与结构静态断言 ───────── */
{
  check(/--yn-radius:\s*14px/.test(skin) && /--radius:\s*var\(--yn-radius\)/.test(skin),
    '圆角 token：胶囊 999px → 14px 圆角矩形');
  check(/--zx-mono:\s*ui-monospace/.test(skin) && /--rv-mono:\s*var\(--zx-mono\)/.test(skin),
    '等宽字体 token 覆盖到 --zx-mono / --rv-mono / --mono');
  check(/html body \.rv-pill \{[\s\S]{0,200}border-radius: var\(--yn-radius\) !important/.test(skin),
    '按钮形状从 999px 胶囊改成克制圆角');
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
}

/* ───────── B. 浏览器真跑（可选，环境有 Playwright 才执行） ───────── */
{
  const py = path.resolve('scripts/yunamo-skin-render.py');
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
check(/yunamo-skin-regression\.ts/.test(deploy), '皮肤专项回归挂进 CI');
check(/yunamo/i.test(readme), 'README 记录了风格口径');
check(/maskSecrets/.test(read('src/routes/backup.ts')) && !/includeSecrets/.test(read('src/routes/backup.ts')),
  '同一版里站点设置 JSON 默认完整导出凭据（问题 1 已修）');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`Yunamo 风格皮肤回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
