/**
 * NodeLoc OAuth 2.0 / OIDC 授权码接入 · 端点与配置
 *
 * 官方对接文档（应用管理页需 TL2 及以上）：
 *   https://www.nodeloc.com/oauth-provider/applications
 *   authorize : https://www.nodeloc.com/oauth-provider/authorize
 *   token     : https://www.nodeloc.com/oauth-provider/token
 *   userinfo  : https://www.nodeloc.com/oauth-provider/userInfo
 *
 * scope 只用 openid profile；email 需要 NodeLoc 管理员审核应用后才能用，
 * 所以做成后台可选项，默认不申请。
 *
 * 配置优先级：后台「站点设置」 > Worker 环境变量 > 关闭。
 * Client Secret 只在服务端使用，绝不下发到 /api/config 或前端。
 */

export const NODELOC_PROVIDER = 'nodeloc';
export const NODELOC_AUTHORIZE = 'https://www.nodeloc.com/oauth-provider/authorize';
export const NODELOC_TOKEN = 'https://www.nodeloc.com/oauth-provider/token';
export const NODELOC_USERINFO = 'https://www.nodeloc.com/oauth-provider/userInfo';
export const NODELOC_CALLBACK_PATH = '/oauth/nodeloc/callback';
export const NODELOC_STATE_TTL_MS = 10 * 60 * 1000;
export const NODELOC_STATE_COOKIE = 'td_oauth_state';

async function setting(env: any, key: string): Promise<string | undefined> {
  try {
    const row: any = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    return row ? String(row.value ?? '') : undefined;
  } catch {
    // settings 表尚未建立（首次部署前）或 D1 抖动：降级到环境变量
    return undefined;
  }
}

function pick(dbVal: string | undefined, envVal: unknown, fallback = ''): string {
  const db = String(dbVal ?? '').trim();
  if (db) return db;
  const e = String(envVal ?? '').trim();
  return e || fallback;
}

export type NodelocConfig = {
  /** 真正可用：开关已打开且凭据齐备 */
  enabled: boolean;
  /** 后台开关（不含凭据判断），用于后台界面显示 */
  switchedOn: boolean;
  configured: boolean;
  clientId: string;
  clientSecret: string;
  autoRegister: boolean;
  scopeEmail: boolean;
  /** 后台显式登记的绝对回调地址；留空则按当前站点 origin 生成 */
  redirectUri: string;
  /** 凭据来自 Worker 环境变量时，后台只读 */
  fromEnv: boolean;
  scope: string;
};

export async function nodelocConfig(env: any): Promise<NodelocConfig> {
  const [enabled, clientId, secret, auto, scopeEmail, redirect] = await Promise.all([
    setting(env, 'nodeloc_enabled'),
    setting(env, 'nodeloc_client_id'),
    setting(env, 'nodeloc_client_secret'),
    setting(env, 'nodeloc_auto_register'),
    setting(env, 'nodeloc_scope_email'),
    setting(env, 'nodeloc_redirect_uri'),
  ]);
  const envId = String(env?.NODELOC_CLIENT_ID || '').trim();
  const envSecret = String(env?.NODELOC_CLIENT_SECRET || '').trim();
  const cid = pick(clientId, envId);
  const csec = pick(secret, envSecret);
  const configured = !!(cid && csec);
  const switchedOn = pick(enabled, env?.NODELOC_ENABLED, '0') === '1';
  const scopeEmailOn = pick(scopeEmail, env?.NODELOC_SCOPE_EMAIL, '0') === '1';
  return {
    enabled: switchedOn && configured,
    switchedOn,
    configured,
    clientId: cid,
    clientSecret: csec,
    autoRegister: pick(auto, env?.NODELOC_AUTO_REGISTER, '1') !== '0',
    scopeEmail: scopeEmailOn,
    redirectUri: pick(redirect, env?.NODELOC_REDIRECT_URI),
    fromEnv: !String(clientId ?? '').trim() && !!envId && !String(secret ?? '').trim() && !!envSecret,
    scope: `openid profile${scopeEmailOn ? ' email' : ''}`,
  };
}

/** 公开配置只下发一个布尔值，前端据此决定是否渲染登录按钮 */
export async function nodelocEnabled(env: any): Promise<boolean> {
  try {
    return (await nodelocConfig(env)).enabled;
  } catch {
    return false;
  }
}

/**
 * 回调地址必须与 NodeLoc 应用管理页登记的一致。
 * 默认按当前请求 origin 生成；多域名部署可在后台填固定绝对地址覆盖。
 */
export function redirectUriOf(c: any, cfg: NodelocConfig): string {
  const fixed = String(cfg.redirectUri || '').trim();
  if (fixed) return fixed;
  try {
    return new URL(NODELOC_CALLBACK_PATH, c.req.url).toString();
  } catch {
    return NODELOC_CALLBACK_PATH;
  }
}

export function maskSecret(v: unknown): string {
  const s = String(v || '');
  return s ? '••••••••' + s.slice(-4) : '';
}
