/**
 * GitHub OAuth 2.0 · 端点与配置
 *
 * 与 NodeLoc 对称但相互独立：
 *   authorize : https://github.com/login/oauth/authorize
 *   token     : https://github.com/login/oauth/access_token
 *   user      : https://api.github.com/user
 *   emails    : https://api.github.com/user/emails   （/user 的 email 可能为 null）
 *   starred   : https://api.github.com/user/starred/{owner}/{repo}（204 = 已 Star）
 *
 * scope 说明：
 *   read:user / user:email —— 读资料与已验证邮箱（登录建号必需）
 *   public_repo —— 读取「当前用户是否已 star 某仓库」，Star 奖励校验用
 *
 * 「需配置 GitHub OAuth 后」：默认 github_enabled=0，管理员在
 * 「站点设置 → 第三方登录 · GitHub」填 Client ID / Secret 并打开开关才生效。
 * 也支持 Worker Secrets（GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）注入。
 * Secret 与 access_token 只在 Worker 侧使用，绝不下发浏览器。
 */
import { readSettingFresh } from './settingsCache.js';
import { maskSecret } from './nodeloc.js';

export const GITHUB_PROVIDER = 'github';
/** Star 奖励用的 provider 名：与「绑定」区分，绑定本身不加配额 */
export const GITHUB_STAR_GRANT = 'github-star';
/** 同一 provider 名的历史叫法（后台 / 巡检沿用），保留为别名 */
export const GITHUB_STAR_PROVIDER = GITHUB_STAR_GRANT;
export const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
export const GITHUB_API_USER = 'https://api.github.com/user';
export const GITHUB_API_EMAILS = 'https://api.github.com/user/emails';
export const GITHUB_API_STARRED = 'https://api.github.com/user/starred';
export const GITHUB_CALLBACK_PATH = '/oauth/github/callback';
export const GITHUB_STATE_TTL_MS = 10 * 60 * 1000;
/** 独立 Cookie：与 NodeLoc 的 td_oauth_state 互不覆盖 */
export const GITHUB_STATE_COOKIE = 'td_gh_oauth_state';
export const GITHUB_SCOPE = 'read:user user:email public_repo';
export const DEFAULT_STAR_REPO = 'wcvjk8tnz8-create/Noxc';
export const DEFAULT_STAR_BONUS = 5;
/** 用户配额上限（与 NodeLoc 绑定奖励同口径） */
export const QUOTA_CAP = 10000;

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export function normalizeStarRepo(v: unknown): string {
  const s = String(v ?? '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  return REPO_RE.test(s) ? s : '';
}

async function setting(env: any, key: string): Promise<string | undefined> {
  return readSettingFresh(env, key);
}

function pick(dbVal: string | undefined, envVal: unknown, fallback = ''): string {
  const d = String(dbVal ?? '').trim();
  if (d) return d;
  const e = String(envVal ?? '').trim();
  return e || fallback;
}

export type GithubConfig = {
  enabled: boolean;
  switchedOn: boolean;
  configured: boolean;
  clientId: string;
  clientSecret: string;
  autoRegister: boolean;
  redirectUri: string;
  starRepo: string;
  starBonus: number;
  fromEnv: boolean;
  scope: string;
};

export async function githubConfig(env: any): Promise<GithubConfig> {
  const [enabled, id, secret, auto, redirect, repo, bonus] = await Promise.all([
    setting(env, 'github_enabled'),
    setting(env, 'github_client_id'),
    setting(env, 'github_client_secret'),
    setting(env, 'github_auto_register'),
    setting(env, 'github_redirect_uri'),
    setting(env, 'github_star_repo'),
    setting(env, 'github_star_bonus'),
  ]);
  const envId = String(env?.GITHUB_CLIENT_ID || '').trim();
  const envSecret = String(env?.GITHUB_CLIENT_SECRET || '').trim();
  const cid = pick(id, envId);
  const csec = pick(secret, envSecret);
  const configured = !!(cid && csec);
  const switchedOn = pick(enabled, env?.GITHUB_ENABLED, '0') === '1';
  const parsedBonus = Number(pick(bonus, env?.GITHUB_STAR_BONUS, String(DEFAULT_STAR_BONUS)));
  return {
    enabled: switchedOn && configured,
    switchedOn,
    configured,
    clientId: cid,
    clientSecret: csec,
    autoRegister: pick(auto, env?.GITHUB_AUTO_REGISTER, '1') !== '0',
    redirectUri: pick(redirect, env?.GITHUB_REDIRECT_URI),
    starRepo: normalizeStarRepo(pick(repo, env?.GITHUB_STAR_REPO, DEFAULT_STAR_REPO)) || DEFAULT_STAR_REPO,
    starBonus: Number.isFinite(parsedBonus) ? Math.max(0, Math.min(100, Math.floor(parsedBonus))) : DEFAULT_STAR_BONUS,
    fromEnv: !String(id ?? '').trim() && !!envId && !String(secret ?? '').trim() && !!envSecret,
    scope: GITHUB_SCOPE,
  };
}

/** 公开配置只下发布尔值，前端据此决定是否渲染登录 / 绑定入口 */
export async function githubEnabled(env: any): Promise<boolean> {
  try { return (await githubConfig(env)).enabled; } catch { return false; }
}

/** 回调地址强制 https（GitHub OAuth App 的 callback URL 必须逐字符一致） */
export function httpsCallbackUrl(c: any): string {
  try {
    const u = new URL(GITHUB_CALLBACK_PATH, c.req.url);
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return GITHUB_CALLBACK_PATH;
  }
}

export function redirectUriOf(c: any, cfg: GithubConfig): string {
  const fixed = String(cfg.redirectUri || '').trim();
  if (fixed) {
    try {
      const u = new URL(fixed);
      u.protocol = 'https:';
      return u.toString();
    } catch { return fixed; }
  }
  return httpsCallbackUrl(c);
}

/** Star 仓库的公开链接，供前端「去点 Star」按钮使用 */
export function starRepoUrl(repo: string): string {
  return `https://github.com/${repo}`;
}

/**
 * 实时向 GitHub 复核「当前 token 是否给该仓库点过 Star」。
 *   GET https://api.github.com/user/starred/{owner}/{repo}
 *   204 = 已 Star；404 = 未 Star；401 = token 失效；0 = 网络异常。
 *
 * 每次领取都重新请求，绝不缓存判定结果 —— 否则用户点一次 Star 后
 * 撤掉也能反复领奖，或者换了仓库配置仍按旧结果发配额。
 */
export async function checkStarred(token: string, repoRaw: string): Promise<number> {
  const repo = normalizeStarRepo(repoRaw);
  const tok = String(token || '').trim();
  if (!tok || !repo) return 0;
  try {
    const r = await fetch(`https://api.github.com/user/starred/${repo}`, {
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Noxc-Subdomain-Hub',
      },
    });
    return r.status;
  } catch {
    return 0;
  }
}

export { maskSecret };
