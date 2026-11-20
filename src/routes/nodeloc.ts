/**
 * NodeLoc OAuth 2.0 授权码登录 / 绑定
 *
 * 流程：
 *   /start    生成一次性 state（D1 + HttpOnly Cookie），跳到 NodeLoc 授权页
 *   /callback 校验 state → 换 access_token → 拉 userinfo → 绑定/建号 → 签发会话
 *
 * 安全要点：
 *  - state 一次性、10 分钟过期，Cookie 与 D1 双重校验，挡 CSRF 与重放
 *  - client_secret 只在 Worker 侧使用，绝不下发浏览器
 *  - 不信任 userinfo 里的邮箱去「认领」已有账号（防账号接管），
 *    只有当前登录用户本人主动发起 bind 才写绑定
 *  - OAuth 自动建号的账号没有可登录密码（password_hash 非 pbkdf2 格式）
 */
import { Hono } from 'hono';
import { randomToken } from '../lib/crypto.js';
import { createSession, setSessionCookie } from '../middleware/auth.js';
import { ok, fail, now, audit, clientIp, defaultQuotaOf } from '../lib/util.js';
import {
  NODELOC_PROVIDER, NODELOC_AUTHORIZE, NODELOC_TOKEN, NODELOC_USERINFO,
  NODELOC_STATE_TTL_MS, NODELOC_STATE_COOKIE,
  nodelocConfig, redirectUriOf,
} from '../lib/nodeloc.js';
import { notifyLoginIp } from '../lib/notify.js';

const app = new Hono();

function setCookie(c: any, value: string, maxAge: number) {
  const secure = new URL(c.req.url).protocol === 'https:' ? 'Secure; ' : '';
  c.header(
    'Set-Cookie',
    `${NODELOC_STATE_COOKIE}=${encodeURIComponent(value)}; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=${maxAge}`,
    { append: true }
  );
}

function clearCookie(c: any) {
  const secure = new URL(c.req.url).protocol === 'https:' ? 'Secure; ' : '';
  c.header('Set-Cookie', `${NODELOC_STATE_COOKIE}=; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=0`, { append: true });
}

