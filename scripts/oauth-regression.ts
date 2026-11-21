/**
 * NodeLoc OAuth 专项回归：真跑 Hono 路由 + 内存 D1 + mock 掉 NodeLoc 两个端点。
 * 不依赖 node_modules 之外的任何服务，覆盖授权码全流程与防重放 / 防接管。
 */
import { Hono } from 'hono';
import nodelocRoutes from '../src/routes/nodeloc.js';
import { nodelocConfig, redirectUriOf } from '../src/lib/nodeloc.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));

/* ───────── 内存 D1 ───────── */
type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  users: Row[]; registrations: Row[]; oauth_states: Row[];
  oauth_bindings: Row[]; oauth_quota_grants: Row[]; sessions: Row[]; audit_log: Row[];
  ip_bans: Row[]; notifications: Row[]; seq: number;
};
let S: Store;
let lastSql = '';
let lastArgs: any[] = [];

function fresh(): Store {
  return {
    settings: new Map(), users: [], registrations: [], oauth_states: [],
    oauth_bindings: [], oauth_quota_grants: [], sessions: [], audit_log: [],
    ip_bans: [], notifications: [], seq: 0,
  };
}

function exec(sql: string, args: any[]): { rows: Row[]; lastRowId: number; changes: number } {
  const s = sql.replace(/\s+/g, ' ').trim();
  lastSql = s; lastArgs = args;
  const rows: Row[] = [];
  let lastRowId = 0, changes = 0;

  const settingKey = s.match(/^SELECT value FROM settings WHERE key = \?/);
  const settingLit = s.match(/^SELECT value FROM settings WHERE key = '([^']+)'/);
  if (settingKey || settingLit) {
    const k = settingKey ? String(args[0]) : (settingLit as RegExpMatchArray)[1];
    const v = S.settings.get(k);
    if (v !== undefined) rows.push({ value: v });
  } else if (/^SELECT reason FROM ip_bans WHERE ip = \?/.test(s)) {
    const r = S.ip_bans.find((x) => x.ip === args[0]);
    if (r) rows.push({ reason: r.reason });
  } else if (/^SELECT COUNT\(\*\) AS n FROM registrations WHERE ip = \?/.test(s)) {
    rows.push({ n: S.registrations.filter((x) => x.ip === args[0]).length });
  } else if (/^SELECT id, status FROM users WHERE email = \?/.test(s)) {
    const u = S.users.find((x) => x.email === args[0]);
    if (u) rows.push({ id: u.id, status: u.status });
  } else if (/^SELECT id FROM users WHERE email = \? AND id <> \?/.test(s)) {
    const u = S.users.find((x) => x.email === args[0] && x.id !== Number(args[1]));
    if (u) rows.push({ id: u.id });
  } else if (/^UPDATE users SET email = \?/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[1]));
    if (u) {
      u.email = args[0];
      if (s.includes("status = 'active'")) { u.status = 'active'; u.ban_reason = null; }
      changes = 1;
    }
  } else if (/^SELECT \* FROM users WHERE id = \?/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[0]));
    if (u) rows.push({ ...u });
  } else if (/^SELECT id, role, quota FROM users WHERE id = \?/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[0]));
    if (u) rows.push({ id: u.id, role: u.role, quota: u.quota });
  } else if (/^SELECT email, amount FROM oauth_quota_grants WHERE provider = \? AND user_id = \?/.test(s)) {
    const g = S.oauth_quota_grants.find((x) => x.provider === args[0] && x.user_id === Number(args[1]));
    if (g) rows.push({ email: g.email, amount: g.amount });
  } else if (/^INSERT OR IGNORE INTO oauth_quota_grants /.test(s)) {
    if (S.oauth_quota_grants.some((x) => x.provider === args[0] && x.user_id === Number(args[1]))) changes = 0;
    else {
      S.oauth_quota_grants.push({ provider: args[0], user_id: Number(args[1]), email: args[2], amount: args[3], created_at: args[4] });
      changes = 1;
    }
  } else if (/^UPDATE oauth_quota_grants SET amount = \? WHERE provider = \? AND user_id = \?/.test(s)) {
    const g = S.oauth_quota_grants.find((x) => x.provider === args[1] && x.user_id === Number(args[2]));
    if (g) { g.amount = Number(args[0]); changes = 1; }
  } else if (/^UPDATE users SET quota = \? WHERE id = \?/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[1]));
    if (u) { u.quota = Number(args[0]); changes = 1; }
  } else if (/^SELECT user_id FROM oauth_bindings WHERE provider = \? AND sub = \?/.test(s)) {
    const b = S.oauth_bindings.find((x) => x.provider === args[0] && x.sub === args[1]);
    if (b) rows.push({ user_id: b.user_id });
  } else if (/^SELECT username, created_at FROM oauth_bindings WHERE provider = \? AND user_id = \?/.test(s)) {
    const b = S.oauth_bindings.find((x) => x.provider === args[0] && x.user_id === Number(args[1]));
    if (b) rows.push({ username: b.username, created_at: b.created_at });
  } else if (/^DELETE FROM oauth_states WHERE state = \? AND exp >= \? RETURNING/.test(s)) {
    const i = S.oauth_states.findIndex((x) => x.state === args[0] && Number(x.exp) >= Number(args[1]));
    if (i >= 0) { rows.push({ mode: S.oauth_states[i].mode, user_id: S.oauth_states[i].user_id }); S.oauth_states.splice(i, 1); changes = 1; }
  } else if (/^SELECT mode, user_id, exp FROM oauth_states WHERE state = \?/.test(s)) {
    const r = S.oauth_states.find((x) => x.state === args[0]);
    if (r) rows.push({ mode: r.mode, user_id: r.user_id, exp: r.exp });
  } else if (/^DELETE FROM oauth_states WHERE state = \?$/.test(s)) {
    const n = S.oauth_states.length;
    S.oauth_states = S.oauth_states.filter((x) => x.state !== args[0]);
    changes = n - S.oauth_states.length;
  } else if (/^DELETE FROM oauth_bindings WHERE provider = \? AND user_id = \?/.test(s)) {
    const n = S.oauth_bindings.length;
    S.oauth_bindings = S.oauth_bindings.filter((x) => !(x.provider === args[0] && x.user_id === Number(args[1])));
    changes = n - S.oauth_bindings.length;
  } else if (/^INSERT INTO oauth_states /.test(s)) {
    S.oauth_states.push({ state: args[0], mode: args[1], user_id: args[2], exp: args[3], created_at: args[4] });
    changes = 1;
  } else if (/^INSERT INTO oauth_bindings /.test(s)) {
    if (S.oauth_bindings.some((x) => x.provider === args[0] && x.sub === args[1])) throw new Error('UNIQUE constraint failed');
    S.oauth_bindings.push({ provider: args[0], sub: args[1], user_id: args[2], username: args[3], avatar_url: args[4], created_at: args[5] });
    changes = 1;
  } else if (/^INSERT INTO users \(email, password_hash/.test(s)) {
    const id = ++S.seq;
    S.users.push({ id, email: args[0], password_hash: args[1], role: args[2], status: args[3], quota: args[4], created_at: args[5], last_login_at: null });
    lastRowId = id; changes = 1;
  } else if (/^INSERT INTO registrations /.test(s)) {
    S.registrations.push({ user_id: args[0], ip: args[1], ua: args[2], agreed_terms: args[3], created_at: args[4] }); changes = 1;
  } else if (/^INSERT INTO sessions /.test(s)) {
    S.sessions.push({ token: args[0], user_id: args[1], expires_at: args[2], created_at: args[3], ip: args[4], ua: args[5] }); changes = 1;
  } else if (/^INSERT INTO audit_log /.test(s)) {
    S.audit_log.push({ user_id: args[0], action: args[1], target: args[2], detail: args[3] }); changes = 1;
  } else if (/^UPDATE users SET last_login_at = \? WHERE id = \?/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[1]));
    if (u) { u.last_login_at = args[0]; changes = 1; }
  } else {
    // notify() / 其它未知语句：返回空结果，不打断主流程
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
      return {
        bind(...args: any[]) { return wrap(sql, args); },
        first: self.first, all: self.all, run: self.run,
      };
    },
  };
}

