/**
 * 「按后缀暂停后一定无法点击提交注册」· 专项回归
 *
 * 真因（用户追加要求后复查发现）：
 *   legacy 的 setApplyPaused 只写了 btn.disabled=true，但 React 的
 *   SliderCaptcha 回调 onCapPass 会 `btn.disabled = false`（弹窗模式
 *   「按钮不再被票据锁死」），把暂停锁直接冲掉。于是用户仍能点提交、
 *   过滑块、发请求，只是最后收到后端 403 —— 不是「无法点击」。
 *   另外 doSubmit() 没有任何暂停检查，弹窗已打开时管理员中途暂停
 *   验证通过照样提交。
 *
 * 修法（四层）：
 *   1. src/app/lib/applyPause.ts 是前端判定与按钮锁的唯一来源
 *   2. 任何解锁都必须 unlockApplyButton(el, allowed)，allowed=false 绝不解锁
 *   3. onclick / doSubmit / loadPending / captcha 回调全部再核一次当前后缀
 *   4. CSS pointer-events:none 兜底（旧缓存 JS 没写 disabled 也点不动）
 *   5. 后端注册接口仍 403（最后一道）
 *
 * 运行：npx tsx scripts/apply-pause-lock-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  configureApplyPause, isApplyPausedFor, applyPausedMessageFor,
  applyPauseLock, normalizeRoot, lockApplyButton, unlockApplyButton,
  DEFAULT_MESSAGE,
} from '../src/app/lib/applyPause.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────────── A. 判定纯函数真跑 ───────────── */
{
  check(normalizeRoot(' MEOY.TOP. ') === 'meoy.top', '后缀归一化：大小写 / 尾点 / 空白');
  configureApplyPause({
    applyPaused: false,
    applyPausedMessage: '',
    pausedRoots: ['meoy.top', 'v-1.top'],
  });
  check(isApplyPausedFor('MEOY.TOP.') && isApplyPausedFor('v-1.top')
    && !isApplyPausedFor('noxc.uk') && !isApplyPausedFor(''),
    '只拦名单内后缀，其它后缀与空值照常开放');
  check(applyPausedMessageFor('meoy.top').includes('meoy.top')
    && applyPausedMessageFor('meoy.top', 'en').startsWith('Applications for .meoy.top'),
    '按后缀提示语带后缀名，中英文都有');
  check(applyPauseLock('noxc.uk').paused === false
    && applyPauseLock('meoy.top').paused === true,
    'applyPauseLock 返回当前后缀是否可提交');

  configureApplyPause({ applyPaused: true, pausedRoots: [] });
  check(isApplyPausedFor('noxc.uk') && isApplyPausedFor(''),
    '站点级全局暂停时任何后缀都不可提交');

  configureApplyPause({ applyPaused: false, applyPausedMessage: '维护中，稍后再试', pausedRoots: ['meoy.top'] });
  check(applyPausedMessageFor('meoy.top') === '维护中，稍后再试',
    '管理员自定义提示语优先');
  check(applyPausedMessageFor('noxc.uk') === '', '开放后缀无提示语');

  configureApplyPause({ applyPaused: false, applyPausedMessage: DEFAULT_MESSAGE, pausedRoots: ['meoy.top'] });
  check(applyPausedMessageFor('meoy.top').includes('meoy.top'),
    '全局默认文案不会被误当成自定义');
}

/* ───────────── B. 按钮锁真跑（fake DOM） ───────────── */
function fakeBtn() {
  const attrs: Record<string, string> = {};
  const classes = new Set<string>();
  return {
    disabled: false, textContent: '提交注册', attrs, classes,
    setAttribute(k: string, v: string) { attrs[k] = v; },
    removeAttribute(k: string) { delete attrs[k]; },
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
  };
}
{
  const b = fakeBtn();
  lockApplyButton(b);
  check(b.disabled === true && b.attrs['aria-disabled'] === 'true'
    && b.attrs['data-apply-paused'] === '1' && b.classes.has('is-apply-paused'),
    'lockApplyButton 写四重标记（disabled / aria / data / class）');

  /* React onCapPass 在暂停态调用解锁：allowed=false 绝不解锁 */
  unlockApplyButton(b, false);
  check(b.disabled === true && b.attrs['data-apply-paused'] === '1',
    '暂停态下滑块验证回调不能把按钮重新启用（核心漏洞）');

  /* 切回开放后缀才允许解锁 */
  unlockApplyButton(b, true);
  check(b.disabled === false && !b.attrs['data-apply-paused']
    && !b.classes.has('is-apply-paused') && b.textContent === '提交注册',
    '开放后缀可正常解锁并恢复按钮文案');

  /* 反向对照：旧的 btn.disabled=false 会把锁冲掉 */
  const c = fakeBtn();
  lockApplyButton(c);
  (c as any).disabled = false;   // 旧 Register.tsx onCapPass 的写法
  check(c.disabled === false && c.attrs['data-apply-paused'] === '1',
    '反向对照：旧的无条件 disabled=false 确实冲掉锁（新写法必须拦住）');
}

/* ───────────── C. CSS 兜底（选择器必须与锁函数写的标记一致） ───────────── */
const cssText = read('src/app/styles/design-system.css');
const cssRule = (() => {
  const i = cssText.indexOf('.btn.is-apply-paused');
  return i < 0 ? '' : cssText.slice(i, cssText.indexOf('}', i) + 1);
})();
check(/\.is-apply-paused/.test(cssRule) && /\[data-apply-paused="1"\]/.test(cssRule)
  && /pointer-events: none !important/.test(cssRule),
  'CSS 兜底规则同时覆盖 lockApplyButton 写的 class 与 data 标记');