function cookieState(c: any): string {
  const raw = String(c.req.header('cookie') || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === NODELOC_STATE_COOKIE) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

/** 回到登录页，带一个不含任何敏感信息的错误码；前端负责双语提示 */
function back(c: any, code: string) {
  clearCookie(c);
  return c.redirect(`/login?oauth=${encodeURIComponent(code)}`, 302);
}

/** 原子领取 state；D1 不支持 RETURNING 时降级到 SELECT + DELETE */
async function consumeState(c: any, state: string): Promise<any | null> {
  const db = c.env.DB;
  try {
    const res: any = await db.prepare(
      'DELETE FROM oauth_states WHERE state = ? AND exp >= ? RETURNING mode, user_id'
    ).bind(state, now()).all();
    return res?.results?.[0] || null;
  } catch {
    try {
      const row: any = await db.prepare(
        'SELECT mode, user_id, exp FROM oauth_states WHERE state = ?'
      ).bind(state).first();
      await db.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
      if (!row || Number(row.exp) < now()) return null;
      return { mode: row.mode, user_id: row.user_id };
    } catch { return null; }
  }
}

async function exchangeToken(cfg: any, code: string, redirectUri: string): Promise<string> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  let r = await fetch(NODELOC_TOKEN, { method: 'POST', headers, body: form.toString() });
  if (!r.ok) {
    // 部分 OIDC Provider 只接受 Basic 认证；换一种再试一次
    const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`);
    const bodyOnly = new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    });
    r = await fetch(NODELOC_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Authorization: `Basic ${basic}` },
      body: bodyOnly.toString(),
    });
  }
  if (!r.ok) return '';
  const j: any = await r.json().catch(() => null);
  return String(j?.access_token || '').trim();
}

async function fetchUserinfo(token: string): Promise<any | null> {
  const r = await fetch(NODELOC_USERINFO, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const info: any = await r.json().catch(() => null);
  const sub = String(info?.sub ?? info?.id ?? '').trim();
  if (!sub || sub.length > 200) return null;
  return {
    sub,
    username: String(info?.preferred_username ?? info?.username ?? info?.name ?? '').trim().slice(0, 80),
    avatar: String(info?.avatar_url ?? info?.picture ?? info?.avatar ?? '').trim().slice(0, 500),
    email: String(info?.email ?? '').trim().toLowerCase().slice(0, 160),
  };
}

/** 给 OAuth 用户生成一个稳定、唯一、不含特殊字符的内部邮箱 */
async function pseudoEmail(sub: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nodeloc:${sub}`));
  const hex = [...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `nl.${hex}@oauth.local`;
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
  const mail = await pseudoEmail(info.sub);
  // 同一 sub 理论上只会建一次；极端并发下若已存在则直接复用
  const exist: any = await env.DB.prepare('SELECT id, status FROM users WHERE email = ?').bind(mail).first();
  if (exist) {
    if (exist.status === 'banned') throw new Error('banned');
    return Number(exist.id);
  }
  const quota = await defaultQuotaOf(env);
  // 不可登录密码：verifyPassword 遇到非 pbkdf2 格式直接返回 false
  const passwordHash = `oauth:disabled:${randomToken(16)}`;
  const res: any = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, role, status, quota, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(mail, passwordHash, 'user', 'active', quota, now()).run();
  const userId = Number(res.meta?.last_row_id);
  await env.DB.prepare(
    'INSERT INTO registrations (user_id, ip, ua, agreed_terms, created_at) VALUES (?,?,?,?,?)'
  ).bind(userId, ip, (c.req.header('user-agent') || '').slice(0, 300), 1, now()).run();
  await audit(c, userId, 'user.oauth_register', mail, `NodeLoc sub=${info.sub} quota=${quota}`);
  return userId;
}

async function signIn(c: any, userId: number, label: string) {
  const user: any = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  if (!user) throw new Error('no_user');
  if (user.status === 'banned') throw new Error('banned');
  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), userId).run();
  const { token, maxAge } = await createSession(c, userId, true);
  setSessionCookie(c, token, maxAge);
  await audit(c, userId, 'user.oauth_login', user.email, label);
  const ip = clientIp(c);
  if (ip) {
    try { c.executionCtx?.waitUntil?.(notifyLoginIp(c.env, userId, user.email, ip)); } catch { /* 通知失败不影响登录 */ }
  }
}

/** GET /start —— 发起授权（?bind=1 表示把 NodeLoc 绑定到当前账号） */
app.get('/start', async (c) => {
  const cfg = await nodelocConfig(c.env);
  if (!cfg.enabled) return back(c, 'disabled');
  const bind = c.req.query('bind') === '1';
  const u = c.get('user');
  if (bind && !u) return c.redirect('/login?oauth=bind_login', 302);
  if (!bind && u) return c.redirect('/dashboard', 302);

  const state = randomToken(24);
  try {
    await c.env.DB.prepare(
      'INSERT INTO oauth_states (state, mode, user_id, exp, created_at) VALUES (?,?,?,?,?)'
    ).bind(state, bind ? 'bind' : 'login', bind ? Number(u.id) : null, now() + NODELOC_STATE_TTL_MS, now()).run();
  } catch {
    return back(c, 'state_failed');
  }
  setCookie(c, state, Math.floor(NODELOC_STATE_TTL_MS / 1000));

  const url = new URL(NODELOC_AUTHORIZE);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', redirectUriOf(c, cfg));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', state);
  return c.redirect(url.toString(), 302);
});