/* ───────── mock NodeLoc 端点 ───────── */
let tokenMode: 'ok' | 'fail' | 'basic' = 'ok';
let userinfoBody: any = { sub: 'nl-001', preferred_username: 'tester', email: 'tester@example.com' };
let userinfoLowerStatus = 200; // 模拟旧部署只认驼峰 userInfo
let userinfoUrls: string[] = [];
let tokenForms: string[] = [];
const json = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = String(input?.url || input);
  if (url.includes('/oauth-provider/token')) {
    tokenForms.push(String(init.body || ''));
    if (tokenMode === 'fail') return json({ error: 'invalid_grant' }, 400);
    if (tokenMode === 'basic' && !String(init.headers?.Authorization || '').startsWith('Basic '))
      return json({ error: 'client_auth_required' }, 401);
    return json({ access_token: 'AT-1', token_type: 'bearer', expires_in: 3600 });
  }
  const isLower = url.includes('/oauth-provider/userinfo') && !url.includes('userInfo');
  if (isLower || url.includes('/oauth-provider/userInfo')) {
    userinfoUrls.push(url);
    if (isLower && userinfoLowerStatus !== 200) return json({}, userinfoLowerStatus);
    const bearer = String(init.headers?.Authorization || '').startsWith('Bearer ');
    if (!bearer && !url.includes('access_token=')) return json({}, 401);
    return json(userinfoBody || {});
  }
  return json({});
};

