/**
 * 按根域名「每人注册次数」专项回归（CI 步骤：注册次数回归）
 *
 * 真跑 Hono 的 /api/subdomains 申请接口 + 内存 D1，覆盖：
 *   meoy.top=1 / noxc.uk=-1、释放域名不退还次数、历史已注册用户不受影响、
 *   管理员开通不受限、留空不限制。
 *
 * 运行：npx tsx scripts/root-limit-regression.ts
 */
import { Hono } from 'hono';
import subdomainRoutes from '../src/routes/subdomains.js';
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


/* ───────── mock 外部请求：AI 审核失败即降级，不卡申请 ───────── */
(globalThis as any).fetch = async () => { throw new Error('network disabled in regression'); };

/* ───────────────────────── 被测应用 ───────────────────────── */
let currentUser: any = null;
const app = new Hono();
app.use('*', async (c, next) => { c.set('user', currentUser); await next(); });
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
const mkUser = (id: number, quota = 5, role = 'user') => ({
  id, email: `u${id}@example.com`, password_hash: 'pbkdf2$x', role, status: 'active',
  quota, created_at: Date.now(), last_login_at: null,
});

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

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`按根域名每人注册次数回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
