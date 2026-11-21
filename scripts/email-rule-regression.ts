/**
 * 注册邮箱规则纯函数回归（CI 用 tsx 跑，不需要数据库）。
 * 固化两件事：
 *   1) edu 漏洞已修 —— 本地部分含 edu 不算教育网凭证；
 *   2) @oauth.local 已解封 —— 但其它保留 TLD / 真临时邮箱仍封。
 */
import {
  blockedEmailDomain, isEduMail, emailAllowed, isOauthInternalEmail,
  DEFAULT_ALLOWED_DOMAINS, BLOCKED_EMAIL_DOMAINS,
} from '../src/lib/emailRule.ts';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: boolean, msg: string) => (cond ? ok.push(msg) : bad.push(msg));

/* 解封：oauth.local 及其子域都不再命中封禁 */
for (const mail of [
  'x@oauth.local',
  'nl.0123456789abcdef0123@oauth.local',
  'a@sub.oauth.local',
]) {
  check(blockedEmailDomain(mail) === null, `${mail} 已解封`);
}
check(!BLOCKED_EMAIL_DOMAINS.includes('oauth.local'), '封禁名单里不再有 oauth.local');

/* 其余保留 TLD / 一次性邮箱仍封 */
for (const [mail, want] of [
  ['x@foo.test', 'test'],
  ['x@other.local', 'local'],
  ['x@bar.invalid', 'invalid'],
  ['x@mailinator.com', 'mailinator.com'],
  ['x@guerrillamail.net', 'guerrillamail.net'],
] as [string, string][]) {
  check(blockedEmailDomain(mail) === want, `${mail} 仍被封（${want}）`);
}
check(blockedEmailDomain('x@gmail.com') === null, '正常邮箱不受影响');

/* 漏洞根因：edu 只看域名标签，本地部分含 edu 一律不算 */
check(isEduMail('student@school.edu.cn'), 'school.edu.cn 算教育网');
check(isEduMail('me@harvard.edu'), 'harvard.edu 算教育网');
check(!isEduMail('edu@gmail.com'), '本地部分含 edu 不算（旧漏洞入口）');
check(!isEduMail('me@myedu.org'), 'myedu.org 不算');
check(!isEduMail('x@oauth.local'), 'oauth.local 不算教育网');
check(
  emailAllowed('xxxxxx@oauth.local', 'whitelist_edu', DEFAULT_ALLOWED_DOMAINS) === false,
  '即使解封，白名单模式下 oauth.local 也不能靠 edu 漏洞绕过'
);

/* NodeLoc 内部占位邮箱识别仍可用（密码登录提示走 OAuth，不是封禁） */
check(isOauthInternalEmail('nl.0123456789abcdef0123@oauth.local'), '识别 NodeLoc 内部占位邮箱');
check(!isOauthInternalEmail('x@oauth.local'), '普通 oauth.local 不算内部占位');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`邮箱规则回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