/* ───────── 被测应用 ───────── */
let currentUser: any = null;
const app = new Hono();
app.use('*', async (c, next) => { c.set('user', currentUser); await next(); });
app.route('/api/auth/nodeloc', nodelocRoutes);
app.route('/oauth/nodeloc', nodelocRoutes);

let env: any;
function reset(settings: Record<string, string> = {}, envVars: Record<string, string> = {}) {
  S = fresh();
  for (const [k, v] of Object.entries(settings)) S.settings.set(k, v);
  env = { DB: makeDb(), DEFAULT_QUOTA: '5', ...envVars };
  currentUser = null;
  tokenMode = 'ok';
  userinfoBody = { sub: 'nl-001', preferred_username: 'tester', email: 'tester@example.com' };
  userinfoLowerStatus = 200;
  userinfoUrls = [];
  tokenForms = [];
}
const CTX: any = { waitUntil() {}, passThroughOnException() {} };
async function call(path: string, cookie = '') {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return app.fetch(new Request(`https://nic.test${path}`, { headers }), env, CTX);
}
function cookies(res: Response): string[] {
  const h: any = res.headers as any;
  return typeof h.getSetCookie === 'function' ? h.getSetCookie() : [res.headers.get('set-cookie') || ''];
}
function cookieVal(res: Response, name: string) {
  for (const line of cookies(res)) {
    const m = line.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    if (m && m[1]) return decodeURIComponent(m[1].trim());
  }
  return '';
}
const loc = (res: Response) => res.headers.get('location') || '';
const CONFIG = { nodeloc_enabled: '1', nodeloc_client_id: 'CID-1', nodeloc_client_secret: 'SECRET-VERY-LONG-1234' };

async function start() {
  const res = await call('/api/auth/nodeloc/start');
  const url = new URL(loc(res));
  return { res, state: url.searchParams.get('state') || '', cookie: `td_oauth_state=${cookieVal(res, 'td_oauth_state')}`, url };
}

/* ───────── 用例 ───────── */
reset();
let cfg = await nodelocConfig(env);
check(!cfg.enabled && !cfg.switchedOn && !cfg.configured, '默认关闭：无凭据且不启用');
check(cfg.scope === 'openid profile email' && cfg.autoRegister === true, '默认申请 email 权限、默认自动建号');

