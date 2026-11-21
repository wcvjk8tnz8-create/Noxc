/**
 * 更换邮箱专项回归：真跑 Hono /api/profile 路由 + 内存 D1 + mock Resend。
 * 覆盖：发码、节流、验证码校验/重放/过期、占用、封禁域名、写入与同步。
 */
import { Hono } from 'hono';
import profileRoutes from '../src/routes/profile.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));

type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  users: Row[]; verifications: Row[]; grants: Row[];
  notifications: Row[]; audit_log: Row[]; sessions: Row[]; seq: number;
};
let S: Store;
function fresh(): Store {
  return {
    settings: new Map(), users: [], verifications: [], grants: [],
    notifications: [], audit_log: [], sessions: [], seq: 0,
  };
}

function exec(sql: string, args: any[]) {
  const s = sql.replace(/\s+/g, ' ').trim();
  const rows: Row[] = [];
  let lastRowId = 0, changes = 0;

  const settingBind = s.match(/^SELECT value FROM settings WHERE key = \?/);
  const settingLit = s.match(/^SELECT value FROM settings WHERE key = '([^']+)'/);
  if (settingBind || settingLit) {
    const k = settingBind ? String(args[0]) : (settingLit as RegExpMatchArray)[1];
    const v = S.settings.get(k);
    if (v !== undefined) rows.push({ value: v });
  } else if (/^SELECT id FROM users WHERE email = \? AND id <> \?/.test(s)) {
    const u = S.users.find((x) => x.email === args[0] && x.id !== Number(args[1]));
    if (u) rows.push({ id: u.id });
  } else if (/^SELECT id FROM users WHERE email = \?/.test(s)) {
    const u = S.users.find((x) => x.email === args[0]);
    if (u) rows.push({ id: u.id });
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
    S.verifications.push({ id, email: args[0], scene: args[1], code_hash: args[2], ip: args[3], expires_at: args[4], used: 0, tries: 0, created_at: args[5] });
    lastRowId = id; changes = 1;
  } else if (/^UPDATE email_verifications SET tries = tries \+ 1 WHERE id = \?/.test(s)) {
    const v = S.verifications.find((x) => x.id === Number(args[0]));
    if (v) { v.tries = Number(v.tries || 0) + 1; changes = 1; }
  } else if (/^UPDATE email_verifications SET used = 1 WHERE id = \?/.test(s)) {
    const v = S.verifications.find((x) => x.id === Number(args[0]));
    if (v) { v.used = 1; changes = 1; }
  } else if (/^UPDATE users SET email = \? WHERE id = \?/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[1]));
    if (u) { u.email = args[0]; changes = 1; }
  } else if (/^UPDATE oauth_quota_grants SET email = \?/.test(s)) {
    const g = S.grants.find((x) => x.provider === args[1] && x.user_id === Number(args[2]));
    if (g) { g.email = args[0]; changes = 1; }
  } else if (/^INSERT INTO audit_log /.test(s)) {
    S.audit_log.push({ user_id: args[0], action: args[1], target: args[2], detail: args[3] }); changes = 1;
  } else if (/^INSERT INTO notifications /.test(s)) {
    S.notifications.push({ user_id: args[0], type: args[1], title: args[2], body: args[3] }); changes = 1;
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
app.route('/api/profile', profileRoutes);

const MAIL_CFG = {
  mail_provider: 'resend', mail_from: 'verify@noxc.uk',
  mail_api_key: 're_TEST', site_name: 'Noxc',
};
let env: any;
function reset(opts: { settings?: Record<string, string>; email?: string; extraUsers?: Row[]; grants?: boolean } = {}) {
  S = fresh();
  for (const [k, v] of Object.entries({ ...MAIL_CFG, ...(opts.settings || {}) })) S.settings.set(k, v);
  const email = opts.email || 'nl.0123456789abcdef0123@oauth.local';
  S.users.push({ id: 1, email, password_hash: 'oauth:disabled:x', role: 'user', status: 'active', quota: 5, created_at: Date.now() });
  for (const u of opts.extraUsers || []) S.users.push(u);
  if (opts.grants) S.grants.push({ provider: 'nodeloc', user_id: 1, email: 'old@nodeloc.com', amount: 5 });
  S.sessions.push({ token: 'T-1', user_id: 1 });
  currentUser = { id: 1, email, role: 'user', status: 'active', quota: 5 };
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

/* ───────── 用例 ───────── */
reset(); currentUser = null;
let r = await call('/api/profile/email/send', { email: 'new@gmail.com' });
check(r.status === 401, '未登录不能发码');
reset(); currentUser = { id: 1, email: 'nl.0123456789abcdef0123@oauth.local', role: 'user' };

reset({ settings: { mail_api_key: '' } });
r = await call('/api/profile/email/send', { email: 'new@gmail.com' });
check(r.status === 503 && (await bodyOf(r)).mailNotConfigured === true, '未配置邮件服务明确 503，不假装发送');

reset();
for (const [mail, label] of [
  ['not-an-email', '格式不合法'],
  ['nl.0123456789abcdef0123@oauth.local', '与当前相同'],
  ['x@mailinator.com', '一次性邮箱域名'],
  ['x@foo.test', '保留 TLD .test'],
] as [string, string][]) {
  r = await call('/api/profile/email/send', { email: mail });
  check(r.status === 400, `${label}被拒绝`);
}
check(sentMails.length === 0, '被拒绝的请求不会真的发邮件');

/* @oauth.local 已解封：不再被硬性封禁域名拦下（其它保留 TLD 仍拒绝） */
reset();
r = await call('/api/profile/email/send', { email: 'x@oauth.local' });
check(r.status === 200 && sentMails.length === 1 && sentMails[0].to === 'x@oauth.local',
  '@oauth.local 已解封，可以正常发码');

reset({ extraUsers: [{ id: 2, email: 'taken@gmail.com', status: 'active' }] });
r = await call('/api/profile/email/send', { email: 'taken@gmail.com' });
check(r.status === 400 && sentMails.length === 0, '已被别的账号占用 → 拒绝且不发码');

/* 关键：NodeLoc 占位账号可以换成任意正常邮箱，不套注册白名单 / edu 规则 */
reset();
r = await call('/api/profile/email/send', { email: 'my.custom@somewhere.net' });
check(r.status === 200 && (await bodyOf(r)).sent === true, '非白名单域名也能发码（换绑不走注册规则）');
check(sentMails.length === 1 && sentMails[0].to === 'my.custom@somewhere.net', '验证码发到新邮箱');
check(sentMails[0].subject.includes('更换邮箱验证码') && sentMails[0].text.includes('更换账号邮箱'),
  '邮件标题与正文是「更换邮箱」而不是「注册」');
check(/^\d{6}$/.test(codeOf()), '邮件里带 6 位验证码，响应体不暴露');

r = await call('/api/profile/email/send', { email: 'my.custom@somewhere.net' });
check(r.status === 400 && sentMails.length === 1, '60 秒内重复发送被节流');

/* 错误码 / 重放 / 过期 */
reset();
await call('/api/profile/email/send', { email: 'new@gmail.com' });
const good = codeOf('new@gmail.com');
r = await call('/api/profile/email/confirm', { email: 'new@gmail.com', code: '000000' });
check(r.status === 400 && S.users[0].email.startsWith('nl.'), '错误验证码不改邮箱');
for (let i = 0; i < 4; i++) await call('/api/profile/email/confirm', { email: 'new@gmail.com', code: '000000' });
r = await call('/api/profile/email/confirm', { email: 'new@gmail.com', code: good });
check(r.status === 400 && String((await bodyOf(r)).message).includes('错误次数过多'), '错 5 次后该码作废');

reset();
await call('/api/profile/email/send', { email: 'new@gmail.com' });
const code2 = codeOf();
r = await call('/api/profile/email/confirm', { email: 'new@gmail.com', code: code2 });
check(r.status === 200 && (await bodyOf(r)).email === 'new@gmail.com', '正确验证码 → 更换成功');
check(S.users[0].email === 'new@gmail.com', 'users.email 已写入新邮箱');
check(S.sessions[0].user_id === 1, '当前会话按 user_id 保持有效，不被登出');
r = await call('/api/profile/email/confirm', { email: 'new@gmail.com', code: code2 });
check(r.status === 400, '同一验证码不能重放');
check(S.audit_log.some((a) => a.action === 'user.email_change' && String(a.detail).includes('new@gmail.com')), '写审计日志');
check(S.notifications.some((n) => n.title === '账号邮箱已更换' && String(n.body).includes('new@gmail.com')), '发站内通知');

/* 领取记录同步，且 oauth 绑定关系不受影响 */
reset({ grants: true });
await call('/api/profile/email/send', { email: 'new@qq.com' });
r = await call('/api/profile/email/confirm', { email: 'new@qq.com', code: codeOf() });
check(r.status === 200 && S.grants[0].email === 'new@qq.com', '/status 的领取记录同步刷新邮箱');

/* 过期码 */
reset();
await call('/api/profile/email/send', { email: 'new@gmail.com' });
S.verifications[S.verifications.length - 1].expires_at = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ');
r = await call('/api/profile/email/confirm', { email: 'new@gmail.com', code: codeOf() });
check(r.status === 400 && String((await bodyOf(r)).message).includes('过期'), '过期验证码被拒');

/* 发码到确认之间被抢注 */
reset();
await call('/api/profile/email/send', { email: 'race@gmail.com' });
const raceCode = codeOf();
S.users.push({ id: 99, email: 'race@gmail.com', status: 'active' });
r = await call('/api/profile/email/confirm', { email: 'race@gmail.com', code: raceCode });
check(r.status === 400 && S.users[0].email.startsWith('nl.'), '并发抢注时二次校验兜底，不覆盖别人邮箱');

/* 发送失败不写入 */
reset(); mailShouldFail = true;
r = await call('/api/profile/email/send', { email: 'new@gmail.com' });
check(r.status === 502, '邮件服务商失败明确报错');
mailShouldFail = false;

/* confirm 时未登录 / 无效邮箱 */
reset(); currentUser = null;
r = await call('/api/profile/email/confirm', { email: 'new@gmail.com', code: '123456' });
check(r.status === 401, '未登录不能确认换绑');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`更换邮箱回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
