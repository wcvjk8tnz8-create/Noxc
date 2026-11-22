import { Hono } from 'hono';
import { hashPassword, verifyPassword, randomToken } from '../lib/crypto.js';
import { ok, fail, now, audit, clientIp, defaultQuotaOf } from '../lib/util.js';
import { createSession, setSessionCookie, clearSessionCookie, destroySession, UNLIMITED } from '../middleware/auth.js';
import { notifyLoginIp, notify } from '../lib/notify.js';
import { issueCode, checkCode, mailConfig, mailEnabled, PASSWORD_CHANGE_SCENE } from '../lib/mail.js';
import { signupEmailOk, emailRuleReject, blockedEmailDomain, isOauthInternalEmail, BLOCKED_EMAIL_MESSAGE } from '../lib/emailRule.js';

const app = new Hono();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * 账号邮箱能不能真的收到验证码。
 *
 * 这里刻意**不套注册邮箱规则**（白名单 / edu）：那是「谁能新注册」的门槛，
 * 已登录账号不该被它卡住改密。只排除根本无法投递的地址：NodeLoc 自动建号
 * 留下的 nl.<hex>@oauth.local 占位邮箱，以及 .local / .test / .invalid 等保留 TLD。
 * 这类账号请先在「个人资料 → 更换邮箱」换成可收信地址。
 */
function mailCanReceive(mail: string): boolean {
  const m = String(mail || '').trim().toLowerCase();
  if (!m.includes('@') || isOauthInternalEmail(m)) return false;
  const tld = m.slice(m.lastIndexOf('@') + 1).split('.').pop() || '';
  return !['local', 'localhost', 'internal', 'test', 'example', 'invalid', 'onion'].includes(tld);
}

const MAIL_UNDELIVERABLE =
  '当前账号邮箱无法接收邮件，请先在「个人资料 → 更换邮箱」换成可收信地址，再修改密码';

/** 同 IP 允许的账号数 */
async function maxPerIp(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'max_accounts_per_ip'").first();
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
}

function publicUser(u) {
  return { id: u.id, email: u.email, role: u.role, status: u.status, quota: u.quota, created_at: u.created_at };
}

// 注册
app.post('/register', async (c) => {
  const env = c.env;
  if (env.ALLOW_SIGNUP === '0') return fail(c, '当前未开放注册', 403);
  const body0 = await c.req.json().catch(() => ({}));
  const { email, password, agreeTerms } = body0;
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return fail(c, '请填写有效的邮箱地址');
  if (!password || String(password).length < 8) return fail(c, '密码至少 8 位');
  if (String(password).length > 128) return fail(c, '密码过长');

  /* 注册邮箱规则：封禁域名（一次性 / 非公开邮箱）优先于一切，
     再判白名单 ∪ 教育网邮箱（域名含 edu，不再看本地部分）。 */
  const gate = await signupEmailOk(env, mail);
  if (gate.blocked) return fail(c, BLOCKED_EMAIL_MESSAGE, 403);
  if (!gate.ok) return fail(c, emailRuleReject(gate.rule));

  // 必须同意服务条款
  if (!agreeTerms) return fail(c, '请先阅读并同意《服务条款与免责声明》', 400, { needAgree: true });

  const ip = clientIp(c);

  // IP 封禁名单
  if (ip) {
    const banned = await env.DB.prepare('SELECT reason FROM ip_bans WHERE ip = ?').bind(ip).first();
    if (banned) return fail(c, `该网络环境已被封禁：${banned.reason || '违规注册'}`, 403);
  }

  // 同一 IP 注册数量限制
  if (ip) {
    const limit = await maxPerIp(env);
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM registrations WHERE ip = ?').bind(ip).first();
    if ((cnt?.n || 0) >= limit)
      return fail(
        c,
        `同一网络最多注册 ${limit} 个账号，你已注册 ${cnt.n} 个。超出限制的账号一经发现将被全部封禁。`,
        403,
        { limit, current: cnt.n }
      );
  }

  // 验证码（后台开启「注册需要验证码」时必填）
  const cfg = await mailConfig(env);
  if (cfg.verifyRequired) {
    const code = String(body0?.code || '');
    const v = await checkCode(env, mail, 'register', code);
    if (!v.ok) return fail(c, v.reason || '验证码不正确', 400, { needCode: true });
  }

  const exist = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(mail).first();
  if (exist) return fail(c, '该邮箱已注册');

  // 第一位注册者自动成为管理员
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const role = count && count.n === 0 ? 'admin' : 'user';

  const hash = await hashPassword(String(password));
  // 管理员不限量；普通用户用后台「站点设置」里的默认配额（可自定义，默认 5）
  const quota = role === 'admin' ? UNLIMITED : await defaultQuotaOf(env);
  const res = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, role, status, quota, created_at) VALUES (?,?,?,?,?,?)'
  )
    .bind(mail, hash, role, 'active', quota, now())
    .run();

  const userId = res.meta?.last_row_id;
  // 记录注册来源（IP / UA / 条款同意）
  await env.DB.prepare(
    'INSERT INTO registrations (user_id, ip, ua, agreed_terms, created_at) VALUES (?,?,?,?,?)'
  )
    .bind(userId, ip, (c.req.header('user-agent') || '').slice(0, 300), 1, now())
    .run();

  await audit(
    c,
    userId,
    'user.register',
    mail,
    (role === 'admin' ? '首位用户，自动设为管理员（不限配额）' : '') || `ip=${ip || '未知'}`
  );
  const { token, maxAge } = await createSession(c, userId, true);
  setSessionCookie(c, token, maxAge);
  return ok(c, {
    user: { id: userId, email: mail, role, status: 'active', quota, quotaUnlimited: quota < 0 },
    isFirstAdmin: role === 'admin',
  });
});

