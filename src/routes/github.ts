/**
 * GitHub OAuth 2.0 授权码登录 / 绑定 + Star 配额奖励
 *
 * 流程：
 *   /start              生成一次性 state（D1 + 独立 HttpOnly Cookie），跳 GitHub 授权页
 *   /callback           校验 state → 换 access_token → 拉 /user（+ /user/emails）
 *                       → 绑定 / 建号 → 签发会话；绑定时把 access_token 存服务端
 *   /status             个人资料页用：绑定状态、Star 仓库、是否已领奖励
 *   /claim-star         校验当前用户确实给指定仓库点了 Star → 一次性 +5 配额
 *   /unbind             解除绑定（已领取的奖励不回收、也不可再领）
 *
 * 安全要点：
 *  - state 一次性、10 分钟过期，Cookie 与 D1 双重校验
 *  - Client Secret 与 access_token 只在 Worker 侧使用，绝不下发 /api/config / 前端
 *  - 不信任 GitHub 邮箱去「认领」已有账号（防接管），只有本人发起 bind 才写绑定
 *  - 每个本地账号只能领一次 Star 奖励（oauth_quota_grants 唯一键）
 */
import { Hono } from 'hono';
import { randomToken } from '../lib/crypto.js';
import { createSession, setSessionCookie } from '../middleware/auth.js';
import { ok, fail, now, audit, clientIp, defaultQuotaOf } from '../lib/util.js';
import {
  GITHUB_PROVIDER, GITHUB_STAR_PROVIDER, GITHUB_AUTHORIZE, GITHUB_TOKEN,
  GITHUB_API_USER, GITHUB_API_EMAILS,
  GITHUB_STATE_TTL_MS, GITHUB_STATE_COOKIE, QUOTA_CAP,
  githubConfig, redirectUriOf, starRepoUrl, checkStarred,
} from '../lib/github.js';
import { ensureOauthTables } from '../lib/oauthStore.js';
import { notifyLoginIp } from '../lib/notify.js';
import { blockedEmailDomain } from '../lib/emailRule.js';

const app = new Hono();
const UA = 'Noxc-Subdomain-Hub';

function setCookie(c: any, value: string, maxAge: number) {
  const secure = new URL(c.req.url).protocol === 'https:' ? 'Secure; ' : '';
  c.header('Set-Cookie',
    `${GITHUB_STATE_COOKIE}=${encodeURIComponent(value)}; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=${maxAge}`,
    { append: true });
}
function clearCookie(c: any) {
  const secure = new URL(c.req.url).protocol === 'https:' ? 'Secure; ' : '';
  c.header('Set-Cookie', `${GITHUB_STATE_COOKIE}=; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=0`, { append: true });
}
function cookieState(c: any): string {
  const raw = String(c.req.header('cookie') || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === GITHUB_STATE_COOKIE) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}
/** 错误码加 gh_ 前缀，登录页据此给 GitHub 专属文案，不与 NodeLoc 串味 */
function back(c: any, code: string) {
  clearCookie(c);
  return c.redirect(`/login?oauth=gh_${encodeURIComponent(code)}`, 302);
}

async function consumeState(c: any, state: string): Promise<any | null> {
  const db = c.env.DB;
  try {
    const res: any = await db.prepare(
      'DELETE FROM oauth_states WHERE state = ? AND exp >= ? RETURNING mode, user_id'
    ).bind(state, now()).all();
    return res?.results?.[0] || null;
  } catch {
    try {
      const row: any = await db.prepare('SELECT mode, user_id, exp FROM oauth_states WHERE state = ?').bind(state).first();
      await db.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
      if (!row || Number(row.exp) < now()) return null;
      return { mode: row.mode, user_id: row.user_id };
    } catch { return null; }
  }
}

/** GitHub 令牌交换：必须带 Accept: application/json 才返回 JSON */
async function exchangeToken(cfg: any, code: string, redirectUri: string): Promise<string> {
  const form = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const r = await fetch(GITHUB_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': UA,
    },
    body: form.toString(),
  });
  if (!r.ok) return '';
  const j: any = await r.json().catch(() => null);
  if (!j || j.error) return '';
  return String(j.access_token || '').trim();
}

async function ghGet(url: string, token: string): Promise<{ status: number; body: any }> {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
    },
  });
  if (r.status === 204 || r.status === 404) return { status: r.status, body: null };
  const body: any = await r.json().catch(() => null);
  return { status: r.status, body };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** GitHub /user 的 email 常为 null，回落 /user/emails 取 primary + verified */