reset({ ...CONFIG, nodeloc_scope_email: '1', nodeloc_auto_register: '0' });
cfg = await nodelocConfig(env);
check(cfg.enabled && cfg.configured, '后台开关 + 凭据齐备才真正启用');
check(cfg.scope === 'openid profile email' && !cfg.autoRegister, 'email 权限与「仅绑定」策略可切换');
check(redirectUriOf({ req: { url: 'https://nic.test/oauth/nodeloc/callback' } }, cfg) === 'https://nic.test/oauth/nodeloc/callback', '回调地址按当前站点 origin 生成');
check(redirectUriOf({ req: { url: 'https://a.test/x' } }, { ...cfg, redirectUri: 'https://b.test/oauth/nodeloc/callback' }) === 'https://b.test/oauth/nodeloc/callback', '后台固定回调地址优先');

reset({ nodeloc_client_id: 'CID-1', nodeloc_client_secret: 'SEC' });
let r = await call('/api/auth/nodeloc/start');
check(r.status === 302 && loc(r).includes('oauth=disabled'), '未启用时 /start 不跳授权页，回登录页提示');

reset(CONFIG);
let st = await start();
check(st.res.status === 302 && st.url.origin === 'https://www.nodeloc.com' && st.url.pathname === '/oauth-provider/authorize', '/start 跳到官方授权端点');
check(st.url.searchParams.get('client_id') === 'CID-1' && st.url.searchParams.get('response_type') === 'code' && st.url.searchParams.get('scope') === 'openid profile email', '授权参数 client_id / response_type / scope 正确');
check(!st.url.toString().includes('SECRET-VERY-LONG-1234'), 'Client Secret 绝不出现在浏览器可见的授权 URL 里');
check(!!cookieVal(st.res, 'td_oauth_state') && cookies(st.res).some((x) => /HttpOnly/i.test(x) && /SameSite=Lax/i.test(x)), 'state 写入 HttpOnly / SameSite=Lax Cookie');
check(S.oauth_states.length === 1 && S.oauth_states[0].mode === 'login', 'state 同时落 D1，模式为 login');

r = await call('/api/auth/nodeloc/start?bind=1');
check(loc(r).includes('oauth=bind_login'), '未登录不能发起绑定');
currentUser = { id: 7, email: 'me@example.com', role: 'user', status: 'active' };
r = await call('/api/auth/nodeloc/start');
check(loc(r) === '/dashboard', '已登录点登录按钮直接去控制台');
currentUser = null;

/* 完整回调 */
reset(CONFIG);
st = await start();
r = await call(`/oauth/nodeloc/callback?code=CODE-1&state=${st.state}`, st.cookie);
check(r.status === 302 && loc(r) === '/dashboard', '授权码回调成功 → 签发会话并跳控制台');
check(!!cookieVal(r, 'sh_session') && S.sessions.length === 1, '会话 Cookie 与 D1 session 已建立');
check(S.users.length === 1 && S.users[0].email === 'tester@example.com', '自动建号直接用 NodeLoc 真实邮箱，不再生成 @oauth.local 乱码');
check(S.users.every((u) => !String(u.email).endsWith('@oauth.local')), '全流程零乱码内部邮箱');
check(!String(S.users[0].password_hash).startsWith('pbkdf2$'), 'OAuth 账号没有可登录密码');
check(S.oauth_bindings.length === 1 && S.oauth_bindings[0].sub === 'nl-001', '写入 provider+sub 绑定');
check(S.registrations.length === 1 && S.registrations[0].user_id === S.users[0].id, '记录注册来源，纳入同 IP 限制');
check(tokenForms.some((f) => f.includes('client_secret=SECRET-VERY-LONG-1234')), 'Secret 只在服务端 token 请求里出现');