/** GET /callback —— NodeLoc 授权后回调 */
app.get('/callback', async (c) => {
  const err = String(c.req.query('error') || '').trim();
  if (err) return back(c, err === 'access_denied' ? 'denied' : 'provider_error');
  const code = String(c.req.query('code') || '').trim();
  const state = String(c.req.query('state') || '').trim();
  if (!code || !state || state.length > 200) return back(c, 'bad_request');
  if (state !== cookieState(c)) return back(c, 'state_mismatch');

  const cfg = await nodelocConfig(c.env);
  if (!cfg.enabled) return back(c, 'disabled');
  const st = await consumeState(c, state);
  if (!st) return back(c, 'state_expired');

  const redirectUri = redirectUriOf(c, cfg);
  let token = '';
  try { token = await exchangeToken(cfg, code, redirectUri); } catch { /* 网络异常统一按失败处理 */ }
  if (!token) return back(c, 'token_failed');
  let info: any = null;
  try { info = await fetchUserinfo(token); } catch { /* 同上 */ }
  if (!info) return back(c, 'userinfo_failed');

  const db = c.env.DB;
  const binding: any = await db.prepare(
    'SELECT user_id FROM oauth_bindings WHERE provider = ? AND sub = ?'
  ).bind(NODELOC_PROVIDER, info.sub).first();

  if (binding) {
    // 已绑定：直接登录；若本次是 bind 模式且绑的是别人，明确报错
    if (st.mode === 'bind' && Number(binding.user_id) !== Number(st.user_id)) return back(c, 'already_bound');
    try { await signIn(c, Number(binding.user_id), `NodeLoc ${info.username || info.sub}`); }
    catch (e: any) { return back(c, e?.message === 'banned' ? 'banned' : 'signin_failed'); }
    clearCookie(c);
    return c.redirect('/dashboard', 302);
  }

  if (st.mode === 'bind') {
    const uid = Number(st.user_id);
    if (!uid) return back(c, 'bind_login');
    try {
      await db.prepare(
        'INSERT INTO oauth_bindings (provider, sub, user_id, username, avatar_url, created_at) VALUES (?,?,?,?,?,?)'
      ).bind(NODELOC_PROVIDER, info.sub, uid, info.username, info.avatar, now()).run();
      await audit(c, uid, 'user.oauth_bind', '', `NodeLoc sub=${info.sub}`);
    } catch { return back(c, 'already_bound'); }
    clearCookie(c);
    return c.redirect('/profile?oauth=bound', 302);
  }

  // 首次登录：自动建号，或按后台策略要求先绑定已有账号
  if (!cfg.autoRegister) return back(c, 'bind_required');
  let userId = 0;
  try { userId = await createOauthUser(c, info); }
  catch (e: any) {
    const m = String(e?.message || '');
    return back(c, ['ip_banned', 'ip_limit', 'banned'].includes(m) ? m : 'register_failed');
  }
  try {
    await db.prepare(
      'INSERT INTO oauth_bindings (provider, sub, user_id, username, avatar_url, created_at) VALUES (?,?,?,?,?,?)'
    ).bind(NODELOC_PROVIDER, info.sub, userId, info.username, info.avatar, now()).run();
    await signIn(c, userId, `NodeLoc ${info.username || info.sub}（首次）`);
  } catch {
    return back(c, 'signin_failed');
  }
  clearCookie(c);
  return c.redirect('/dashboard', 302);
});

/** 登录态：查询当前账号的 NodeLoc 绑定状态（个人资料页用） */
app.get('/status', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const row: any = await c.env.DB.prepare(
    'SELECT username, created_at FROM oauth_bindings WHERE provider = ? AND user_id = ?'
  ).bind(NODELOC_PROVIDER, u.id).first();
  return ok(c, { linked: !!row, username: String(row?.username || ''), linkedAt: Number(row?.created_at || 0) });
});

/** 登录态：解除绑定（不影响账号本身与其它登录方式） */
app.post('/unbind', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  await c.env.DB.prepare(
    'DELETE FROM oauth_bindings WHERE provider = ? AND user_id = ?'
  ).bind(NODELOC_PROVIDER, u.id).run();
  await audit(c, u.id, 'user.oauth_unbind', '', 'NodeLoc');
  return ok(c, {});
});

export default app;
