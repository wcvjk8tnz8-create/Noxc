/**
 * 被暂停根域名：不可见 / 不可点 / 自动切主推 · 专项回归
 *
 * 用户反馈：
 *   「切换到被暂停的根域名就不能再切换回去」—— 因为旧版 setApplyPaused
 *   连后缀选择器 rootPickerBtn 一起 disabled，切进去就被锁死。
 *   要求改为：
 *     1. 被暂停的根域名**自动切换到主推域名**（不再让用户停在它上面）
 *     2. 被暂停的根域名**不能被点击**
 *     3. **首页不显示**该根域名
 *
 * 修法：src/app/lib/applyPause.ts 新增 availableRoots / preferredRoot /
 *   sortPreferred：从源头把暂停后缀剔出所有可选列表，并把主推域名排第一。
 *   注册页 / 首页 / WHOIS / 两个线上根域名模板 / 三份静态落地页共用同一口径；
 *   注册页另加 URL ?root= 自动改主推、syncApplyPause 中途自动切主推、
 *   selectRoot 防御（旧缓存点到暂停项也跳主推）、选择器永不 disabled。
 *
 * 运行：npx tsx scripts/paused-root-visibility-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  configureApplyPause, isApplyPausedFor, availableRoots,
  preferredRoot, sortPreferred, PRIMARY_ROOT, normalizeRoot,
} from '../src/app/lib/applyPause.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');
const ROOTS = ['meoy.top', 'noxc.uk', 'v-1.top'];

/* ───────────── A. 纯函数真跑 ───────────── */
{
  check(PRIMARY_ROOT === 'noxc.uk' && normalizeRoot(' NOXC.UK. ') === 'noxc.uk',
    '主推后缀是 noxc.uk，归一化处理大小写 / 尾点 / 空白');

  const open = availableRoots(ROOTS, ['meoy.top']);
  check(JSON.stringify(open) === JSON.stringify(['noxc.uk', 'v-1.top'])
    && !open.includes('meoy.top'),
    'availableRoots 从列表里整个剔除被暂停后缀');
  check(JSON.stringify(sortPreferred(ROOTS, ['meoy.top'])) === JSON.stringify(['noxc.uk', 'v-1.top']),
    'sortPreferred 剔除暂停项并把主推排第一');
  check(preferredRoot(ROOTS, ['meoy.top']) === 'noxc.uk',
    'preferredRoot 返回主推域名');

  check(JSON.stringify(availableRoots(ROOTS, ['MEOY.TOP.', 'meoy.top', '']))
    === JSON.stringify(['noxc.uk', 'v-1.top']),
    '暂停名单大小写 / 尾点 / 重复 / 空项都不影响过滤');
  check(JSON.stringify(availableRoots(['A.top', 'a.top', '', 'b.top'], []))
    === JSON.stringify(['a.top', 'b.top']),
    '可选后缀本身归一化 + 去重');

  check(preferredRoot(ROOTS, ['noxc.uk']) === 'meoy.top',
    '主推域名自己被暂停时，自动落到下一个开放后缀');
  check(preferredRoot(ROOTS, ['meoy.top', 'noxc.uk']) === 'v-1.top',
    '主推与次选都暂停时落到最后一个开放后缀');
  check(preferredRoot(ROOTS, ROOTS) === '' && availableRoots(ROOTS, ROOTS).length === 0,
    '全部后缀都暂停 → 无可切目标（此时保持硬锁，不假装切成功）');

  /* 与 configureApplyPause 的全局状态同源 */
  configureApplyPause({ applyPaused: false, pausedRoots: ['meoy.top'], applyPausedMessage: '' });
  check(JSON.stringify(availableRoots(ROOTS)) === JSON.stringify(['noxc.uk', 'v-1.top'])
    && isApplyPausedFor('meoy.top') && !isApplyPausedFor('noxc.uk'),
    '不传名单时用 /api/config 配置的同一份状态（前后端同口径）');
  configureApplyPause({ applyPaused: true, pausedRoots: [] });
  check(isApplyPausedFor('noxc.uk'),
    '站点级全局暂停时按钮仍硬锁；后缀卡片沿用既有行为，不在本需求范围内');
  configureApplyPause({ applyPaused: false, pausedRoots: [] });
}