// 登录
app.post('/login', async (c) => {
  const { email, password, remember } = await c.req.json().catch(() => ({}));
  const mail = String(email || '').trim().toLowerCase();
  if (!mail || !password) return fail(c, '请输入邮箱和密码');

  /* 立即封锁：一次性 / 非公开邮箱域名的违规注册账号。
      oauth.local 已解封（见 emailRule.ts），不再命中这里。
     不依赖 D1 迁移是否跑过 —— 只要有人拿它登录，当场标记为封禁。
     管理员账号不动，避免把站点锁死。
     例外：`nl.<hex>@oauth.local` 是 NodeLoc 自动建号时期的合法第三方账号，
     不是访客违规注册。它们没有可用密码（密码 hash 为 oauth:disabled:），
     只能走 OAuth 登录；在这里改 status 会把本人之后的 NodeLoc 登录一起锁死。
     所以只提示改用 NodeLoc 登录、不动账号状态，等下次 OAuth 登录回填真实邮箱。 */
  if (isOauthInternalEmail(mail)) {
    return fail(c, '此账号由 NodeLoc 登录创建，请使用「使用 NodeLoc 登录」', 403);
  }
  if (blockedEmailDomain(mail)) {
    try {
      await c.env.DB.prepare(
        "UPDATE users SET status = 'banned', ban_reason = ? WHERE email = ? AND role <> 'admin' AND status <> 'banned'"
      ).bind('违规注册：一次性 / 非公开邮箱域名', mail).run();
    } catch { /* 表结构异常时也不放行 */ }
    return fail(c, BLOCKED_EMAIL_MESSAGE, 403);
  }

  const ip = clientIp(c);
  if (ip) {
    const banned = await c.env.DB.prepare('SELECT reason FROM ip_bans WHERE ip = ?').bind(ip).first();
    if (banned) return fail(c, `该网络环境已被封禁：${banned.reason || '违规注册'}`, 403);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(mail).first();
  if (!user) return fail(c, '邮箱或密码错误');
  const pass = await verifyPassword(String(password), user.password_hash);
  if (!pass) return fail(c, '邮箱或密码错误');
  if (user.status === 'banned') return fail(c, `账号已被封禁：${user.ban_reason || '违规使用'}`, 403);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), user.id).run();
  // 老账号补记注册来源，便于同 IP 判定
  if (ip) {
    const reg = await c.env.DB.prepare('SELECT id FROM registrations WHERE user_id = ?').bind(user.id).first();
    if (!reg) {
      await c.env.DB.prepare(
        'INSERT INTO registrations (user_id, ip, ua, agreed_terms, created_at) VALUES (?,?,?,?,?)'
      )
        .bind(user.id, ip, (c.req.header('user-agent') || '').slice(0, 300), 1, now())
        .run();
    }
  }
  const { token, maxAge } = await createSession(c, user.id, remember !== false);
  setSessionCookie(c, token, maxAge);
  await audit(c, user.id, 'user.login', mail, remember === false ? '未记住登录（1 天）' : '记住登录（90 天）');
  // 登录 IP 提醒（同一 IP 不重复发）。用 waitUntil 异步执行，不拖慢登录响应
  if (ip) c.executionCtx?.waitUntil?.(notifyLoginIp(c.env, user.id, mail, ip));
  return ok(c, { user: publicUser(user) });
});

