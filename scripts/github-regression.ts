/**
 * GitHub OAuth / Star 奖励 / 按根域名每人注册次数 · 专项回归
 *
 * 真跑 Hono 路由 + 内存 D1 + mock GitHub 端点，不依赖任何外部服务：
 *   1. githubConfig 的开关 / 凭据 / 仓库 / 奖励额度 / 回调地址
 *   2. 授权码全流程（state 防重放、防接管、绑定 vs 建号、token 存储）
 *   3. Star 奖励：真实校验 204、每账号只领一次、+5 配额、解绑重绑不叠加
 *   4. 每根域名每人注册次数：meoy.top=1 / noxc.uk=-1、释放不退还、历史不回溯
 *
 * 运行：npx tsx scripts/github-regression.ts
 */
import { Hono } from 'hono';
import githubRoutes from '../src/routes/github.js';
import subdomainRoutes from '../src/routes/subdomains.js';
import {
  githubConfig, redirectUriOf, starRepoUrl, normalizeStarRepo,
  DEFAULT_STAR_REPO, DEFAULT_STAR_BONUS, GITHUB_SCOPE,
} from '../src/lib/github.js';
import {
  parseRootRegLimits, serializeRootRegLimits, rootRegLimitOf,
  userRootRegCount, bumpRootRegCount,
} from '../src/lib/rootLimits.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));

/* ───────────────────────── 内存 D1 ───────────────────────── */
type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  users: Row[]; registrations: Row[]; oauth_states: Row[];
  oauth_bindings: Row[]; oauth_quota_grants: Row[]; sessions: Row[];
  audit_log: Row[]; ip_bans: Row[]; notifications: Row[];
  subdomains: Row[]; root_reg_counts: Row[]; user_points: Row[];
  point_logs: Row[]; dns_records: Row[]; seq: number;
};
let S: Store;
function fresh(): Store {
  return {
    settings: new Map(), users: [], registrations: [], oauth_states: [],
    oauth_bindings: [], oauth_quota_grants: [], sessions: [], audit_log: [],
    ip_bans: [], notifications: [], subdomains: [], root_reg_counts: [],
    user_points: [], point_logs: [], dns_records: [], seq: 0,
  };
}