async function fetchGithubUser(token: string): Promise<any | null> {
  const u = await ghGet(GITHUB_API_USER, token);
  if (u.status !== 200 || !u.body || typeof u.body !== 'object') return null;
  const j = u.body;
  const id = Number(j.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  let email = String(j.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    const e = await ghGet(GITHUB_API_EMAILS, token);
    const list: any[] = Array.isArray(e.body) ? e.body : [];
    // 只认已验证邮箱：未验证地址不能拿来建号（防冒用他人邮箱 / 防乱建号）
    const pick = list.find((x: any) => x?.primary && x?.verified)
      || list.find((x: any) => x?.verified);
    email = String(pick?.email || '').trim().toLowerCase();
  }
  if (!EMAIL_RE.test(email)) return { __noEmail: true };
  return {
    sub: `${GITHUB_PROVIDER}:${id}`,
    email,
    username: String(j.login || j.name || '').trim().slice(0, 80),
    avatar: String(j.avatar_url || '').trim().slice(0, 500),
  };
}

/** 写绑定时顺带存 access_token（Star 校验要用）。老库缺列时降级为不存 token */
async function insertBinding(db: any, info: any, uid: number, token: string): Promise<void> {
  try {
    await db.prepare(
      'INSERT INTO oauth_bindings (provider, sub, user_id, username, avatar_url, access_token, created_at) VALUES (?,?,?,?,?,?,?)'
    ).bind(GITHUB_PROVIDER, info.sub, uid, info.username, info.avatar, token, now()).run();
  } catch (e: any) {
    if (/UNIQUE|constraint/i.test(String(e?.message || ''))) throw e;
    await db.prepare(
      'INSERT INTO oauth_bindings (provider, sub, user_id, username, avatar_url, created_at) VALUES (?,?,?,?,?,?)'
    ).bind(GITHUB_PROVIDER, info.sub, uid, info.username, info.avatar, now()).run();
  }
}

/** 已绑定账号重新登录时刷新资料与 token，避免旧 token 失效后 Star 领不了 */
async function refreshBinding(db: any, uid: number, info: any, token: string): Promise<void> {
  try {
    await db.prepare(
      'UPDATE oauth_bindings SET username = ?, avatar_url = ?, access_token = ? WHERE provider = ? AND user_id = ?'
    ).bind(info.username, info.avatar, token, GITHUB_PROVIDER, uid).run();
  } catch { /* 老库缺列：不影响登录 */ }
}

async function maxPerIp(env: any): Promise<number> {
  try {
    const row: any = await env.DB.prepare("SELECT value FROM settings WHERE key = 'max_accounts_per_ip'").first();
    const n = Number(row?.value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
  } catch { return 2; }
}

async function createOauthUser(c: any, info: any): Promise<number> {
  const env = c.env;
  const ip = clientIp(c);
  if (ip) {
    const banned: any = await env.DB.prepare('SELECT reason FROM ip_bans WHERE ip = ?').bind(ip).first();
    if (banned) throw new Error('ip_banned');
    const limit = await maxPerIp(env);
    const cnt: any = await env.DB.prepare('SELECT COUNT(*) AS n FROM registrations WHERE ip = ?').bind(ip).first();
    if ((cnt?.n || 0) >= limit) throw new Error('ip_limit');
  }
  const mail = String(info.email || '').trim().toLowerCase();
  if (!mail || blockedEmailDomain(mail)) throw new Error('email_blocked');
  const exist: any = await env.DB.prepare('SELECT id, status FROM users WHERE email = ?').bind(mail).first();
  if (exist) throw new Error('email_taken');
  const quota = await defaultQuotaOf(env);
  const res: any = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, role, status, quota, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(mail, `oauth:disabled:${randomToken(16)}`, 'user', 'active', quota, now()).run();
  const userId = Number(res.meta?.last_row_id);
  await env.DB.prepare(
    'INSERT INTO registrations (user_id, ip, ua, agreed_terms, created_at) VALUES (?,?,?,?,?)'
  ).bind(userId, ip, (c.req.header('user-agent') || '').slice(0, 300), 1, now()).run();
  await audit(c, userId, 'user.github_register', mail, `GitHub sub=${info.sub} quota=${quota}`);
  return userId;
}

async function signIn(c: any, userId: number, label: string) {
  const user: any = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  if (!user) throw new Error('no_user');
  if (user.status === 'banned') throw new Error('banned');
  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), userId).run();
  const { token, maxAge } = await createSession(c, userId, true);
  setSessionCookie(c, token, maxAge);
  await audit(c, userId, 'user.github_login', user.email, label);
  const ip = clientIp(c);
  if (ip) {
    try { c.executionCtx?.waitUntil?.(notifyLoginIp(c.env, userId, user.email, ip)); } catch { /* 通知失败不影响登录 */ }
  }
}