/* ───────────── B. 源码防回流 ───────────── */
const lib = read('src/app/lib/applyPause.ts');
const reg = read('src/app/legacy/register.ts');
const home = read('src/app/legacy/home.ts');
const whois = read('src/app/legacy/whois.ts');
const tpl1 = read('src/html/root-meoy.ts');
const tpl2 = read('src/html/root-v1.ts');
const htmls = [
  read('../root-pages/meoy.top.html'),
  read('../root-pages/noxc.uk.html'),
  read('../root-pages/v-1.top.html'),
];
const css = read('src/app/styles/design-system.css');
const idx = read('src/index.ts');
const sub = read('src/routes/subdomains.ts');
const pauseLock = read('scripts/apply-pause-lock-regression.ts');
const docsZh = read('docs-src/settings.md');
const docsEn = read('docs-src/en/settings.md');
const readme = read('README.md');
const ci = read('.github/workflows/deploy.yml');
const health = read('scripts/health-check.ts');

check(/export function availableRoots/.test(lib) && /export function preferredRoot/.test(lib)
  && /export function sortPreferred/.test(lib) && /PRIMARY_ROOT = 'noxc.uk'/.test(lib),
  '可用后缀 / 主推判定收敛在唯一共享模块');
check(/paused\.has\(d\)/.test(lib), '过滤发生在列表构造阶段，不是渲染时再隐藏');

/* 注册页：过滤、自动切换、选择器永不锁死 */
check(/list = sortPreferred\(list\)/.test(reg) && /ROOTS = list/.test(reg),
  '注册页后缀菜单只渲染开放后缀，主推排第一');
check(/function autoSwitchToPrimary/.test(reg) && /syncUrlRoot\(p\)/.test(reg)
  && /selectRoot\(p\)/.test(reg),
  'URL 带暂停后缀 / 后台中途改设置都会自动切到主推域名');
check(/history\.replaceState/.test(reg) && /u\.searchParams\.set\('root', d\)/.test(reg),
  '自动切换同时改 URL，刷新不会又跳回暂停后缀');
check(/if \(cur && isApplyPausedFor\(cur\) && autoSwitchToPrimary\(\)\) return/.test(reg),
  'syncApplyPause 在暂停态先自动切主推，而不是直接锁死');
check(/if \(isApplyPausedFor\(d\)\)/.test(reg) && /d = p;/.test(reg),
  'selectRoot 防御：旧缓存点到暂停项也只会跳主推');
const setPauseSeg = reg.slice(reg.indexOf('function setApplyPaused'), reg.indexOf('function clearApplyPaused'));
check(!/rootPickerBtn/.test(setPauseSeg)
  && /\['label','note','agreeUse'\]/.test(setPauseSeg),
  '暂停时不再禁用后缀选择器（不会再「切过去就切不回来」）');
check(/data-paused/.test(reg) && /data-paused="1"/.test(css),
  '菜单项与 CSS 双保险：暂停后缀即使被旧缓存渲染也点不动');
check(/else if \(first\) syncUrlRoot\(first\)/.test(reg),
  '/register?root=暂停后缀 自动改为主推域名');
check(/__TD_APPLY_LOCKED__/.test(reg) && /lockApplyButton\(btn\)/.test(reg),
  '上一轮「提交注册硬锁」没有被回退');

/* 首页：不显示 */
check(/const preferNoxc = \(list\) => sortPreferred\(list\)/.test(home),
  '首页后缀卡片用同一份过滤 + 主推排序');
check(/\.filter\(\(r\) => !isApplyPausedFor\(r\.domain\)\)/.test(home),
  '统计展开明细也不列暂停后缀');