// 登出
app.post('/logout', async (c) => {
  const u = c.get('user');
  if (u) {
    await destroySession(c, u.token);
    await audit(c, u.id, 'user.logout', u.email);
  }
  clearSessionCookie(c);
  return ok(c, {});
});

// 当前登录信息
app.get('/me', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '未登录', 401, { needLogin: true });
  const full = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
  const used = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subdomains WHERE user_id = ? AND status IN ('pending','approved','suspended')"
  )
    .bind(u.id)
    .first();
  return ok(c, { user: publicUser(full), used: used?.n || 0 });
});

/* ───────── 修改密码：邮箱验证码（不再要原密码） ─────────
   收码地址一律取会话里的 u.email，绝不信任前端传来的 email —— 否则攻击者
   可以拿自己邮箱的验证码去改别人的账号。场景 password_change 独立于
   register / reset / email_change，忘记密码的码不能拿来改已登录账号密码。 */

/** POST /api/auth/password/send-code —— 给「当前账号邮箱」发修改密码验证码 */
app.post('/password/send-code', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });

  const cfg = await mailConfig(c.env);
  if (!mailEnabled(cfg)) {
    return fail(
      c,
      '站点未配置邮件服务，无法发送验证码。请联系管理员在「站点设置 → 邮件与验证码」中配置 Resend 或 Brevo。',
      503,
      { mailNotConfigured: true }
    );
  }

  const mail = String(u.email || '').trim().toLowerCase();
  if (!mailCanReceive(mail)) return fail(c, MAIL_UNDELIVERABLE, 400, { needEmailChange: true });

  // 节流：同一邮箱同一场景 60 秒内只发一次
  const recent: any = await c.env.DB.prepare(
    'SELECT created_at FROM email_verifications WHERE email = ? AND scene = ? ORDER BY id DESC LIMIT 1'
  ).bind(mail, PASSWORD_CHANGE_SCENE).first();
  if (recent?.created_at && Date.now() - Number(recent.created_at) < 60_000) {
    return fail(c, '发送过于频繁，请 60 秒后再试');
  }

  const r = await issueCode(c.env, mail, PASSWORD_CHANGE_SCENE, clientIp(c));
  if (!r.sent) return fail(c, r.warning || '验证码发送失败', 502);
  // 只回自己的邮箱，不回验证码；devCode 仅在未配置服务商时出现，上面已拦截
  return ok(c, { sent: true, expiresIn: 600, email: mail });
});

/** POST /api/auth/password —— 校验邮箱验证码并写入新密码 */
app.post('/password', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const body: any = await c.req.json().catch(() => ({}));
  const { code, newPassword } = body;
  if (!newPassword || String(newPassword).length < 8) return fail(c, '新密码至少 8 位');
  if (String(newPassword).length > 128) return fail(c, '密码过长');

  /* 旧版前端（浏览器缓存）还会传原密码。明确提示刷新，而不是含糊报「验证码不正确」 */
  if (!code && (body.oldPassword !== undefined || body.currentPassword !== undefined)) {
    return fail(c, '密码修改已改为邮箱验证码，请刷新页面后重试', 400,
      { needCode: true, needRefresh: true });
  }

  const mail = String(u.email || '').trim().toLowerCase();
  if (!mailCanReceive(mail)) return fail(c, MAIL_UNDELIVERABLE, 400, { needEmailChange: true });

  // checkCode 通过后立即标记 used，天然一次性；错 5 次 / 10 分钟过期同其它场景
  const v = await checkCode(c.env, mail, PASSWORD_CHANGE_SCENE, String(code || '').trim());
  if (!v.ok) return fail(c, v.reason || '验证码不正确', 400, { needCode: true });

  const user: any = await c.env.DB.prepare('SELECT id, status FROM users WHERE id = ?').bind(u.id).first();
  if (!user) return fail(c, '账号不存在', 404);
  if (String(user.status) === 'banned') return fail(c, '账号已被封禁，无法修改密码', 403);

  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(String(newPassword)), u.id)
    .run();
  // 改密后踢掉其它会话，当前会话保留
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?')
    .bind(u.id, u.token).run();
  await audit(c, u.id, 'user.password_code', mail, '通过账号邮箱验证码修改密码');
  await notify(c.env, u.id, 'system', '密码已修改',
    `你的账号密码已通过邮箱验证码修改。操作 IP：${clientIp(c) || '未知'}。若非本人操作请立即联系管理员。`,
    '/profile.html').catch(() => null);
  return ok(c, {});
});

// 刷新令牌（防止忘记 password hash 时手工重置，仅管理员在控制台调用）
app.post('/reset-token', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const token = randomToken(16);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind('reset:' + token, u.id).run();
  return ok(c, { token });
});

