/**
 * NodeLoc OAuth 2.0 / OIDC 授权码接入 · 端点与配置
 *
 * 官方对接文档（应用管理页需 TL2 及以上）：
 *   https://www.nodeloc.com/oauth-provider/applications
 *   authorize : https://www.nodeloc.com/oauth-provider/authorize
 *   token     : https://www.nodeloc.com/oauth-provider/token
 *   userinfo  : https://www.nodeloc.com/oauth-provider/userinfo  ← 全小写
 *
 * 官方 userInfo 响应只有 { id, username, name, avatar_url, trust_level, email }，
 * 没有 sub，且 email 仅在 scope 含 email 时返回。所以默认申请 email 权限，
 * 并把「读到邮箱」作为唯一必需资料；id / sub 有就用、没有则由邮箱派生。
 *
 * 配置优先级：后台「站点设置」 > Worker 环境变量 > 关闭。
 * Client Secret 只在服务端使用，绝不下发到 /api/config 或前端。
 */

export const NODELOC_PROVIDER = 'nodeloc';
export const NODELOC_AUTHORIZE = 'https://www.nodeloc.com/oauth-provider/authorize';
export const NODELOC_TOKEN = 'https://www.nodeloc.com/oauth-provider/token';
/** 官方文档拼写：全小写 userinfo（旧版代码误写成 userInfo，会 404 → 读不到资料） */
export const NODELOC_USERINFO = 'https://www.nodeloc.com/oauth-provider/userinfo';
/** 兼容极少数仍只认旧拼写的部署，作为兜底再试一次 */
export const NODELOC_USERINFO_LEGACY = 'https://www.nodeloc.com/oauth-provider/userInfo';
export const NODELOC_CALLBACK_PATH = '/oauth/nodeloc/callback';
export const NODELOC_STATE_TTL_MS = 10 * 60 * 1000;
export const NODELOC_STATE_COOKIE = 'td_oauth_state';
/** 成功绑定 NodeLoc 后一次性奖励的域名配额 */
export const NODELOC_BIND_QUOTA_BONUS = 5;

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
  /* email 是唯一必需资料，权限恒开、不可关闭。
     旧实现允许后台关掉 nodeloc_scope_email，关掉后 userInfo 不带邮箱，
     代码就退回去生成 nl.<hex>@oauth.local 乱码内部邮箱 —— 那是 NodeLoc
     登录账号，应该用他们真实的 NodeLoc 邮箱，不是乱码。
     这里仍读一次旧设置只为兼容老库，值一律忽略；授权 scope 恒含 email。 */
  const scopeEmailOn = true;
  void scopeEmail;
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
    scope: 'openid profile email',
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
 * 生成 https 绝对回调地址。
 * NodeLoc 只接受 HTTPS 回调；反代 / 本地调试里 c.req.url 可能带 http:，
 * 这里一律把协议归一成 https，避免后台给管理员复制出 http:// 的地址，
 * 导致「应用管理页登记的回调 URI」与授权请求里的不一致而被拒。
 */
export function httpsCallbackUrl(c: any): string {
  try {
    const u = new URL(NODELOC_CALLBACK_PATH, c.req.url);
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return NODELOC_CALLBACK_PATH;
  }
}

/**
 * 回调地址必须与 NodeLoc 应用管理页登记的一致。
 * 默认按当前请求 origin 生成（强制 https）；多域名部署可在后台填固定
 * 的 https 绝对地址覆盖。
 */
export function redirectUriOf(c: any, cfg: NodelocConfig): string {
  const fixed = String(cfg.redirectUri || '').trim();
  if (fixed) {
    // 旧库可能残留 http:// 的自定义地址，保存端已拦截新增，这里再兜底归一，
    // 保证授权请求里发给 NodeLoc 的 redirect_uri 一定是 https。
    try {
      const u = new URL(fixed);
      u.protocol = 'https:';
      return u.toString();
    } catch {
      return fixed;
    }
  }
  return httpsCallbackUrl(c);
}

export function maskSecret(v: unknown): string {
  const s = String(v || '');
  return s ? '••••••••' + s.slice(-4) : '';
}
