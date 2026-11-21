/**
 * Noxc · 注册邮箱规则
 *
 * 站长可在「站点设置 → 注册邮箱规则」切换四种模式：
 *   whitelist_edu (默认) | whitelist (旧行为) | edu_only (严格) | any (全放开)
 * 优先级：settings.email_rule > 环境变量 EMAIL_RULE > 默认。
 *
 * 另有一条「精确邮箱白名单」通道：命中 email_allowlist 表（或
 * ALLOWED_EMAILS 环境变量）的具体地址，四种规则下都无条件放行。
 * 第三方邮箱可在注册页提交申请，管理员通过后自动写入该表。
 *
 * ── 2026-11-21 安全修订 ──────────────────────────────────────
 * 旧实现的 hasEdu = m.includes('edu') 把「邮箱任意位置出现 edu 三个字」
 * 当成教育网凭证，于是 xxxxxx@oauth.local、abc@myedu.org 之类一次性邮箱
 * 都能绕过白名单建号。现在：
 *   1) 硬性封禁域名优先于一切规则与精确白名单（封了就是封了）；
 *   2) edu 只在「域名」里按标签判定，本地部分含 edu 一律不算。
 * ────────────────────────────────────────────────────────────
 */

export type EmailRule = 'whitelist_edu' | 'whitelist' | 'edu_only' | 'any';

export const EMAIL_RULES: EmailRule[] = ['whitelist_edu', 'whitelist', 'edu_only', 'any'];
export const DEFAULT_EMAIL_RULE: EmailRule = 'whitelist_edu';
export const DEFAULT_ALLOWED_DOMAINS = ['gmail.com', 'googlemail.com', 'qq.com', 'foxmail.com'];

/**
 * 硬性封禁的邮箱域名。oauth.local 是本次漏洞利用的来源；其余为常见
 * 一次性 / 临时邮箱服务。命中后四种模式、精确白名单全部拒绝，并且
 * 已有账号在登录时会被就地封禁（见 routes/auth.ts）。
 * 用「域名等于或以 .域名 结尾」匹配，子域一并覆盖。
 */
export const BLOCKED_EMAIL_DOMAINS = [
  'oauth.local',
  'mailinator.com',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.biz', 'guerrillamail.de',
  '10minutemail.com', '10minutemail.net', '10minutemail.co.uk',
  'temp-mail.org', 'temp-mail.ru', 'tempmail.net', 'tempmailer.com',
  'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'trashmail.com', 'trashmail.net', 'trashmail.de',
  'disposableemail.com', 'dispostable.com', 'fakeinbox.com',
  'mailnesia.com', 'mintemail.com', 'sharklasers.com',
  'getnada.com', 'getairmail.com', 'emailondeck.com',
  'spamgourmet.com', 'maildrop.cc', 'throwawaymail.com',
];

/** 非公开 / 保留 TLD：不可能收到真实验证码，一律不接受注册 */
export const BLOCKED_EMAIL_TLDS = new Set([
  'local', 'localhost', 'internal', 'test', 'example', 'invalid', 'onion',
]);

/** 固定句式，便于服务端 i18n 精确翻译成英文 */
export const BLOCKED_EMAIL_MESSAGE =
  '该邮箱域名已被封禁（一次性邮箱 / 非公开域名），不可用于注册或登录';

/** 返回被封的域名（含子域命中），未命中返回 null */
export function blockedEmailDomain(mail: string): string | null {
  const m = String(mail || '').trim().toLowerCase();
  const domain = m.includes('@') ? m.slice(m.lastIndexOf('@') + 1) : '';
  if (!domain) return null;
  const labels = domain.split('.');
  const tld = labels[labels.length - 1] || '';
  if (BLOCKED_EMAIL_TLDS.has(tld)) return tld;
  for (const b of BLOCKED_EMAIL_DOMAINS) {
    if (domain === b || domain.endsWith('.' + b)) return b;
  }
  return null;
}

/**
 * 教育网邮箱：只看「域名」。
 *   student@school.edu.cn / me@harvard.edu / a@edu.example → true
 *   edu@gmail.com / me@myedu.org / someone@oauth.local    → false
 * 注意：本地部分含 edu 不再算凭证 —— 这正是旧漏洞的入口。
 */
export function isEduMail(mail: string): boolean {
  const m = String(mail || '').trim().toLowerCase();
  const domain = m.includes('@') ? m.slice(m.lastIndexOf('@') + 1) : '';
  if (!domain) return false;
  const labels = domain.split('.');
  // 标签精确等于 edu（school.edu.cn / harvard.edu / edu.example）
  if (labels.includes('edu')) return true;
  // 以 .edu 结尾，或 .edu.xx 形式
  return /(^|\.)edu(\.[a-z]{2,})?$/i.test(domain);
}

export function normalizeEmailRule(v: unknown): EmailRule {
  const s = String(v ?? '').trim().toLowerCase();
  return (EMAIL_RULES as string[]).includes(s) ? (s as EmailRule) : DEFAULT_EMAIL_RULE;
}

