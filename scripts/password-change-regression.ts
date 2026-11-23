/**
 * 修改密码（邮箱验证码）专项回归（CI 步骤：修改密码验证码回归）
 *
 * 真跑 Hono /api/auth 路由 + 内存 D1 + mock Resend，覆盖：
 *   · 登录态发码、邮件标题/正文、6 位码、响应体不暴露码、60 秒节流
 *   · 旧前端传 oldPassword 明确提示刷新；缺码 / 错码 / 错 5 次 / 过期 / 重放
 *   · 场景隔离（reset 的码不能改密）、邮箱隔离（服务端只认 u.email）
 *   · 成功后改哈希、踢其它会话保留当前会话、审计与通知
 *   · 占位邮箱 / 保留 TLD 明确拒绝、未配置邮件服务 503、服务商失败 502
 *   · 未登录不能通过 /verify/send 触发 password_change 场景
 *
 * 运行：npx tsx scripts/password-change-regression.ts
 */
import { Hono } from 'hono';
import authRoutes from '../src/routes/auth.js';
import { PASSWORD_CHANGE_SCENE } from '../src/lib/mail.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));

type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  users: Row[]; verifications: Row[]; sessions: Row[];
  notifications: Row[]; audit_log: Row[]; seq: number;
};
let S: Store;
function fresh(): Store {
  return {
    settings: new Map(), users: [], verifications: [], sessions: [],
    notifications: [], audit_log: [], seq: 0,
  };
}

function exec(sql: string, args: any[]) {
  const s = sql.replace(/\s+/g, ' ').trim();
  const rows: Row[] = [];
  let lastRowId = 0, changes = 0;
  /* 统一配置层：SELECT key, value FROM settings（真实 D1 同形） */
  if (/^SELECT key, value FROM settings$/.test(s)) {
    for (const [key, value] of S.settings) rows.push({ key, value: String(value) });
    return { rows, lastRowId, changes };
  }

  const settingBind = s.match(/^SELECT value FROM settings WHERE key = \?/);
  const settingLit = s.match(/^SELECT value FROM settings WHERE key = '([^']+)'/);
  if (settingBind || settingLit) {
    const k = settingBind ? String(args[0]) : (settingLit as RegExpMatchArray)[1];
    const v = S.settings.get(k);
    if (v !== undefined) rows.push({ value: v });
  } else if (/^SELECT created_at FROM email_verifications WHERE email = \? AND scene = \? ORDER BY id DESC LIMIT 1/.test(s)) {
    const hit = S.verifications.filter((x) => x.email === args[0] && x.scene === args[1]).slice(-1)[0];
    if (hit) rows.push({ created_at: hit.created_at });
  } else if (/^SELECT \* FROM email_verifications WHERE email = \? AND scene = \? AND used = 0 ORDER BY id DESC LIMIT 1/.test(s)) {
    const hit = S.verifications.filter((x) => x.email === args[0] && x.scene === args[1] && !x.used).slice(-1)[0];
    if (hit) rows.push({ ...hit });
  } else if (/^UPDATE email_verifications SET used = 1 WHERE email = \? AND scene = \? AND used = 0/.test(s)) {
    for (const v of S.verifications) {
      if (v.email === args[0] && v.scene === args[1] && !v.used) { v.used = 1; changes++; }
    }
  } else if (/^INSERT INTO email_verifications /.test(s)) {
    const id = ++S.seq;
    S.verifications.push({
      id, email: args[0], scene: args[1], code_hash: args[2], ip: args[3],
      expires_at: args[4], used: 0, tries: 0, created_at: args[5],
    });
    lastRowId = id; changes = 1;
  } else if (/^UPDATE email_verifications SET tries = tries \+ 1 WHERE id = \?/.test(s)) {
    const v = S.verifications.find((x) => x.id === Number(args[0]));
    if (v) { v.tries = Number(v.tries || 0) + 1; changes = 1; }
  } else if (/^UPDATE email_verifications SET used = 1 WHERE id = \?/.test(s)) {
    const v = S.verifications.find((x) => x.id === Number(args[0]));
    if (v) { v.used = 1; changes = 1; }
  } else if (/^SELECT id, status FROM users WHERE id = \?/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[0]));
    if (u) rows.push({ id: u.id, status: u.status });
  } else if (/^SELECT \* FROM users WHERE id = \?/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[0]));
    if (u) rows.push({ ...u });
  } else if (/^UPDATE users SET password_hash = \? WHERE id = \?/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[1]));
    if (u) { u.password_hash = args[0]; changes = 1; }
  } else if (/^DELETE FROM sessions WHERE user_id = \? AND token != \?/.test(s)) {
    const before = S.sessions.length;
    S.sessions = S.sessions.filter((x) => !(x.user_id === Number(args[0]) && x.token !== args[1]));
    changes = before - S.sessions.length;
  } else if (/^INSERT INTO audit_log /.test(s)) {
    S.audit_log.push({
      user_id: args[0], action: args[1], target: args[2], detail: args[3], ip: args[4],
    });
    changes = 1;
  } else if (/^INSERT INTO notifications /.test(s)) {
    S.notifications.push({
      user_id: args[0], type: args[1], title: args[2], body: args[3], tag: args[4], link: args[5],
    });
    changes = 1;
  } else if (/^(PRAGMA|CREATE TABLE|ALTER TABLE|INSERT OR IGNORE INTO settings|UPDATE settings)/.test(s)) {
    /* 内存表无 schema，忽略 */
  }
  return { rows, lastRowId, changes };
}