function exec(sql: string, args: any[]): { rows: Row[]; lastRowId: number; changes: number } {
  const s = sql.replace(/\s+/g, ' ').trim();
  const rows: Row[] = [];
  let lastRowId = 0, changes = 0;
  /* 统一配置层：SELECT key, value FROM settings（真实 D1 同形） */
  if (/^SELECT key, value FROM settings$/.test(s)) {
    for (const [key, value] of S.settings) rows.push({ key, value: String(value) });
    return { rows, lastRowId, changes };
  }
  const setting = (k: string) => {
    const v = S.settings.get(k);
    if (v !== undefined) rows.push({ value: v });
  };

  /* ── settings ── */
  if (/^SELECT value FROM settings WHERE key = \?$/.test(s)) setting(String(args[0]));
  else if (/^SELECT value FROM settings WHERE key = '([^']+)'$/.test(s)) {
    setting((s.match(/key = '([^']+)'/) as RegExpMatchArray)[1]);
  } else if (/^PRAGMA table_info\(/.test(s)) {
    /* 空结果 = 列都不存在；调用方会自行 ALTER，这里兜底即可 */
  } else if (/^ALTER TABLE /.test(s)) {
    /* 内存表本来就是无 schema 的，忽略 */
  } else if (/^CREATE TABLE IF NOT EXISTS /.test(s)) {
    /* 同上 */
  /* ── oauth_states ── */
  } else if (/^INSERT INTO oauth_states /.test(s)) {
    S.oauth_states.push({ state: args[0], mode: args[1], user_id: args[2], exp: args[3], created_at: args[4] });
    changes = 1;
  } else if (/^DELETE FROM oauth_states WHERE state = \? AND exp >= \? RETURNING/.test(s)) {
    const i = S.oauth_states.findIndex((x) => x.state === args[0] && Number(x.exp) >= Number(args[1]));
    if (i >= 0) { rows.push({ mode: S.oauth_states[i].mode, user_id: S.oauth_states[i].user_id }); S.oauth_states.splice(i, 1); changes = 1; }
  } else if (/^SELECT mode, user_id, exp FROM oauth_states WHERE state = \?$/.test(s)) {
    const r = S.oauth_states.find((x) => x.state === args[0]);
    if (r) rows.push({ ...r });
  } else if (/^DELETE FROM oauth_states WHERE state = \?$/.test(s)) {
    const n = S.oauth_states.length;
    S.oauth_states = S.oauth_states.filter((x) => x.state !== args[0]);
    changes = n - S.oauth_states.length;
  /* ── oauth_bindings ── */
  } else if (/^SELECT user_id FROM oauth_bindings WHERE provider = \? AND sub = \?$/.test(s)) {
    const b = S.oauth_bindings.find((x) => x.provider === args[0] && x.sub === args[1]);
    if (b) rows.push({ user_id: b.user_id });
  } else if (/^SELECT username, created_at, access_token FROM oauth_bindings WHERE provider = \? AND user_id = \?$/.test(s)) {
    const b = S.oauth_bindings.find((x) => x.provider === args[0] && x.user_id === Number(args[1]));
    if (b) rows.push({ username: b.username, created_at: b.created_at, access_token: b.access_token });
  } else if (/^SELECT username, access_token FROM oauth_bindings WHERE provider = \? AND user_id = \?$/.test(s)) {
    const b = S.oauth_bindings.find((x) => x.provider === args[0] && x.user_id === Number(args[1]));
    if (b) rows.push({ username: b.username, access_token: b.access_token });
  } else if (/^INSERT INTO oauth_bindings \(provider, sub, user_id, username, avatar_url, access_token, created_at\)/.test(s)) {
    if (S.oauth_bindings.some((x) => x.provider === args[0] && x.sub === args[1])) throw new Error('UNIQUE constraint failed');
    S.oauth_bindings.push({ provider: args[0], sub: args[1], user_id: args[2], username: args[3], avatar_url: args[4], access_token: args[5], created_at: args[6] });
    changes = 1;
  } else if (/^INSERT INTO oauth_bindings \(provider, sub, user_id, username, avatar_url, created_at\)/.test(s)) {
    if (S.oauth_bindings.some((x) => x.provider === args[0] && x.sub === args[1])) throw new Error('UNIQUE constraint failed');
    S.oauth_bindings.push({ provider: args[0], sub: args[1], user_id: args[2], username: args[3], avatar_url: args[4], created_at: args[5] });
    changes = 1;
  } else if (/^UPDATE oauth_bindings SET username = \?, avatar_url = \?, access_token = \? WHERE provider = \? AND user_id = \?$/.test(s)) {
    const b = S.oauth_bindings.find((x) => x.provider === args[3] && x.user_id === Number(args[4]));
    if (b) { b.username = args[0]; b.avatar_url = args[1]; b.access_token = args[2]; changes = 1; }
  } else if (/^DELETE FROM oauth_bindings WHERE provider = \? AND user_id = \?$/.test(s)) {
    const n = S.oauth_bindings.length;
    S.oauth_bindings = S.oauth_bindings.filter((x) => !(x.provider === args[0] && x.user_id === Number(args[1])));
    changes = n - S.oauth_bindings.length;
  /* ── oauth_quota_grants ── */
  } else if (/^SELECT amount FROM oauth_quota_grants WHERE provider = \? AND user_id = \?$/.test(s)) {
    const g = S.oauth_quota_grants.find((x) => x.provider === args[0] && x.user_id === Number(args[1]));
    if (g) rows.push({ amount: g.amount });
  } else if (/^INSERT OR IGNORE INTO oauth_quota_grants /.test(s)) {
    if (S.oauth_quota_grants.some((x) => x.provider === args[0] && x.user_id === Number(args[1]))) changes = 0;
    else { S.oauth_quota_grants.push({ provider: args[0], user_id: Number(args[1]), email: args[2], amount: args[3], created_at: args[4] }); changes = 1; }
  } else if (/^UPDATE oauth_quota_grants SET amount = \? WHERE provider = \? AND user_id = \?$/.test(s)) {
    const g = S.oauth_quota_grants.find((x) => x.provider === args[1] && x.user_id === Number(args[2]));
    if (g) { g.amount = Number(args[0]); changes = 1; }
  /* ── users ── */
  } else if (/^SELECT \* FROM users WHERE id = \?$/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[0]));
    if (u) rows.push({ ...u });
  } else if (/^SELECT id, role, quota FROM users WHERE id = \?$/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[0]));
    if (u) rows.push({ id: u.id, role: u.role, quota: u.quota });
  } else if (/^SELECT id, status FROM users WHERE email = \?$/.test(s)) {
    const u = S.users.find((x) => x.email === args[0]);
    if (u) rows.push({ id: u.id, status: u.status });
  } else if (/^UPDATE users SET quota = \? WHERE id = \?$/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[1]));
    if (u) { u.quota = Number(args[0]); changes = 1; }
  } else if (/^UPDATE users SET last_login_at = \? WHERE id = \?$/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[1]));
    if (u) { u.last_login_at = args[0]; changes = 1; }
  } else if (/^INSERT INTO users \(email, password_hash/.test(s)) {
    const id = ++S.seq;
    S.users.push({ id, email: args[0], password_hash: args[1], role: args[2], status: args[3], quota: args[4], created_at: args[5], last_login_at: null });
    lastRowId = id; changes = 1;
  } else if (/^INSERT INTO registrations /.test(s)) {
    S.registrations.push({ user_id: args[0], ip: args[1], ua: args[2], agreed_terms: args[3], created_at: args[4] }); changes = 1;
  } else if (/^SELECT COUNT\(\*\) AS n FROM registrations WHERE ip = \?$/.test(s)) {
    rows.push({ n: S.registrations.filter((x) => x.ip === args[0]).length });
  } else if (/^SELECT reason FROM ip_bans WHERE ip = \?$/.test(s)) {
    const r = S.ip_bans.find((x) => x.ip === args[0]);
    if (r) rows.push({ reason: r.reason });
  } else if (/^INSERT INTO sessions /.test(s)) {
    S.sessions.push({ token: args[0], user_id: args[1], expires_at: args[2], created_at: args[3], ip: args[4], ua: args[5] }); changes = 1;
  } else if (/^INSERT INTO audit_log /.test(s)) {
    S.audit_log.push({ user_id: args[0], action: args[1], target: args[2], detail: args[3] }); changes = 1;
  } else if (/^INSERT INTO notifications /.test(s)) {
    S.notifications.push({ user_id: args[0] }); changes = 1;
  /* ── subdomains（每根域限制集成用） ── */
  } else if (/^SELECT s\.id, s\.label, s\.fqdn, s\.status, s\.user_id/.test(s)) {
    const r = S.subdomains.find((x) => x.fqdn === args[0]);
    if (r) rows.push({ ...r });
  } else if (/^SELECT id, fqdn, created_at FROM subdomains WHERE user_id = \? AND status = 'pending'/.test(s)) {
    const r = S.subdomains.find((x) => x.user_id === Number(args[0]) && x.status === 'pending');
    if (r) rows.push({ id: r.id, fqdn: r.fqdn, created_at: r.created_at });
  } else if (/^SELECT COUNT\(\*\) AS n FROM subdomains WHERE user_id = \? AND status IN /.test(s)) {
    rows.push({ n: S.subdomains.filter((x) => x.user_id === Number(args[0]) && x.status !== 'rejected').length });
  } else if (/^INSERT INTO subdomains \(label, root_domain, fqdn, user_id, status/.test(s)) {
    const id = ++S.seq;
    S.subdomains.push({ id, label: args[0], root_domain: args[1], fqdn: args[2], user_id: args[3], status: args[4], note: args[5], reason: args[6], expires_at: args[7], perpetual: args[8], created_at: args[9] });
    lastRowId = id; changes = 1;
  } else if (/^UPDATE subdomains SET apply_cost = \? WHERE id = \?$/.test(s)) {
    const r = S.subdomains.find((x) => x.id === Number(args[1]));
    if (r) { r.apply_cost = args[0]; changes = 1; }
  /* ── root_reg_counts ── */
  } else if (/^SELECT count FROM root_reg_counts WHERE user_id = \? AND root_domain = \?$/.test(s)) {
    const r = S.root_reg_counts.find((x) => x.user_id === Number(args[0]) && x.root_domain === args[1]);
    if (r) rows.push({ count: r.count });
  } else if (/^INSERT INTO root_reg_counts /.test(s)) {
    const r = S.root_reg_counts.find((x) => x.user_id === Number(args[0]) && x.root_domain === args[1]);
    if (r) { r.count += 1; r.updated_at = args[2]; }
    else S.root_reg_counts.push({ user_id: Number(args[0]), root_domain: args[1], count: 1, updated_at: args[2] });
    changes = 1;
  /* ── 积分 ── */
  } else if (/^SELECT points FROM user_points WHERE user_id = \?$/.test(s)) {
    const r = S.user_points.find((x) => x.user_id === Number(args[0]));
    if (r) rows.push({ points: r.points });
  } else if (/^INSERT INTO user_points /.test(s)) {
    S.user_points.push({ user_id: Number(args[0]), points: args[1], updated_at: args[2] }); changes = 1;
  } else if (/^UPDATE user_points SET points = points \+ \? WHERE user_id = \?$/.test(s)) {
    const r = S.user_points.find((x) => x.user_id === Number(args[1]));
    if (r) { r.points += Number(args[0]); changes = 1; }
  } else if (/^INSERT INTO point_logs /.test(s)) {
    S.point_logs.push({ user_id: args[0] }); changes = 1;
  } else {
    /* 其它（captcha / 通知去重 / AI 批处理 / DNS）：返回空结果，不打断主流程 */
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

/* ───────────────────── mock GitHub / AI 端点 ───────────────────── */
let tokenMode: 'ok' | 'fail' = 'ok';
let ghUser: any = { id: 1001, login: 'octocat', email: 'octo@example.com', avatar_url: 'https://avatars.test/o.png' };
let ghEmails: any[] = [{ email: 'octo@example.com', primary: true, verified: true }];
let starredStatus = 204;     // 204 = 已 Star；404 = 未 Star；401 = token 失效
let tokenForms: string[] = [];
const json = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = String(input?.url || input);
  if (url.includes('/login/oauth/access_token')) {
    tokenForms.push(String(init.body || ''));
    if (tokenMode === 'fail') return json({ error: 'bad_verification_code' }, 400);
    return json({ access_token: 'GH-AT-1', token_type: 'bearer', scope: GITHUB_SCOPE });
  }
  if (url.endsWith('/user/emails')) return json(ghEmails);
  if (/\/user$/.test(url)) {
    const bearer = String(init.headers?.Authorization || '').startsWith('Bearer ');
    if (!bearer) return json({ message: 'Bad credentials' }, 401);
    return json(ghUser);
  }
  if (url.includes('/user/starred/')) return new Response(null, { status: starredStatus });
  /* AI 自动审核等其它外部请求一律失败，走「降级不卡申请」分支 */
  throw new Error('network disabled in regression');
};

/* ───────────────────────── 被测应用 ───────────────────────── */
let currentUser: any = null;
const app = new Hono();
app.use('*', async (c, next) => { c.set('user', currentUser); await next(); });
app.route('/api/auth/github', githubRoutes);
app.route('/oauth/github', githubRoutes);
app.route('/api/subdomains', subdomainRoutes);

let env: any;
function reset(settings: Record<string, string> = {}, envVars: Record<string, string> = {}) {
  S = fresh();
  for (const [k, v] of Object.entries(settings)) S.settings.set(k, v);
  env = {
    DB: makeDb(), DEFAULT_QUOTA: '5', REQUIRE_APPROVAL: '0',
    ROOT_DOMAIN: 'meoy.top', ROOT_DOMAINS: 'meoy.top,noxc.uk',
    ...envVars,
  };
  currentUser = null;
  tokenMode = 'ok';
  ghUser = { id: 1001, login: 'octocat', email: 'octo@example.com', avatar_url: 'https://avatars.test/o.png' };
  ghEmails = [{ email: 'octo@example.com', primary: true, verified: true }];
  starredStatus = 204;
  tokenForms = [];
}
const CTX: any = { waitUntil() {}, passThroughOnException() {} };
async function call(path: string, cookie = '', method = 'GET', body?: any) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.fetch(new Request(`https://nic.test${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  }), env, CTX);
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
const CONFIG = {
  github_enabled: '1', github_client_id: 'GH-CID-1', github_client_secret: 'GH-SECRET-VERY-LONG-1234',
};
const mkUser = (id: number, quota = 5, role = 'user') => ({
  id, email: `u${id}@example.com`, password_hash: 'pbkdf2$x', role, status: 'active',
  quota, created_at: Date.now(), last_login_at: null,
});

async function start(query = '') {
  const res = await call(`/api/auth/github/start${query}`);
  const url = new URL(loc(res));
  return { res, state: url.searchParams.get('state') || '', cookie: `td_gh_oauth_state=${cookieVal(res, 'td_gh_oauth_state')}`, url };
}
async function callback(st: Awaited<ReturnType<typeof start>>, cookie = st.cookie) {
  return call(`/oauth/github/callback?code=CODE-1&state=${st.state}`, cookie);
}

/* ═════════════════════ 1. 配置 ═════════════════════ */
reset();
let cfg = await githubConfig(env);
check(!cfg.enabled && !cfg.switchedOn && !cfg.configured, '默认关闭：未配置 GitHub OAuth 时不启用');
check(cfg.starRepo === DEFAULT_STAR_REPO && cfg.starBonus === DEFAULT_STAR_BONUS, '默认奖励仓库与 +5 配额');
check(cfg.scope === GITHUB_SCOPE && cfg.autoRegister === true, '默认 scope 含 read:user/user:email/public_repo，默认自动建号');
check(DEFAULT_STAR_BONUS === 5, 'Star 奖励默认就是 5 个配额');

reset(CONFIG);
cfg = await githubConfig(env);
check(cfg.enabled && cfg.configured, '后台开关 + Client ID/Secret 齐备才真正启用');
check(redirectUriOf({ req: { url: 'https://nic.test/oauth/github/callback' } }, cfg) === 'https://nic.test/oauth/github/callback', '回调地址按当前站点 origin 生成（强制 https）');
check(redirectUriOf({ req: { url: 'https://a.test/x' } }, { ...cfg, redirectUri: 'https://b.test/oauth/github/callback' }) === 'https://b.test/oauth/github/callback', '后台固定回调地址优先');
check(starRepoUrl('wcvjk8tnz8-create/Noxc') === 'https://github.com/wcvjk8tnz8-create/Noxc', 'Star 仓库链接可拼出');
check(normalizeStarRepo('https://github.com/wcvjk8tnz8-create/Noxc/') === 'wcvjk8tnz8-create/Noxc' && normalizeStarRepo('bad') === '', '仓库格式归一化 + 非法值拒绝');

reset({ ...CONFIG, github_star_repo: 'octo/demo', github_star_bonus: '8' });
cfg = await githubConfig(env);
check(cfg.starRepo === 'octo/demo' && cfg.starBonus === 8, '后台可改奖励仓库与奖励额度');
reset({ ...CONFIG, github_star_bonus: '999' });
check((await githubConfig(env)).starBonus === 100, '奖励额度上限 100 防误填');

reset({}, { GITHUB_CLIENT_ID: 'ENV-ID', GITHUB_CLIENT_SECRET: 'ENV-SECRET', GITHUB_ENABLED: '1' });
cfg = await githubConfig(env);
check(cfg.enabled && cfg.fromEnv && cfg.clientId === 'ENV-ID', 'Worker 环境变量也能启用，后台显示只读');

/* ═════════════════════ 2. 授权码全流程 ═════════════════════ */
reset({ github_client_id: 'GH-CID-1', github_client_secret: 'SEC' });
let r = await call('/api/auth/github/start');
check(r.status === 302 && loc(r).includes('oauth=gh_disabled'), '未启用时 /start 不跳 GitHub，回登录页提示');

reset(CONFIG);
let st = await start();
check(st.res.status === 302 && st.url.origin === 'https://github.com' && st.url.pathname === '/login/oauth/authorize', '/start 跳到 GitHub 官方授权端点');
check(st.url.searchParams.get('client_id') === 'GH-CID-1' && st.url.searchParams.get('scope') === GITHUB_SCOPE, '授权参数 client_id / scope 正确');
check(st.url.searchParams.get('redirect_uri') === 'https://nic.test/oauth/github/callback', '授权请求带上 https 绝对回调地址');
check(!st.url.toString().includes('GH-SECRET-VERY-LONG-1234'), 'Client Secret 绝不出现在浏览器可见的授权 URL 里');
check(!!cookieVal(st.res, 'td_gh_oauth_state') && cookies(st.res).some((x) => /HttpOnly/i.test(x) && /SameSite=Lax/i.test(x)), 'state 写入独立 HttpOnly / SameSite=Lax Cookie');
check(S.oauth_states.length === 1 && S.oauth_states[0].mode === 'login', 'state 同时落 D1，模式为 login');

r = await call('/api/auth/github/start?bind=1');
check(loc(r).includes('oauth=gh_bind_login'), '未登录不能发起绑定');
currentUser = mkUser(7);
r = await call('/api/auth/github/start');
check(loc(r) === '/dashboard', '已登录点登录按钮直接去控制台');
currentUser = null;

reset(CONFIG);
st = await start();
r = await callback(st);
check(r.status === 302 && loc(r) === '/dashboard', '授权码回调成功 → 签发会话并跳控制台');
check(!!cookieVal(r, 'sh_session') && S.sessions.length === 1, '会话 Cookie 与 D1 session 已建立');
check(S.users.length === 1 && S.users[0].email === 'octo@example.com', '自动建号用 GitHub 已验证邮箱');
check(!String(S.users[0].password_hash).startsWith('pbkdf2$'), 'GitHub 账号没有可登录密码');
check(S.oauth_bindings.length === 1 && S.oauth_bindings[0].sub === 'github:1001', '写入 provider+sub 绑定');
check(S.oauth_bindings[0].access_token === 'GH-AT-1', 'access_token 只存服务端（供 Star 校验）');
check(tokenForms.some((f) => f.includes('client_secret=GH-SECRET-VERY-LONG-1234')), 'Secret 只在服务端 token 请求里出现');

r = await callback(st);
check(loc(r).includes('oauth=gh_state_expired'), '同一 state 重放被拒（一次性领取）');
reset(CONFIG); st = await start();
r = await callback(st, 'td_gh_oauth_state=WRONG');
check(loc(r).includes('oauth=gh_state_mismatch'), 'Cookie 与 query 的 state 不一致被拒');
reset(CONFIG); st = await start(); S.oauth_states[0].exp = Date.now() - 1000;
r = await callback(st);
check(loc(r).includes('oauth=gh_state_expired'), '过期 state 被拒');

reset(CONFIG); st = await start();
r = await call(`/oauth/github/callback?error=access_denied&state=${st.state}`, st.cookie);
check(loc(r).includes('oauth=gh_denied'), '用户拒绝授权回登录页提示');
reset(CONFIG); st = await start(); tokenMode = 'fail';
r = await callback(st);
check(loc(r).includes('oauth=gh_token_failed'), '换 token 失败 → 明确报错');

/* /user 的 email 为 null 时回落 /user/emails */
reset(CONFIG); st = await start();
ghUser = { id: 1002, login: 'no-mail', email: null, avatar_url: '' };
ghEmails = [{ email: 'primary@example.com', primary: true, verified: true }];
r = await callback(st);
check(loc(r) === '/dashboard' && S.users[0]?.email === 'primary@example.com', '/user 无邮箱时回落 /user/emails 取 primary+verified');

reset(CONFIG); st = await start();
ghUser = { id: 1003, login: 'unverified', email: null, avatar_url: '' };
ghEmails = [{ email: 'nope@example.com', primary: true, verified: false }];
r = await callback(st);
check(loc(r).includes('oauth=gh_email_required') && S.users.length === 0, '没有已验证邮箱时拒绝建号');
ghUser = { id: 1001, login: 'octocat', email: 'octo@example.com', avatar_url: '' };
ghEmails = [{ email: 'octo@example.com', primary: true, verified: true }];

/* 防接管 / 仅绑定策略 */
reset({ ...CONFIG, github_auto_register: '0' }); st = await start();
r = await callback(st);
check(loc(r).includes('oauth=gh_bind_required') && S.users.length === 0, '「仅绑定」策略不自动建号');
reset(CONFIG);
S.users.push(mkUser(99));
S.users[0].email = 'octo@example.com';
st = await start();
r = await callback(st);
check(S.oauth_bindings.every((b) => b.user_id !== 99) && loc(r).includes('oauth=gh_email_taken'), '邮箱已注册时拒绝建号，绝不认领已有账号（防接管）');

/* 个人资料绑定 */
reset(CONFIG);
S.users.push(mkUser(42));
currentUser = mkUser(42);
st = await start('?bind=1');
check(S.oauth_states[0].mode === 'bind' && S.oauth_states[0].user_id === 42, 'bind 模式把当前用户写进 state');
r = await callback(st);
check(loc(r).includes('/profile?oauth=gh-bound') && S.users.length === 1, '绑定模式只写绑定关系，不建新账号');
check(S.oauth_bindings.length === 1 && S.oauth_bindings[0].user_id === 42, '绑定落到当前登录用户');
check(S.oauth_bindings[0].access_token === 'GH-AT-1', '绑定时保存 access_token 供后续 Star 校验');

reset(CONFIG);
S.oauth_bindings.push({ provider: 'github', sub: 'github:1001', user_id: 999, username: 'other', access_token: 'OLD', created_at: Date.now() });
S.users.push(mkUser(42)); currentUser = mkUser(42);
st = await start('?bind=1');
r = await callback(st);
check(loc(r).includes('oauth=gh_already_bound'), '同一 GitHub 账号不能绑到第二个本地账号');

/* 已绑定账号重新登录：刷新 token 与资料，不重复写绑定 */
reset(CONFIG);
S.oauth_bindings.push({ provider: 'github', sub: 'github:1001', user_id: 55, username: 'oldname', access_token: 'STALE', created_at: Date.now() });
S.users.push(mkUser(55));
st = await start();
r = await callback(st);
check(loc(r) === '/dashboard' && S.oauth_bindings.length === 1, '已绑定账号直接登录，不重复写绑定');
check(S.oauth_bindings[0].access_token === 'GH-AT-1' && S.oauth_bindings[0].username === 'octocat', '重新登录刷新 token 与用户名');

/* ═════════════════════ 3. Star 奖励 ═════════════════════ */
const post = (path: string) => call(path, '', 'POST', {});
async function bindAndClaim(uid: number, quota = 5, role = 'user') {
  S.users.push(mkUser(uid, quota, role));
  currentUser = mkUser(uid, quota, role);
  S.oauth_bindings.push({ provider: 'github', sub: 'github:1001', user_id: uid, username: 'octocat', access_token: 'GH-AT-1', created_at: Date.now() });
  return post('/api/auth/github/claim-star');
}

reset(CONFIG);
r = await post('/api/auth/github/claim-star');
check(r.status === 401, '未登录不能领取 Star 奖励');

reset(CONFIG);
currentUser = mkUser(42); S.users.push(mkUser(42));
r = await post('/api/auth/github/claim-star');
check(r.status === 400 && (await r.json() as any).needBind === true, '未绑定 GitHub 时提示先绑定');

reset(CONFIG);
r = await bindAndClaim(42);
let j: any = await r.json();
check(j.success === true && j.added === 5 && j.quota === 10, '已 Star → 配额 5 → 10（+5）');
check(S.users.find((u) => u.id === 42)?.quota === 10, 'users.quota 真的加上了 5');
check(S.oauth_quota_grants.length === 1 && S.oauth_quota_grants[0].provider === 'github-star' && S.oauth_quota_grants[0].amount === 5, '领取记录用独立 provider，只写一条');

r = await post('/api/auth/github/claim-star');
check(r.status === 409 && (await r.json() as any).alreadyClaimed === true, '重复领取被拒，不叠加');

r = await call('/api/auth/github/status');
j = await r.json();
check(j.linked === true && j.claimed === true && j.quotaBonus === 5 && j.starRepo === DEFAULT_STAR_REPO, '/status 返回绑定与已领奖励状态');
check(j.starUrl === starRepoUrl(DEFAULT_STAR_REPO) && !('access_token' in j), '/status 不下发任何 access_token');

/* 解绑再绑：奖励不回收也不可再领 */
await post('/api/auth/github/unbind');
check(S.oauth_bindings.length === 0, '解绑删除绑定关系');
S.oauth_bindings.push({ provider: 'github', sub: 'github:1001', user_id: 42, username: 'octocat', access_token: 'GH-AT-1', created_at: Date.now() });
r = await post('/api/auth/github/claim-star');
check(r.status === 409 && S.users.find((u) => u.id === 42)?.quota === 10, '解绑重绑仍不能二次领取');

/* 未 Star 时明确拒绝并给出仓库链接 */
reset(CONFIG);
starredStatus = 404;
S.users.push(mkUser(43)); currentUser = mkUser(43);
S.oauth_bindings.push({ provider: 'github', sub: 'github:1001', user_id: 43, username: 'octocat', access_token: 'GH-AT-1', created_at: Date.now() });
r = await post('/api/auth/github/claim-star');
j = await r.json();
check(r.status === 400 && j.starred === false && j.starUrl === starRepoUrl(DEFAULT_STAR_REPO), '没点 Star 时拒绝并回传仓库链接');
check(S.users.find((u) => u.id === 43)?.quota === 5 && S.oauth_quota_grants.length === 0, '未 Star 不加配额、不写领取记录');

/* token 失效 / 缺 token */
reset(CONFIG);
starredStatus = 401;
S.users.push(mkUser(44)); currentUser = mkUser(44);
S.oauth_bindings.push({ provider: 'github', sub: 'github:1001', user_id: 44, username: 'octocat', access_token: 'GH-AT-1', created_at: Date.now() });
r = await post('/api/auth/github/claim-star');
check(r.status === 401 && (await r.json() as any).needRebind === true, 'token 401 时提示重新绑定');
starredStatus = 204;

reset(CONFIG);
S.users.push(mkUser(45)); currentUser = mkUser(45);
S.oauth_bindings.push({ provider: 'github', sub: 'github:1001', user_id: 45, username: 'octocat', created_at: Date.now() });
r = await post('/api/auth/github/claim-star');
check(r.status === 400 && (await r.json() as any).needRebind === true, '老库缺 access_token 列时提示重新绑定');

/* 不限量 / 管理员：不叠加但写入领取记录（防后续叠加） */
reset(CONFIG);
r = await bindAndClaim(46, -1);
check((await r.json() as any).added === 0 && S.users.find((u) => u.id === 46)?.quota === -1, '-1 不限量账号不叠加');
reset(CONFIG);
r = await bindAndClaim(47, 100, 'admin');
check((await r.json() as any).added === 0 && S.users.find((u) => u.id === 47)?.quota === 100, '管理员不叠加');

/* ═════════════════════ 4. 按根域名每人注册次数 ═════════════════════ */
const parsed = parseRootRegLimits('meoy.top:1, noxc.uk:-1, zero.top:0, bad.top:abc');
check(parsed['meoy.top'] === 1 && parsed['noxc.uk'] === -1 && parsed['zero.top'] === 0 && !('bad.top' in parsed), '解析 meoy.top=1 / noxc.uk=-1 / 0 / 非法值过滤');
check(parseRootRegLimits('A.TOP:2')[ 'a.top' ] === 2, '根域名统一小写');
check(serializeRootRegLimits(parsed).includes('meoy.top:1') && serializeRootRegLimits(parsed).includes('noxc.uk:-1'), '序列化可往返');

reset({ root_reg_limits: 'meoy.top:1,noxc.uk:-1' });
check(await rootRegLimitOf(env, 'meoy.top') === 1, 'settings 配置：meoy.top 每人一次');
check(await rootRegLimitOf(env, 'noxc.uk') === -1, 'settings 配置：noxc.uk 每人无限');
check(await rootRegLimitOf(env, 'other.top') === null, '未配置的后缀不限制');
reset({}, { ROOT_REG_LIMITS: 'meoy.top:1' });
check(await rootRegLimitOf(env, 'meoy.top') === 1, 'settings 为空时回落环境变量');

reset();
check(await userRootRegCount(env.DB, 1, 'meoy.top') === 0, '新用户累计次数为 0');
await bumpRootRegCount(env.DB, 1, 'meoy.top', Date.now());
await bumpRootRegCount(env.DB, 1, 'meoy.top', Date.now());
check(await userRootRegCount(env.DB, 1, 'meoy.top') === 2, 'bump 累加成功申请次数');
/* 模拟「释放域名」：删除 subdomains 行，累计次数不退还 */
S.subdomains.push({ id: 1, user_id: 1, root_domain: 'meoy.top', fqdn: 'x.meoy.top', status: 'approved' });
S.subdomains = S.subdomains.filter((x) => x.id !== 1);
check(await userRootRegCount(env.DB, 1, 'meoy.top') === 2, '释放域名不退还累计次数');
await bumpRootRegCount(env.DB, 2, 'meoy.top', Date.now());
check(await userRootRegCount(env.DB, 2, 'meoy.top') === 1 && await userRootRegCount(env.DB, 1, 'meoy.top') === 2, '计数按用户隔离');

/* ── 真实跑 subdomains 申请接口 ── */
const APPLY = {
  captcha_enabled: '0', root_reg_limits: 'meoy.top:1,noxc.uk:-1',
  domain_cost: '0', initial_points: '10', ai_review_enabled: '0',
};
async function applyAs(uid: number, label: string, root: string, role = 'user') {
  currentUser = mkUser(uid, 20, role);
  if (!S.users.some((u) => u.id === uid)) S.users.push(mkUser(uid, 20, role));
  return call('/api/subdomains', '', 'POST', { label, root });
}
async function applyJson(res: Response) {
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

reset(APPLY);
currentUser = mkUser(1, 20); S.users.push(mkUser(1, 20));
let a = await applyJson(await applyAs(1, 'abc', 'meoy.top'));
check(a.status === 200 && a.body.success === true, 'meoy.top 第一次申请成功');
check(S.root_reg_counts[0]?.count === 1, '首次成功申请写入累计次数');
a = await applyJson(await applyAs(1, 'def', 'meoy.top'));
check(a.status === 403 && a.body.rootRegLimited === true && a.body.limit === 1 && a.body.used === 1, 'meoy.top 第二次申请被拦（每人一次）');
check(!S.subdomains.some((x) => x.fqdn === 'def.meoy.top'), '被拦时没有写入域名记录');

a = await applyJson(await applyAs(1, 'ghi', 'noxc.uk'));
check(a.status === 200 && a.body.success === true, 'noxc.uk=-1 第一次申请成功');
a = await applyJson(await applyAs(1, 'jkl', 'noxc.uk'));
check(a.status === 200 && a.body.success === true, 'noxc.uk=-1 第二次申请仍成功（无限次）');

/* 释放 meoy.top 的域名后仍不能再次申请 */
S.subdomains = S.subdomains.filter((x) => x.root_domain !== 'meoy.top');
a = await applyJson(await applyAs(1, 'mno', 'meoy.top'));
check(a.status === 403, '释放域名后累计次数不退还，仍被拦');

/* 已注册用户不受影响：历史域名在设置生效前就存在，计数表为空 */
reset(APPLY);
S.subdomains.push({ id: 99, user_id: 2, root_domain: 'meoy.top', fqdn: 'legacy.meoy.top', status: 'approved', created_at: 1 });
currentUser = mkUser(2, 20); S.users.push(mkUser(2, 20));
a = await applyJson(await applyAs(2, 'pqr', 'meoy.top'));
check(a.status === 200 && a.body.success === true, '历史已注册用户仍可申请一次（不回溯历史记录）');
check(S.subdomains.some((x) => x.fqdn === 'legacy.meoy.top'), '历史域名原封不动，未被删除或停用');
a = await applyJson(await applyAs(2, 'stu', 'meoy.top'));
check(a.status === 403, '历史用户用掉新的一次后同样受限');

/* 管理员开通不受限也不计数 */
reset(APPLY);
currentUser = mkUser(3, -1, 'admin'); S.users.push(mkUser(3, -1, 'admin'));
a = await applyJson(await applyAs(3, 'adm1', 'meoy.top', 'admin'));
a = await applyJson(await applyAs(3, 'adm2', 'meoy.top', 'admin'));
check(a.status === 200 && S.root_reg_counts.length === 0, '管理员是「开通」不是申请，不受限也不计数');

/* 未配置任何限制时完全放行 */
reset({ ...APPLY, root_reg_limits: '' });
currentUser = mkUser(4, 20); S.users.push(mkUser(4, 20));
a = await applyJson(await applyAs(4, 'vwx', 'meoy.top'));
a = await applyJson(await applyAs(4, 'yz1', 'meoy.top'));
check(a.status === 200 && a.body.success === true, '留空 = 不限制，行为与旧版一致');

/* ═════════════════════════ 结果 ═════════════════════════ */
for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`GitHub OAuth / Star / 根域名次数回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