check(/if \(isApplyPausedFor\(HOTTEST\)\) HOTTEST = ''/.test(home),
  '最热后缀若被暂停，首页 HOT 标记与提示一起隐藏');
check(/history\.replaceState/.test(home) && /u\.searchParams\.set\('root', ROOTS\[0\]\)/.test(home),
  '首页查询下拉带暂停后缀时自动落主推并改 URL');
check(/当前没有可申请的后缀/.test(home), '全部暂停时首页不给空查询入口');
check(/PAUSED_ROOTS/.test(home) && /nk-badge-paused/.test(home),
  '旧版暂停徽标代码保留为防御，实际列表已过滤（兼容既有断言）');

/* WHOIS 与落地页 */
check(/sortPreferred\(/.test(whois) && /if \(w && list\.indexOf\(w\) >= 0\)/.test(whois),
  'WHOIS 下拉同样过滤并回落主推');
for (const t of [tpl1, tpl2]) {
  check(/__NOXC_PAUSED_ROOTS__/.test(t) && /paused\.indexOf\(d\) < 0/.test(t),
    '线上根域名模板下拉剔除暂停后缀');
  check(/__NOXC_PRIMARY_ROOT__/.test(t) && /out\.indexOf\("noxc.uk"\) >= 0/.test(t),
    '模板计算主推域名，本页后缀暂停时自动改带主推');
  check(/root = alt;/.test(t), '模板查询跳转使用主推域名而不是被暂停后缀');
}
for (const h of htmls) {
  check(/__NOXC_PRIMARY_ROOT__/.test(h) && /openRoots\.indexOf\('noxc.uk'\)/.test(h),
    '静态落地页计算主推域名');
  check(/domain=alt;/.test(h), '静态落地页暂停时跳注册带主推域名');
}
check(/\.root-opt\[data-paused="1"\]/.test(css) && /pointer-events: none !important/.test(css),
  'CSS 点击兜底存在');

/* 后端与文档 */
check(/pausedRoots/.test(idx) && /isRootApplyPaused\(gate, reqRoot\)/.test(sub),
  '/api/config 下发名单 + 后端 403 最后一道仍在');
check(/apply-pause-lock-regression\.ts/.test(pauseLock) || fs.existsSync(path.resolve('scripts/apply-pause-lock-regression.ts')),
  '上一轮硬锁回归仍在');
check(/自动切换|主推域名/.test(docsZh) && /automatically|primary suffix/i.test(docsEn)
  && /主推域名/.test(readme), '中英文档与 README 写明自动切换口径');
check(/暂停后缀可见性回归/.test(ci) && /paused-root-visibility-regression\.ts/.test(ci),
  '专项回归进 CI');
check(/sortPreferred/.test(health), '健康巡检有防回流断言');

/* ───────────── C. 反向对照 ───────────── */
const noFilter = lib.replace(/if \(!d \|\| seen\.has\(d\) \|\| paused\.has\(d\)\) continue;/,
  'if (!d || seen.has(d)) continue;');
check(noFilter !== lib && !/paused\.has\(d\)/.test(noFilter),
  '反向对照：拿掉过滤后暂停后缀会重新出现在列表，相关断言必须失败');
const noAuto = reg.replace(/if \(cur && isApplyPausedFor\(cur\) && autoSwitchToPrimary\(\)\) return;/, '');
check(noAuto !== reg && !/autoSwitchToPrimary\(\)\) return/.test(noAuto),
  '反向对照：拿掉自动切换后又会锁死在暂停后缀');
const lockedPicker = reg.replace(/\['label','note','agreeUse'\]\.forEach\(function\(id\)\{[\s\S]*?\}\);\n    var btn = document\.getElementById\('btnApply'\);/,
  "['label','note','agreeUse','rootPickerBtn'].forEach(function(id){ });\n    var btn = document.getElementById('btnApply');");
check(lockedPicker !== reg, '反向对照：把 rootPickerBtn 加回禁用列表会被断言拦下');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`暂停后缀可见性回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