function makeDb() {
  const wrap = (sql: string, args: any[]) => {
    const out = () => exec(sql, args);
    return {
      first: async () => out().rows[0] ?? null,
      all: async () => ({ results: out().rows }),
      run: async () => { const r = out(); return { meta: { last_row_id: r.lastRowId, changes: r.changes } }; },
    };
  };
  return {
    prepare(sql: string) {
      const self = wrap(sql, []);
      return { bind(...args: any[]) { return wrap(sql, args); }, first: self.first, all: self.all, run: self.run };
    },
  };
}

/* ───────── mock 邮件服务商 ───────── */
let sentMails: { to: string; subject: string; text: string }[] = [];
let mailShouldFail = false;
const json = (o: any, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = String(input?.url || input);
  if (url.includes('api.resend.com/emails')) {
    if (mailShouldFail) return json({ message: 'provider down' }, 500);
    const body = JSON.parse(String(init.body || '{}'));
    sentMails.push({ to: body.to?.[0] || '', subject: body.subject || '', text: body.text || '' });
    return json({ id: 'mail-1' });
  }
  return json({});
};
const codeOf = (mail?: string) => {
  const t = sentMails.filter((m) => !mail || m.to === mail).slice(-1)[0]?.text || '';
  const m = t.match(/验证码是\s*(\d{6})/);
  return m ? m[1] : '';
};

/* ───────── 被测应用 ───────── */
let currentUser: any = null;
const app = new Hono();
app.use('*', async (c, next) => { c.set('user', currentUser); await next(); });
app.route('/api/auth', authRoutes);