/** GET /start —— 发起授权（?bind=1 表示在个人资料里绑定到当前账号） */
app.get('/start', async (c) => {
  const cfg = await githubConfig(c.env);
  if (!cfg.enabled) return back(c, 'disabled');
  const bind = c.req.query('bind') === '1';
  const u = c.get('user');
  if (bind && !u) return c.redirect('/login?oauth=gh_bind_login', 302);
  if (!bind && u) return c.redirect('/dashboard', 302);
  await ensureOauthTables(c.env);

  const state = randomToken(24);
  try {
    await c.env.DB.prepare(
      'INSERT INTO oauth_states (state, mode, user_id, exp, created_at) VALUES (?,?,?,?,?)'
    ).bind(state, bind ? 'bind' : 'login', bind ? Number(u.id) : null, now() + GITHUB_STATE_TTL_MS, now()).run();
  } catch { return back(c, 'state_failed'); }
  setCookie(c, state, Math.floor(GITHUB_STATE_TTL_MS / 1000));

  const url = new URL(GITHUB_AUTHORIZE);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', redirectUriOf(c, cfg));
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return c.redirect(url.toString(), 302);
});

/** GET /callback —— GitHub 授权后回调 */
app.get('/callback', async (c) => {
  const err = String(c.req.query('error') || '').trim();
  if (err) return back(c, err === 'access_denied' ? 'denied' : 'provider_error');
  const code = String(c.req.query('code') || '').trim();
  const state = String(c.req.query('state') || '').trim();
  if (!code || !state || state.length > 200) return back(c, 'bad_request');
  if (state !== cookieState(c)) return back(c, 'state_mismatch');

  const cfg = await githubConfig(c.env);
  if (!cfg.enabled) return back(c, 'disabled');
  const st = await consumeState(c, state);
  if (!st) return back(c, 'state_expired');
  await ensureOauthTables(c.env);

  let token = '';
  try { token = await exchangeToken(cfg, code, redirectUriOf(c, cfg)); } catch { /* 网络异常统一按失败 */ }
  if (!token) return back(c, 'token_failed');
  let info: any = null;
  try { info = await fetchGithubUser(token); } catch { /* 同上 */ }
  if (!info) return back(c, 'userinfo_failed');
  if (info.__noEmail) return back(c, 'email_required');

  const db = c.env.DB;
  const binding: any = await db.prepare(
    'SELECT user_id FROM oauth_bindings WHERE provider = ? AND sub = ?'
  ).bind(GITHUB_PROVIDER, info.sub).first();

  if (binding) {
    if (st.mode === 'bind' && Number(binding.user_id) !== Number(st.user_id)) return back(c, 'already_bound');
    await refreshBinding(db, Number(binding.user_id), info, token);
    try { await signIn(c, Number(binding.user_id), `GitHub ${info.username || info.sub}`); }
    catch (e: any) { return back(c, e?.message === 'banned' ? 'banned' : 'signin_failed'); }
    clearCookie(c);
    return c.redirect('/dashboard', 302);
  }

  if (st.mode === 'bind') {
    const uid = Number(st.user_id);
    if (!uid) return back(c, 'bind_login');
    try {
      await insertBinding(db, info, uid, token);
      await audit(c, uid, 'user.github_bind', '', `GitHub sub=${info.sub} login=${info.username}`);
    } catch { return back(c, 'already_bound'); }
    clearCookie(c);
    return c.redirect('/profile?oauth=gh-bound', 302);
  }

  if (!cfg.autoRegister) return back(c, 'bind_required');
  let userId = 0;
  try { userId = await createOauthUser(c, info); }
  catch (e: any) {
    const m = String(e?.message || '');
    return back(c, ['ip_banned', 'ip_limit', 'banned', 'email_taken', 'email_blocked'].includes(m) ? m : 'register_failed');
  }
  try {
    await insertBinding(db, info, userId, token);
    await signIn(c, userId, `GitHub ${info.username}（首次）`);
  } catch { return back(c, 'signin_failed'); }
  clearCookie(c);
  return c.redirect('/dashboard', 302);
});