export default app;

// ============ 邮箱验证码 ============

/** POST /api/auth/verify/send —— 发送验证码（scene: register / reset）
 *  刻意不开放 password_change / email_change：这两个场景必须走登录态接口，
 *  用会话里的邮箱发码，否则未登录者可以拿任意地址触发邮件、拿来枚举或骚扰。 */
app.post('/verify/send', async (c) => {
  const { email, scene } = await c.req.json().catch(() => ({}));
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return fail(c, '请填写有效的邮箱地址');
  if (!['register', 'reset'].includes(String(scene))) return fail(c, '场景不合法');

  const cfg = await mailConfig(c.env);
  if (!mailEnabled(cfg)) {
    // 未配置邮件服务：明确提示，而不是假装发送成功
    return fail(
      c,
      '站点未配置邮件服务，无法发送验证码。请联系管理员在「站点设置 → 邮件与验证码」中配置 Resend 或 Brevo。',
      503,
      { mailNotConfigured: true }
    );
  }

  // 注册场景：先按同一套规则校验邮箱，别给注定注册不了的邮箱发码；
  // 重置场景不校验 —— 已有账号不该因为规则变更而被挡在门外。
  if (scene === 'register') {
    const gate = await signupEmailOk(c.env, mail);
    if (gate.blocked) return fail(c, BLOCKED_EMAIL_MESSAGE, 403);
    if (!gate.ok) return fail(c, emailRuleReject(gate.rule));
  }

  // 注册场景：邮箱不能已注册；重置场景：邮箱必须已注册
  const exist = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(mail).first();
  if (scene === 'register' && exist) return fail(c, '该邮箱已注册');
  if (scene === 'reset' && !exist) return fail(c, '该邮箱未注册');

  // 简单节流：60 秒内不重复发送
  const recent = await c.env.DB.prepare(
    "SELECT created_at FROM email_verifications WHERE email = ? AND scene = ? ORDER BY id DESC LIMIT 1"
  )
    .bind(mail, scene)
    .first();
  if (recent?.created_at && Date.now() - Number(recent.created_at) < 60_000) {
    return fail(c, '发送过于频繁，请 60 秒后再试');
  }

  const r = await issueCode(c.env, mail, scene, clientIp(c));
  if (!r.sent) return fail(c, r.warning || '验证码发送失败', 502);

  // 返回体不暴露验证码；devCode 仅在未配置服务商时出现（此时上面已 return fail）
  return ok(c, { sent: true, expiresIn: 600 });
});

/** POST /api/auth/verify/check —— 校验并消耗验证码
 *  checkCode 通过后会把码标记 used，所以这里不是「只看看」。
 *  只开放公开场景 register / reset：password_change / email_change 必须走登录态
 *  接口，否则未登录者可以拿任意邮箱连打错码，把别人的改密 / 换绑码消耗掉。 */
app.post('/verify/check', async (c) => {
  const { email, scene, code } = await c.req.json().catch(() => ({}));
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return fail(c, '请填写有效的邮箱地址');
  const sc = String(scene || 'register');
  if (!['register', 'reset'].includes(sc)) return fail(c, '场景不合法');
  const v = await checkCode(c.env, mail, sc, String(code || ''));
  if (!v.ok) return fail(c, v.reason || '验证码不正确');
  return ok(c, {});
});

/** POST /api/auth/reset —— 用验证码重置密码（忘记密码） */
app.post('/reset', async (c) => {
  const { email, code, password } = await c.req.json().catch(() => ({}));
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return fail(c, '请填写有效的邮箱地址');
  if (!password || String(password).length < 8) return fail(c, '新密码至少 8 位');
  if (String(password).length > 128) return fail(c, '密码过长');

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(mail).first();
  if (!user) return fail(c, '该邮箱未注册');
  if (user.status === 'banned') return fail(c, `账号已被封禁：${user.ban_reason || '违规使用'}`, 403);

  const v = await checkCode(c.env, mail, 'reset', String(code || ''));
  if (!v.ok) return fail(c, v.reason || '验证码不正确', 400, { needCode: true });

  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(String(password)), user.id)
    .run();
  // 重置密码后踢掉所有会话（强制重新登录）
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  await audit(c, user.id, 'user.reset_password', mail, '通过邮箱验证码重置');
  await notify(c.env, user.id, 'system', '密码已重置', `你的账号密码已通过邮箱验证码重置。登录 IP：${clientIp(c) || '未知'}。若非本人操作请立即联系管理员。`, '/profile.html');
  return ok(c, {});
});