/** 白名单域名（可用 ALLOWED_EMAIL_DOMAINS 覆盖或扩展） */
export function allowedDomains(env: any): string[] {
  return String(env?.ALLOWED_EMAIL_DOMAINS || DEFAULT_ALLOWED_DOMAINS.join(','))
    .split(',')
    .map((d) => String(d).trim().toLowerCase().replace(/^\.+/, ''))
    .filter(Boolean);
}

/** 读取当前生效规则；settings 查询失败（表尚未建）时安全回落 */
export async function emailRuleOf(env: any): Promise<EmailRule> {
  try {
    const row: any = await env?.DB?.prepare(
      "SELECT value FROM settings WHERE key = 'email_rule'"
    ).first();
    const v = String(row?.value ?? '').trim();
    if (v) return normalizeEmailRule(v);
  } catch { /* 设置表不存在 / D1 暂不可用：用环境变量或默认值 */ }
  return normalizeEmailRule(env?.EMAIL_RULE || DEFAULT_EMAIL_RULE);
}

/** 纯函数判定，便于单测。封禁名单优先于规则与白名单。 */
export function emailAllowed(mail: string, rule: EmailRule, allow: string[]): boolean {
  const m = String(mail || '').trim().toLowerCase();
  if (!m || m.indexOf('@') < 0) return false;
  if (blockedEmailDomain(m)) return false;
  const domain = m.split('@')[1] || '';
  const whitelisted = allow.includes(domain);
  const edu = isEduMail(m);
  switch (rule) {
    case 'whitelist': return whitelisted;
    case 'edu_only': return edu;
    case 'any': return true;
    case 'whitelist_edu':
    default: return whitelisted || edu;
  }
}

/**
 * 预置白名单：仅作为 email_allowlist 表尚未建立时的兜底，让首批获准的
 * 第三方邮箱在 D1 迁移跑完之前也能注册。表一旦存在，就完全以表为准
 * （管理员删掉某个地址后不会又被常量「复活」）。
 */
export const SEED_ALLOWED_EMAILS = ['me@stanimir.cn'];

const normalizeMail = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** 环境变量里的精确邮箱（逗号分隔），优先级高于所有规则模式 */
export function allowedEmails(env: any): string[] {
  return String(env?.ALLOWED_EMAILS || '')
    .split(',')
    .map(normalizeMail)
    .filter((m) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m));
}

/** 该邮箱是否在精确白名单里（内置种子 / 环境变量 / D1 表） */
export async function explicitlyAllowed(env: any, mail: string): Promise<boolean> {
  const m = normalizeMail(mail);
  if (!m) return false;
  if (allowedEmails(env).includes(m)) return true;
  const fallback = SEED_ALLOWED_EMAILS.includes(m);
  let row: any;
  try {
    const db = env?.DB;
    if (!db) return fallback;
    row = await db.prepare('SELECT 1 AS ok FROM email_allowlist WHERE email = ?').bind(m).first();
  } catch {
    // 表还没建 / D1 暂不可用：只放行预置白名单，不让整站注册挂掉
    return fallback;
  }
  return !!row?.ok;
}

/** 注册邮箱是否放行（注册与发验证码共用，避免两处口径漂移） */
export async function signupEmailOk(
  env: any,
  mail: string
): Promise<{ ok: boolean; rule: EmailRule; viaAllowlist: boolean; blocked?: string | null }> {
  const rule = await emailRuleOf(env);
  const blocked = blockedEmailDomain(mail);
  if (blocked) return { ok: false, rule, viaAllowlist: false, blocked };
  if (await explicitlyAllowed(env, mail)) return { ok: true, rule, viaAllowlist: true, blocked: null };
  return { ok: emailAllowed(mail, rule, allowedDomains(env)), rule, viaAllowlist: false, blocked: null };
}

/** 规则说明（登录页 /api/rules 下发，固定句式便于中英精确翻译） */
export const EMAIL_RULE_HINTS: Record<EmailRule, string> = {
  whitelist_edu: '支持白名单邮箱，以及教育网邮箱（域名含 edu）注册',
  whitelist: '仅支持白名单邮箱注册',
  edu_only: '仅支持教育网邮箱（域名含 edu）注册',
  any: '支持任意有效邮箱注册',
};

/** 拒绝时的固定提示（fail() 的消息，固定句式便于本地化） */
export const EMAIL_RULE_REJECTS: Record<EmailRule, string> = {
  whitelist_edu: '该邮箱不符合注册规则：仅支持白名单邮箱或教育网邮箱（域名含 edu）',
  whitelist: '该邮箱不符合注册规则：仅支持白名单邮箱',
  edu_only: '该邮箱不符合注册规则：仅支持教育网邮箱（域名含 edu）',
  any: '该邮箱不符合注册规则',
};

export function emailRuleHint(rule: EmailRule): string {
  return EMAIL_RULE_HINTS[rule] || EMAIL_RULE_HINTS[DEFAULT_EMAIL_RULE];
}

export function emailRuleReject(rule: EmailRule): string {
  return EMAIL_RULE_REJECTS[rule] || EMAIL_RULE_REJECTS[DEFAULT_EMAIL_RULE];
}