/** 登录态：个人资料页用的绑定状态（绝不下发 access_token） */
app.get('/status', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const cfg = await githubConfig(c.env);
  const row: any = await c.env.DB.prepare(
    'SELECT username, created_at, access_token FROM oauth_bindings WHERE provider = ? AND user_id = ?'
  ).bind(GITHUB_PROVIDER, u.id).first().catch(() => null);
  const grant: any = await c.env.DB.prepare(
    'SELECT amount FROM oauth_quota_grants WHERE provider = ? AND user_id = ?'
  ).bind(GITHUB_STAR_PROVIDER, u.id).first().catch(() => null);
  return ok(c, {
    enabled: cfg.enabled,
    linked: !!row,
    username: String(row?.username || ''),
    linkedAt: Number(row?.created_at || 0),
    tokenStored: !!String(row?.access_token || '').trim(),
    starRepo: cfg.starRepo,
    starUrl: starRepoUrl(cfg.starRepo),
    starBonus: cfg.starBonus,
    claimed: !!grant,
    quotaBonus: Number(grant?.amount || 0),
  });
});

/** 登录态：一次性 Star 配额奖励。真实请求 GitHub 校验，不信任前端任何标志位 */
app.post('/claim-star', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const cfg = await githubConfig(c.env);
  if (!cfg.enabled) return fail(c, '站点尚未启用 GitHub 登录', 403);
  await ensureOauthTables(c.env);
  const db = c.env.DB;

  const claimed: any = await db.prepare(
    'SELECT amount FROM oauth_quota_grants WHERE provider = ? AND user_id = ?'
  ).bind(GITHUB_STAR_PROVIDER, u.id).first().catch(() => null);
  if (claimed) return fail(c, '每个账号只能领取一次 Star 奖励', 409, { alreadyClaimed: true });

  const row: any = await db.prepare(
    'SELECT username, access_token FROM oauth_bindings WHERE provider = ? AND user_id = ?'
  ).bind(GITHUB_PROVIDER, u.id).first().catch(() => null);
  if (!row) return fail(c, '请先在个人资料里绑定 GitHub 账号', 400, { needBind: true });
  const token = String(row.access_token || '').trim();
  if (!token) return fail(c, '绑定信息缺少访问令牌，请解除绑定后重新绑定一次', 400, { needRebind: true });

  // 每次领取都实时向 GitHub 复核，不缓存判定；0 = 网络异常
  const status = await checkStarred(token, cfg.starRepo);
  if (status === 0) return fail(c, '无法连接 GitHub，请稍后重试', 502);
  if (status === 401) return fail(c, 'GitHub 授权已失效，请解除绑定后重新绑定一次', 401, { needRebind: true });
  if (status !== 204) {
    return fail(c, '还没有检测到 Star，请先给项目点 Star 再回来领取。', 400,
      { starred: false, starRepo: cfg.starRepo, starUrl: starRepoUrl(cfg.starRepo) });
  }

  let got = false;
  try {
    const ins: any = await db.prepare(
      'INSERT OR IGNORE INTO oauth_quota_grants (provider, user_id, email, amount, created_at) VALUES (?,?,?,?,?)'
    ).bind(GITHUB_STAR_PROVIDER, u.id, String(row.username || ''), 0, now()).run();
    got = Number(ins?.meta?.changes || 0) > 0;
  } catch { return fail(c, '领取记录写入失败，请稍后重试', 500); }
  if (!got) return fail(c, '每个账号只能领取一次 Star 奖励', 409, { alreadyClaimed: true });

  let added = 0;
  let after = 0;
  try {
    const cur: any = await db.prepare('SELECT id, role, quota FROM users WHERE id = ?').bind(u.id).first();
    after = Number(cur?.quota ?? 0);
    if (cur && String(cur.role) !== 'admin' && Number(cur.quota) >= 0) {
      const before = Number(cur.quota);
      after = Math.min(QUOTA_CAP, before + cfg.starBonus);
      added = after - before;
      if (added > 0) await db.prepare('UPDATE users SET quota = ? WHERE id = ?').bind(after, u.id).run();
    }
    await db.prepare('UPDATE oauth_quota_grants SET amount = ? WHERE provider = ? AND user_id = ?')
      .bind(added, GITHUB_STAR_PROVIDER, u.id).run();
    await audit(c, u.id, 'user.github_star_quota', cfg.starRepo,
      `Star 奖励配额 +${added}（${cfg.starBonus} 配置值）`);
  } catch { return fail(c, '配额写入失败，请稍后重试', 500); }

  return ok(c, {
    claimed: true, starred: true, added, quota: after,
    starRepo: cfg.starRepo,
    message: added > 0 ? '已领取 Star 奖励' : '当前账号配额不限，无需叠加奖励',
  });
});

/** 登录态：解除绑定（已领取的 Star 奖励不回收、也不可再领） */
app.post('/unbind', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  await c.env.DB.prepare('DELETE FROM oauth_bindings WHERE provider = ? AND user_id = ?')
    .bind(GITHUB_PROVIDER, u.id).run();
  await audit(c, u.id, 'user.github_unbind', '', 'GitHub');
  return ok(c, {});
});

export default app;
