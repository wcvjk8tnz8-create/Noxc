/**
 * 移动端适配 · 静态防回流回归（NodeLoc 社区反馈「手机适配垃圾」）
 *
 * 浏览器逐元素实拍在 scripts/mobile-render.py（CI 无 Chromium 时自动跳过），
 * 这里用静态断言锁住每一个修复点，确保 CI 一定能阻断回流：
 *
 *   1. 顶栏溢出真凶：shell.css 的 button:not(...) 必须把 top-search / tb-stow
 *      排除出「强制 inline-flex !important」，否则 @media 里的 display:none
 *      永远不生效（特异性 0,4,1 压过一切）。
 *   2. yn-panel 柔光晕伪元素不能再用 right:-130px + 固定 360px 撑大
 *      scrollWidth（内容被裁、复制区域错位）。
 *   3. 形态层收口段：统一断点、盒模型、触控目标、标签换行、表格横滚、
 *      弹窗宽度、统计卡数字不断行、快捷入口 auto-fit。
 *   4. 颜色仍由 design-system.css 独占；CSS 仍是 5 层，形态层最后加载。
 *
 * 运行：npx tsx scripts/mobile-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

const shell = read('src/app/styles/shell.css');
const skin = read('src/app/styles/nodeloc-skin.css');
const design = read('src/app/styles/design-system.css');
const main = read('src/app/main.tsx');
const renderPy = read('scripts/mobile-render.py');
const deploy = read('.github/workflows/deploy.yml');
const readme = read('README.md');

/* ── 1. 顶栏根因：display:none 不能被 button:not(...) 压过 ── */
const btnNot = shell.match(/button:not\([^)]*\)[^,{]*,\s*\.zx-search-btn[^{]*\{[^}]*display:\s*inline-flex\s*!important/s);
check(!!btnNot && /:not\(\.top-search\)/.test(btnNot[0]) && /:not\(\.tb-stow\)/.test(btnNot[0]),
  'shell.css 的 button:not(...) 已排除 top-search / tb-stow，@media 的 display:none 能生效');
check(/#topSearch/.test(skin) && /#tbStow/.test(skin),
  '形态层用 #id 再兜底一次，防止以后有人改回全局 inline-flex');

/* ── 2. 查询卡柔光晕不再制造隐形横向内容 ── */
const glow = skin.match(/html body\.page-home \.yn-panel::before\s*\{[^}]*\}/s)?.[0] || '';
check(/right:\s*0\s*;/.test(glow) && /width:\s*min\(300px,\s*85%\)/.test(glow)
  && /height:\s*min\(300px,\s*85%\)/.test(glow),
  'yn-panel::before 贴右上角、尺寸受容器约束，不再撑大 scrollWidth');

/* ── 3. 收口段存在且断点收敛为三档 + 横屏 ── */
check(/9 · 移动端收口/.test(skin), '形态层带移动端收口段（删掉即可回滚）');
const mediaBlocks = [...skin.matchAll(/@media\s*\(([^)]*)\)\s*\{/g)].map((m) => m[1]);
check(mediaBlocks.includes('max-width: 1000px') && mediaBlocks.includes('max-width: 700px')
  && mediaBlocks.includes('max-width: 380px') && mediaBlocks.includes('max-width: 340px'),
  '统一断点：平板 1000 / 手机 700 / 窄屏 380 / 超窄 340');
check(/orientation:\s*landscape\)\s*and\s*\(max-height:\s*520px/.test(skin),
  '手机横屏单独收口，顶栏与弹窗不吃掉半屏');
check(!/@media\s*\(max-width:\s*(640|760|860|900|620|560|480|420|400)px\)\s*\{[^}]*移动端收口/s.test(skin),
  '收口段不引入新的零散断点（历史层的旧断点由它统一压过）');

/* ── 4. 盒模型 / 长文本 / 表单 ── */
check(/html, body \{ max-width: 100%; \}/.test(skin)
  && /html body \.main-in,[\s\S]{0,700}min-width: 0;[\s\S]{0,200}max-width: 100%;[\s\S]{0,80}box-sizing: border-box/.test(skin),
  '全宽度基础：容器 min-width:0 / max-width:100% / border-box');
check(/html body \.mono, html body \.fqdn, html body td, html body th[\s\S]{0,400}overflow-wrap: anywhere/.test(skin),
  '长域名 / 长邮箱可断行，不把卡片与表格单元格撑破');
check(/html body input, html body select, html body textarea, html body \.input[\s\S]{0,200}box-sizing: border-box/.test(skin),
  '表单控件 min-width:0 / max-width:100%');

/* ── 5. 平板与手机的顶栏 ── */
check(/@media \(max-width: 1000px\)[\s\S]{0,600}#topSearch[\s\S]{0,160}display: none !important/.test(skin),
  '≤1000 平板也收起顶栏搜索框');
check(/@media \(max-width: 700px\)[\s\S]{0,900}#tbStow[\s\S]{0,400}display: none !important/.test(skin),
  '≤700 手机收起搜索 / 收起按钮 / 次要元素，顶栏只留四项');