const libText = read('src/app/lib/applyPause.ts');
check(/classList\?\.add\?\.\('is-apply-paused'\)/.test(libText)
  && /setAttribute\?\.\('data-apply-paused', '1'\)/.test(libText),
  '锁函数写的标记与 CSS 选择器一一对应，旧缓存 JS 也点不动');

/* ───────────── D. 源码防回流 ───────────── */
const pauseLib = read('src/app/lib/applyPause.ts');
const reg = read('src/app/legacy/register.ts');
const rpage = read('src/app/pages/Register.tsx');
const css = read('src/app/styles/design-system.css');
const whois = read('src/app/legacy/whois.ts');
const sub = read('src/routes/subdomains.ts');
const idx = read('src/index.ts');
const docsZh = read('docs-src/settings.md');
const docsEn = read('docs-src/en/settings.md');
const readme = read('README.md');
const ci = read('.github/workflows/deploy.yml');
const health = read('scripts/health-check.ts');
const dict = read('src/app/lib/dict.en.ts');

check(/export function unlockApplyButton\(el: any, allowed: boolean\)/.test(pauseLib)
  && /if \(!el \|\| !allowed\) return/.test(pauseLib),
  '按钮解锁唯一入口：allowed=false 绝不解锁');
check(/lockApplyButton\(btn\)/.test(reg) && /unlockApplyButton\(/.test(reg),
  'legacy 用统一锁函数，不再手写 btn.disabled = true/false');
check(!/btn\.disabled = false/.test(reg),
  'legacy 里已无任何「重新启用按钮」的散装代码（上锁仍可，但解锁必须走统一入口）');
check(!/btn\.disabled = false/.test(rpage) && /unlockApplyButton\(btn, !locked\)/.test(rpage),
  'React onCapPass 不再无条件启用按钮，走统一入口');
check(/__TD_APPLY_LOCKED__/.test(reg) && /__TD_APPLY_LOCKED__/.test(rpage),
  'legacy 与 React 共用同一份暂停判定');
check(/__TD_CAPTCHA_CLOSE__/.test(reg) && /__TD_CAPTCHA_CLOSE__/.test(rpage),
  '切到暂停后缀 / 中途暂停会关掉已打开的验证弹窗');

/* 四处拦截：onclick / doSubmit / loadPending / captcha open */
const onclickSeg = reg.slice(reg.indexOf("getElementById('btnApply').onclick"));
const doSubmitSeg = reg.slice(reg.indexOf('async function doSubmit()'), reg.indexOf('async function doSubmit()') + 400);
check(/applyLockNow\(\)/.test(onclickSeg) && /lk\.paused/.test(onclickSeg),
  '「提交注册」点击第一道：连验证弹窗都不打开');
check(/applyLockNow\(\)/.test(doSubmitSeg) && /lk\.paused/.test(doSubmitSeg),
  'doSubmit 再拦一次（弹窗已开时中途暂停也发不出请求）');
check(/if \(applyLockNow\(\)\.paused\)/.test(reg),
  'loadPending 异步回来也不会把暂停态按钮重新启用');
check(/__TD_CAPTCHA_OPEN__/.test(rpage) && /if \(lk\?\.paused\)/.test(rpage),
  '验证弹窗入口也检查暂停');
check(!/if \(IS_ADMIN\) return;\s*\/\/ 管理员是「开通」，不锁/.test(reg),
  '前端不再给管理员留可点的提交入口（后端自建仍豁免）');
check(/pointer-events: none !important/.test(css) && /is-apply-paused/.test(css),
  'CSS 兜底存在，旧缓存 JS 也点不动');

check(/isApplyPausedFor/.test(whois) && /该后缀已暂停新申请/.test(whois),
  'WHOIS 结果对暂停后缀不再给「申请这个域名」入口');
check(/isRootApplyPaused\(gate, reqRoot\)/.test(sub)
  && /u\.role !== 'admin'/.test(sub),
  '后端注册接口仍是最后一道 403（管理员自建豁免）');
check(/pausedRoots/.test(idx), '/api/config 下发名单，前后端同口径');
check(/无法点击|提交注册/.test(docsZh) && /cannot be clicked|disabled/i.test(docsEn)
  && /无法点击提交注册/.test(readme),
  '中英文档与 README 写明「暂停后无法点击提交注册」');
check(/申请已暂停/.test(dict) && /该后缀已暂停新申请/.test(dict),
  '按钮锁定文案与 WHOIS 提示有英文词条');
check(/提交注册硬锁回归/.test(ci) && /apply-pause-lock-regression\.ts/.test(ci),
  '专项回归进 CI');
check(/unlockApplyButton/.test(health), '健康巡检有防回流断言');

/* ───────────── E. 反向对照 ───────────── */
const brokenReact = rpage.replace(/unlockApplyButton\(btn, !locked\)/,
  'if (btn) btn.disabled = false;');
check(brokenReact !== rpage && /btn\.disabled = false/.test(brokenReact),
  '反向对照：退回旧 onCapPass 会让「React 不再无条件启用」断言失败');
const brokenSubmit = doSubmitSeg.replace(/var lk = applyLockNow\(\);[\s\S]*?if \(lk\.paused\) \{ toast\(lk\.message, 'err'\); return; \}/, '');
check(brokenSubmit !== doSubmitSeg && !/applyLockNow/.test(brokenSubmit),
  '反向对照：拿掉 doSubmit 拦截后弹窗回调能发请求，断言会失败');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`提交注册硬锁回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