/* state 防重放 / 防 CSRF */
r = await call(`/oauth/nodeloc/callback?code=CODE-1&state=${st.state}`, st.cookie);
check(loc(r).includes('oauth=state_expired'), '同一 state 重放被拒（一次性领取）');
reset(CONFIG); st = await start();
r = await call(`/oauth/nodeloc/callback?code=CODE-1&state=${st.state}`, 'td_oauth_state=WRONG');
check(loc(r).includes('oauth=state_mismatch'), 'Cookie 与 query 的 state 不一致被拒');
reset(CONFIG); st = await start();
S.oauth_states[0].exp = Date.now() - 1000;
r = await call(`/oauth/nodeloc/callback?code=CODE-1&state=${st.state}`, st.cookie);
check(loc(r).includes('oauth=state_expired'), '过期 state 被拒');

/* 各类失败分支 */
reset(CONFIG); st = await start();
r = await call(`/oauth/nodeloc/callback?error=access_denied&state=${st.state}`, st.cookie);
check(loc(r).includes('oauth=denied'), '用户拒绝授权回登录页提示');
reset(CONFIG); st = await start(); tokenMode = 'fail';
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r).includes('oauth=token_failed'), '两次换 token 都失败 → 明确报错');
/* 资料读取：只要能读到 email 就够了，端点拼写与字段结构都容错 */
reset(CONFIG); st = await start();
userinfoBody = { id: 123, username: 'user1', name: 'user1', trust_level: 2, email: 'user1@example.com' };
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r) === '/dashboard' && S.oauth_bindings[0]?.sub === '123', '官方响应只有 id、没有 sub 也能绑定');

reset(CONFIG); st = await start();
userinfoBody = { email: 'only@example.com' };
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r) === '/dashboard' && String(S.oauth_bindings[0]?.sub).startsWith('email:'),
  'userInfo 只返回 email 也能登录，不再要求 sub');
check(S.oauth_quota_grants[0]?.email === 'only@example.com', '读到的邮箱写入领取记录，/status 可查');

reset(CONFIG); st = await start();
userinfoBody = { data: { user: { email: 'Nested@Example.com' } } };
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(S.oauth_quota_grants[0]?.email === 'nested@example.com', '嵌套结构也能取出邮箱并统一小写');

reset(CONFIG); st = await start();
userinfoBody = { username: 'ghost' };
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r).includes('oauth=email_required') && S.users.length === 0,
  'userInfo 没返回邮箱时明确拒绝，不静默创建乱码账号');

reset(CONFIG); st = await start();
userinfoLowerStatus = 404; userinfoUrls = [];
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r) === '/dashboard'
  && userinfoUrls[0]?.endsWith('/oauth-provider/userinfo')
  && userinfoUrls[1]?.endsWith('/oauth-provider/userInfo'),
  '小写 userinfo 404 时自动回退旧拼写，仍能读到资料');
reset(CONFIG); st = await start(); tokenMode = 'basic';
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r) === '/dashboard' && tokenForms.length === 2, 'Provider 只收 Basic 时自动回退并成功');

/* 策略与绑定 */
reset({ ...CONFIG, nodeloc_auto_register: '0' }); st = await start();
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r).includes('oauth=bind_required') && S.users.length === 0, '「仅绑定」策略不自动建号');
reset(CONFIG); st = await start();
userinfoBody = { sub: 'nl-001', preferred_username: 'tester', email: 'victim@example.com' };
S.users.push({ id: 99, email: 'victim@example.com', password_hash: 'pbkdf2$x', role: 'user', status: 'active', quota: 5, created_at: Date.now(), last_login_at: null });
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(S.oauth_bindings.every((b) => b.user_id !== 99) && loc(r).includes('oauth=email_taken'),
  '真实邮箱已注册时拒绝建号并提示先登录再绑定，绝不认领已有账号（防接管）');

reset(CONFIG);
currentUser = { id: 42, email: 'me@example.com', role: 'user', status: 'active' };
r = await call('/api/auth/nodeloc/start?bind=1');
const bindUrl = new URL(loc(r));
const bindState = bindUrl.searchParams.get('state') || '';
const bindCookie = `td_oauth_state=${cookieVal(r, 'td_oauth_state')}`;
r = await call(`/oauth/nodeloc/callback?code=X&state=${bindState}`, bindCookie);
check(loc(r).includes('/profile?oauth=bound') && S.users.length === 0, '绑定模式只写绑定关系，不建新账号');
check(S.oauth_bindings.length === 1 && S.oauth_bindings[0].user_id === 42, '绑定落到当前登录用户');