const MAIL_CFG = {
  mail_provider: 'resend', mail_from: 'verify@noxc.uk',
  mail_api_key: 're_TEST', site_name: 'Noxc',
};
const USER_EMAIL = 'me@example.com';
let env: any;
function reset(opts: { settings?: Record<string, string>; email?: string; status?: string; hash?: string } = {}) {
  S = fresh();
  for (const [k, v] of Object.entries({ ...MAIL_CFG, ...(opts.settings || {}) })) S.settings.set(k, v);
  const email = opts.email || USER_EMAIL;
  S.users.push({
    id: 1, email, password_hash: opts.hash || 'oauth:disabled:x',
    role: 'user', status: opts.status || 'active', quota: 5, created_at: Date.now(),
  });
  S.sessions.push(
    { token: 'T-1', user_id: 1 },
    { token: 'T-2', user_id: 1 },
    { token: 'T-9', user_id: 2 },
  );
  currentUser = { id: 1, email, role: 'user', status: opts.status || 'active', quota: 5, token: 'T-1' };
  env = { DB: makeDb() };
  sentMails = [];
  mailShouldFail = false;
}
const CTX: any = { waitUntil() {}, passThroughOnException() {} };
async function call(path: string, body: any) {
  return app.fetch(
    new Request(`https://nic.test${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-lang': 'zh' },
      body: JSON.stringify(body),
    }), env, CTX);
}
const bodyOf = async (r: Response) => await r.json().catch(() => ({})) as any;
const hashOf = () => String(S.users[0].password_hash);

/* ───────── 用例 ───────── */
check(PASSWORD_CHANGE_SCENE === 'password_change', '改密场景常量独立于 register / reset / email_change');

/* 1. 登录态 */
reset(); currentUser = null;
let r = await call('/api/auth/password/send-code', {});
check(r.status === 401, '未登录不能发码');
r = await call('/api/auth/password', { code: '123456', newPassword: '12345678' });
check(r.status === 401, '未登录不能改密');

/* 2. 邮件服务未配置 */
reset({ settings: { mail_api_key: '' } });
r = await call('/api/auth/password/send-code', {});
check(r.status === 503 && (await bodyOf(r)).mailNotConfigured === true,
  '未配置邮件服务明确 503，不假装发送成功');

/* 3. 收不到信的地址：占位邮箱 / 保留 TLD */
for (const [mail, label] of [
  ['nl.0123456789abcdef0123@oauth.local', 'NodeLoc 占位邮箱'],
  ['me@foo.test', '保留 TLD .test'],
  ['me@box.local', '保留 TLD .local'],
] as [string, string][]) {
  reset({ email: mail });
  r = await call('/api/auth/password/send-code', {});
  const b = await bodyOf(r);
  check(r.status === 400 && b.needEmailChange === true && sentMails.length === 0,
    `${label}明确提示先换邮箱，不发码`);
  r = await call('/api/auth/password', { code: '123456', newPassword: '12345678' });
  check(r.status === 400, `${label}也不能直接改密`);
}

/* 4. 发码成功 */
reset();
r = await call('/api/auth/password/send-code', {});
let b = await bodyOf(r);
check(r.status === 200 && b.sent === true && b.expiresIn === 600 && b.email === USER_EMAIL,
  '发码成功，返回自己的邮箱与 10 分钟有效期');
check(!JSON.stringify(b).includes(codeOf()), '响应体不暴露验证码');
check(sentMails.length === 1 && sentMails[0].to === USER_EMAIL, '验证码只发到当前账号邮箱');
check(sentMails[0].subject.includes('修改密码验证码') && sentMails[0].text.includes('修改账号密码'),
  '邮件标题与正文是「修改密码」，不是「注册」或「重置」');
check(/^\d{6}$/.test(codeOf()) && S.verifications[0].scene === 'password_change',
  '6 位码写入 password_change 场景');

/* 5. 60 秒节流 */
r = await call('/api/auth/password/send-code', {});
check(r.status === 400 && sentMails.length === 1, '60 秒内重复发送被节流');

/* 6. 未登录的 /verify/send 与 /verify/check 都不开放改密场景
      （防邮件骚扰 / 枚举，也防止拿错码消耗掉别人已发的改密码） */
reset(); currentUser = null;
r = await call('/api/auth/verify/send', { email: USER_EMAIL, scene: 'password_change' });
check(r.status === 400 && sentMails.length === 0, '公开发码接口不接受 password_change 场景');
r = await call('/api/auth/verify/check', { email: USER_EMAIL, scene: 'password_change', code: '000000' });
check(r.status === 400, '公开校验接口不接受 password_change 场景');

reset();
await call('/api/auth/password/send-code', {});
const protectedCode = codeOf();
currentUser = null;
for (let i = 0; i < 5; i++) {
  await call('/api/auth/verify/check', { email: USER_EMAIL, scene: 'password_change', code: '000000' });
}
check(S.verifications[S.verifications.length - 1].tries === 0,
  '未登录者无法用公开接口打错码消耗别人的改密验证码');
currentUser = { id: 1, email: USER_EMAIL, role: 'user', status: 'active', quota: 5, token: 'T-1' };
r = await call('/api/auth/password', { code: protectedCode, newPassword: 'newpassword1' });
check(r.status === 200, '被骚扰后原验证码仍可正常改密');

/* 7. 旧版前端（还传原密码）给出明确提示 */
reset();
await call('/api/auth/password/send-code', {});
const good0 = codeOf();
const before0 = hashOf();
r = await call('/api/auth/password', { oldPassword: 'whatever', newPassword: 'newpassword1' });
b = await bodyOf(r);
check(r.status === 400 && b.needRefresh === true && String(b.message).includes('刷新'),
  '旧前端传原密码 → 明确提示刷新页面，不报含糊的验证码错误');
check(hashOf() === before0, '旧前端请求不改密码');

/* 8. 缺码 / 错码 / 错 5 次 */
r = await call('/api/auth/password', { newPassword: 'newpassword1' });
b = await bodyOf(r);
check(r.status === 400 && b.needCode === true, '没填验证码被拒（已有未使用的码时报验证码不正确）');
for (let i = 0; i < 5; i++) {
  r = await call('/api/auth/password', { code: '000000', newPassword: 'newpassword1' });
}
check(r.status === 400, '连续错码都被拒');
r = await call('/api/auth/password', { code: good0, newPassword: 'newpassword1' });
check(r.status === 400 && String((await bodyOf(r)).message).includes('错误次数过多'),
  '错 5 次后该码作废，正确码也进不来');
check(hashOf() === before0, '错码过程中密码始终没变');

/* 9. 正确码：改哈希、踢其它会话、审计、通知 */
reset();
await call('/api/auth/password/send-code', {});
const good = codeOf();
const before = hashOf();
r = await call('/api/auth/password', { code: good, newPassword: 'newpassword1' });
check(r.status === 200, '正确邮箱验证码 → 修改成功');
check(hashOf() !== before && hashOf() !== 'oauth:disabled:x',
  '新密码已写入（OAuth 无密码账号也能借此设置密码）');
check(S.sessions.some((x) => x.token === 'T-1') && !S.sessions.some((x) => x.token === 'T-2')
  && S.sessions.some((x) => x.token === 'T-9'),
  '踢掉本账号其它会话，保留当前会话，不动别人的会话');
check(S.audit_log.some((a) => a.action === 'user.password_code' && String(a.detail).includes('邮箱验证码')),
  '写审计日志，标明邮箱验证码');
check(S.notifications.some((n) => n.title === '密码已修改'), '发站内安全通知');

/* 10. 一次性 / 重放 */
r = await call('/api/auth/password', { code: good, newPassword: 'anotherpass1' });
check(r.status === 400, '同一验证码不能重放');

/* 11. 过期 */
reset();
await call('/api/auth/password/send-code', {});
S.verifications[S.verifications.length - 1].expires_at =
  new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ');
r = await call('/api/auth/password', { code: codeOf(), newPassword: 'newpassword1' });
check(r.status === 400 && String((await bodyOf(r)).message).includes('过期'), '过期验证码被拒');

/* 12. 场景隔离：reset 的码不能拿来改已登录账号的密码 */
reset();
await call('/api/auth/password/send-code', {});
const sceneCode = codeOf();
S.verifications[S.verifications.length - 1].scene = 'reset';
r = await call('/api/auth/password', { code: sceneCode, newPassword: 'newpassword1' });
check(r.status === 400 && hashOf() === 'oauth:disabled:x', '忘记密码的验证码不能改密');

/* 13. 邮箱隔离 + 前端传 email 被忽略 */
reset();
await call('/api/auth/password/send-code', {});
const mailCode = codeOf();
S.verifications[S.verifications.length - 1].email = 'someone@else.com';
r = await call('/api/auth/password', { code: mailCode, newPassword: 'newpassword1' });
check(r.status === 400, '发给别的邮箱的验证码不能改本账号密码');

reset();
await call('/api/auth/password/send-code', {});
const ignoredCode = codeOf();
r = await call('/api/auth/password', {
  email: 'attacker@gmail.com', code: ignoredCode, newPassword: 'newpassword1',
});
check(r.status === 200 && hashOf() !== 'oauth:disabled:x',
  '服务端只认会话里的 u.email，前端伪造 email 被忽略');

/* 14. 新密码长度校验不消耗验证码 */
reset();
await call('/api/auth/password/send-code', {});
const lenCode = codeOf();
r = await call('/api/auth/password', { code: lenCode, newPassword: 'short' });
check(r.status === 400 && String((await bodyOf(r)).message).includes('至少 8 位'), '短密码被拒');
r = await call('/api/auth/password', { code: lenCode, newPassword: 'x'.repeat(129) });
check(r.status === 400 && String((await bodyOf(r)).message).includes('密码过长'), '超长密码被拒');
r = await call('/api/auth/password', { code: lenCode, newPassword: 'newpassword1' });
check(r.status === 200, '长度校验在校验码之前，合法密码仍可用同一个码成功');

/* 15. 封禁账号 */
reset({ status: 'banned' });
await call('/api/auth/password/send-code', {});
r = await call('/api/auth/password', { code: codeOf(), newPassword: 'newpassword1' });
check(r.status === 403, '封禁账号不能改密');

/* 16. 服务商失败不假装成功 */
reset(); mailShouldFail = true;
r = await call('/api/auth/password/send-code', {});
check(r.status === 502, '邮件服务商失败明确报错');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`修改密码验证码回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