check(/\.topbar-in \.crumb[\s\S]{0,200}text-overflow: ellipsis/.test(skin),
  '面包屑可伸缩并省略，不再被挤成 0 宽');
check(/html body \.site-announcement[\s\S]{0,220}margin-left: 0 !important/.test(skin),
  '公告条侧栏补偿 margin 收口，消除平板 3px 隐形横向滚动');

/* ── 6. 触控目标 / 标签栏 ── */
check(/@media \(max-width: 1000px\)[\s\S]{0,1600}min-height: 44px !important/.test(skin)
  && /html body \.bgswitch button \{ min-height: 25px !important; \}/.test(skin),
  '≤1000 全触控目标 ≥44px（含 iPad），壁纸缩略图例外保持紧凑');
check(/html body \.tabs \{[\s\S]{0,260}flex-wrap: wrap !important/.test(skin)
  && /html body \.tabs \.tab[\s\S]{0,260}min-height: 44px !important/.test(skin),
  '标签栏换行而不是横排到屏幕外，每个标签 ≥44px');
check(/@media \(max-width: 700px\)[\s\S]{0,2600}font-size: 16px !important/.test(skin),
  '手机输入框 16px，防 iOS 聚焦自动缩放');

/* ── 7. 网格 / 表格 / 弹窗 ── */
check(/html body \.stat-row, html body \.stat-grid, html body \.stats,\s*html body \.zx-metrics[\s\S]{0,120}repeat\(2, minmax\(0, 1fr\)\)/.test(skin),
  '手机统计卡 2 列（不再被历史层压成通栏单列）');
check(/html body \.sc-num[\s\S]{0,60}white-space: nowrap/.test(skin)
  || /html body \.stat-v,[\s\S]{0,240}html body \.sc-num[\s\S]{0,220}white-space: nowrap/.test(skin),
  '统计卡数字（.sc-num）不断行，1,204 不会被拆成两行');
check(/html body \.quick-row[\s\S]{0,160}repeat\(auto-fit, minmax\(104px, 1fr\)\)/.test(skin),
  '快捷入口 7 个用 auto-fit 自适应，不固定列数留孤项');
check(/@media \(max-width: 340px\)[\s\S]{0,260}grid-template-columns: minmax\(0, 1fr\)/.test(skin),
  '单列只留给 ≤340 超窄屏，360/375 仍是两列');
check(/html body \.tablewrap[\s\S]{0,220}overflow-x: auto !important/.test(skin),
  '表格只在自己容器里横滚，不把整页撑宽');
check(/html body \.modal-card, html body \.modal \.box[\s\S]{0,260}calc\(100vw - 24px\)/.test(skin),
  '弹窗宽度受视口约束');

/* ── 8. 架构与颜色不变 ── */
const imports = [...main.matchAll(/import '([^']+\.css)'/g)].map((m) => m[1]);
check(imports.length === 5 && imports.at(-1) === './styles/nodeloc-skin.css'
  && imports.indexOf('./styles/design-system.css') === 3,
  'CSS 仍是 5 层，形态层最后加载，可整段删除回滚');
const skinCode = skin.replace(/\/\*[\s\S]*?\*\//g, '');
check(!/#[0-9a-fA-F]{3,8}\b/.test(skinCode) && !/\brgba?\(/.test(skinCode) && !/\bhsla?\(/.test(skinCode),
  '形态层零颜色字面量，明/暗色仍由 design-system.css 独占');
check(!/--zx-(paper|ink|blue|body|muted|hair|danger|warn)\s*:/.test(skinCode),
  '形态层不重定义 --zx-* 颜色令牌');
const used = [...skin.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
const unknown = [...new Set(used)].filter((v) => !/^--(zx-|rv-|td-|lg-|nl-|radius|mono|sans|yn-|safe-)/.test(v));
check(unknown.length === 0, 'var() 引用的都是既有令牌' + (unknown.length ? '：' + unknown.join(',') : ''));
check(/--zx-paper:\s*#ffffff/.test(design) && /--zx-blue:\s*#111318/.test(design),
  'design-system.css 现行黑白灰色板未被改动');

/* ── 9. 浏览器回归与 CI / 文档 ── */
check(/closest\('\.sidebar, \.user-menu, \.notif-panel, \.root-picker-menu, \.tablewrap'\)/.test(renderPy),
  '浏览器回归排除抽屉与表格横滚容器，不把设计性横滚误报为 bug');
check(/r\['sw'\] <= w \+ 1/.test(renderPy) && /r\.height < 43\.5/.test(renderPy),
  '浏览器回归检查页面级横向滚动与 44px 触控目标');
check(/mobile-regression\.ts/.test(deploy), '移动端静态回归挂进 CI');
check(/### Z\.13/.test(readme) && /手机适配/.test(readme),
  'README 文末 Z.13 记录本次适配与排错顺序');

console.log(`移动端适配回归：${ok.length} 通过，${bad.length} 失败`);
for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
if (bad.length) process.exit(1);