reset(CONFIG);
S.oauth_bindings.push({ provider: 'nodeloc', sub: 'nl-001', user_id: 999, username: 'other', created_at: Date.now() });
currentUser = { id: 42, email: 'me@example.com', role: 'user', status: 'active' };
const bs = await call('/api/auth/nodeloc/start?bind=1');
const bsState = new URL(loc(bs)).searchParams.get('state') || '';
const bsCookie = `td_oauth_state=${cookieVal(bs, 'td_oauth_state')}`;
const br = await call(`/oauth/nodeloc/callback?code=X&state=${bsState}`, bsCookie);
check(loc(br).includes('oauth=already_bound'), '同一 NodeLoc 账号不能绑到第二个本地账号');

/* 绑定奖励配额：+5，且每个本地账号只领一次 */
async function bindFlow(uid: number) {
  currentUser = { id: uid, email: `u${uid}@example.com`, role: 'user', status: 'active' };
  const s = await call('/api/auth/nodeloc/start?bind=1');
  const state = new URL(loc(s)).searchParams.get('state') || '';
  const cookie = `td_oauth_state=${cookieVal(s, 'td_oauth_state')}`;
  return call(`/oauth/nodeloc/callback?code=X&state=${state}`, cookie);
}
const mkUser = (id: number, quota: number, role = 'user') => ({
  id, email: `u${id}@example.com`, password_hash: 'pbkdf2$x', role, status: 'active',
  quota, created_at: Date.now(), last_login_at: null,
});

reset(CONFIG);
S.users.push(mkUser(42, 5));
r = await bindFlow(42);
check(loc(r).includes('oauth=bound&bonus=5'), '绑定成功回个人资料页并带回 +5');
check(S.users.find((u) => u.id === 42)?.quota === 10, '绑定后配额 5 → 10');
check(S.oauth_quota_grants.length === 1 && S.oauth_quota_grants[0].amount === 5, '领取记录只写一条、金额 5');
check(S.oauth_quota_grants[0].email === 'tester@example.com', '领取记录保存读到的 NodeLoc 邮箱');
r = await call('/api/auth/nodeloc/status');
const qStatus: any = await r.json();
check(qStatus.email === 'tester@example.com' && qStatus.quotaBonus === 5, '/status 返回邮箱与已领奖励');

await app.fetch(new Request('https://nic.test/api/auth/nodeloc/unbind', { method: 'POST' }), env, CTX);
r = await bindFlow(42);
check(loc(r).includes('bonus=0') && S.users.find((u) => u.id === 42)?.quota === 10, '解绑再绑不重复 +5');

reset(CONFIG);
S.users.push(mkUser(43, -1));
r = await bindFlow(43);
check(loc(r).includes('bonus=0') && S.users.find((u) => u.id === 43)?.quota === -1, '-1 不限量不叠加');

reset(CONFIG);
S.users.push(mkUser(44, 100, 'admin'));
r = await bindFlow(44);
check(loc(r).includes('bonus=0') && S.users.find((u) => u.id === 44)?.quota === 100, '管理员不叠加');

/* 状态 / 解绑 / 封禁 */
reset(CONFIG);
r = await call('/api/auth/nodeloc/status');
check(r.status === 401, '未登录查绑定状态返回 401');
currentUser = { id: 5, email: 'a@b.c', role: 'user', status: 'active' };
S.oauth_bindings.push({ provider: 'nodeloc', sub: 'nl-001', user_id: 5, username: 'tester', created_at: Date.now() });
r = await call('/api/auth/nodeloc/status');
const statusJson: any = await r.json();
check(statusJson.linked === true && statusJson.username === 'tester', '已绑定状态可查询');
r = await app.fetch(new Request('https://nic.test/api/auth/nodeloc/unbind', { method: 'POST' }), env, CTX);
check(S.oauth_bindings.length === 0, '解绑后绑定关系被删除');

reset(CONFIG);
S.users.push({ id: 8, email: 'banned@oauth.local', password_hash: 'x', role: 'user', status: 'banned', quota: 5, created_at: Date.now(), last_login_at: null });
S.oauth_bindings.push({ provider: 'nodeloc', sub: 'nl-001', user_id: 8, username: 'bad', created_at: Date.now() });
st = await start();
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r).includes('oauth=banned'), '被封禁账号不能通过第三方登录复活');

/* 存量 nl.<hex>@oauth.local 账号：下次登录回填真实 NodeLoc 邮箱 */
reset(CONFIG);
S.users.push({ id: 8, email: 'nl.0123456789abcdef0123@oauth.local', password_hash: 'oauth:disabled:x', role: 'user', status: 'active', quota: 5, created_at: Date.now(), last_login_at: null });
S.oauth_bindings.push({ provider: 'nodeloc', sub: 'nl-001', user_id: 8, username: 'tester', created_at: Date.now() });
userinfoBody = { sub: 'nl-001', preferred_username: 'tester', email: 'real@nodeloc.com' };
st = await start();
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r) === '/dashboard' && S.users.find((u) => u.id === 8)?.email === 'real@nodeloc.com',
  '存量乱码邮箱账号下次登录自动回填真实 NodeLoc 邮箱');
check(S.oauth_quota_grants.find((g) => g.user_id === 8)?.email === 'real@nodeloc.com',
  '回填同步刷新领取记录里的邮箱，/status 展示真实值');

/* 被密码登录误封的内部账号：回填时一并恢复 */
reset(CONFIG);
S.users.push({ id: 9, email: 'nl.abcdef0123456789abcd@oauth.local', password_hash: 'oauth:disabled:x', role: 'user', status: 'banned', ban_reason: '违规注册：一次性 / 非公开邮箱域名', quota: 5, created_at: Date.now(), last_login_at: null });
S.oauth_bindings.push({ provider: 'nodeloc', sub: 'nl-001', user_id: 9, username: 'tester', created_at: Date.now() });
userinfoBody = { sub: 'nl-001', preferred_username: 'tester', email: 'restored@nodeloc.com' };
st = await start();
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r) === '/dashboard'
  && S.users.find((u) => u.id === 9)?.email === 'restored@nodeloc.com'
  && S.users.find((u) => u.id === 9)?.status === 'active',
  '被误封的 NodeLoc 内部账号在回填时恢复 active');

/* 回填绝不覆盖其它账号已占用的邮箱 */
reset(CONFIG);
S.users.push({ id: 10, email: 'nl.11111111111111111111@oauth.local', password_hash: 'oauth:disabled:x', role: 'user', status: 'active', quota: 5, created_at: Date.now(), last_login_at: null });
S.users.push({ id: 11, email: 'taken@nodeloc.com', password_hash: 'pbkdf2$x', role: 'user', status: 'active', quota: 5, created_at: Date.now(), last_login_at: null });
S.oauth_bindings.push({ provider: 'nodeloc', sub: 'nl-001', user_id: 10, username: 'tester', created_at: Date.now() });
userinfoBody = { sub: 'nl-001', preferred_username: 'tester', email: 'taken@nodeloc.com' };
st = await start();
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r) === '/dashboard'
  && String(S.users.find((u) => u.id === 10)?.email).endsWith('@oauth.local')
  && S.users.find((u) => u.id === 11)?.email === 'taken@nodeloc.com',
  '真实邮箱已被别人占用时跳过回填，不覆盖、不接管');

/* 固定回调地址确实传给 token 端点 */
reset({ ...CONFIG, nodeloc_redirect_uri: 'https://fixed.test/oauth/nodeloc/callback' });
st = await start();
r = await call(`/oauth/nodeloc/callback?code=X&state=${st.state}`, st.cookie);
check(loc(r) === '/dashboard' && st.url.searchParams.get('redirect_uri') === 'https://fixed.test/oauth/nodeloc/callback', '自定义回调地址在授权与换 token 时一致');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`NodeLoc OAuth 回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
