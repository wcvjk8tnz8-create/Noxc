/**
 * Noxc App 专用接口族 · /api/app/v1/*
 *
 * 为什么单独开一个前缀：手机版是**完全原生** App，首屏要同时拿到「站点公告 +
 * 公开统计 + 积分规则 + 后缀列表」以及登录后的「账号 + 我的域名 + 积分」。
 * 让 App 拼 4 个公开/私有接口，既多打请求，又容易在不同端出现口径不一致。
 * bootstrap 一次返回四个 tab 的全部数据，且**所有业务数据都复用站点原有函数**，
 * 不在这里另写一套规则（补发奖励、暂停解析、额度、有效期全部同源）。
 *
 * 未登录也能调：只回公开的 site 段，user/domains/points 为 null。
 * 站点密钥、AI 配置、后台设置一律不下发（buildConfigData 本身已是白名单）。
 */
import { Hono } from 'hono';
import { ok } from '../lib/util.js';
import { publicUser } from './auth.js';
import { listMineData } from './subdomains.js';
import { pointsSnapshot } from './points.js';

export const APP_API_VERSION = 'noxc-app/v1';

/** App 真正会渲染的公开配置字段，显式白名单，避免把 /api/config 整包搬进 App。 */
const APP_CONFIG_KEYS = [
  'siteName', 'announcement', 'migrationNotice',
  'publicStats', 'pointRules', 'expiry', 'defaultQuota',
  'rootDomain', 'rootDomains', 'pausedRoots', 'dnsPausedRoots',
  'allowSignup', 'applyPaused', 'applyPausedMessage',
  'nodelocEnabled', 'githubEnabled', 'mailVerifyRequired',
] as const;

type BuildConfig = (c: any) => Promise<Record<string, any>>;

/**
 * factory 而不是直接 import buildConfigData：那个函数仍在 index.ts 作用域里，
 * 用参数注入可以避免 route ↔ entry 循环依赖，同时保证口径 100% 同源。
 */
export function createAppRoutes(buildConfigData: BuildConfig) {
  const r = new Hono();

  /** GET /api/app/v1/bootstrap —— App 冷启动唯一请求 */
  r.get('/bootstrap', async (c) => {
    const u: any = c.get('user');

    // 公开配置与登录态数据彼此独立，并发取；未登录时后两项零查询。
    const [fullConfig, meData, domains, points] = await Promise.all([
      buildConfigData(c),
      u ? meSnapshot(c, u) : Promise.resolve(null),
      u ? listMineData(c).catch(() => null) : Promise.resolve(null),
      u ? pointsSnapshot(c).catch(() => null) : Promise.resolve(null),
    ]);

    const site: Record<string, any> = {};
    for (const k of APP_CONFIG_KEYS) {
      if (fullConfig[k] !== undefined) site[k] = fullConfig[k];
    }

    const res = ok(c, {
      api: APP_API_VERSION,
      site,
      user: meData ? meData.user : null,
      used: meData ? meData.used : 0,
      domains,
      points,
      /* App 其余交互都走这里给出的路径，不在客户端硬编码一整套 API。
         原生端只读取；注册 / 改记录 / 后台 / 文档这类复杂流程走浏览器。 */
      endpoints: {
        check: '/api/subdomains/check',
        whois: '/api/whois',
        records: '/api/records/subdomains/{id}/records',
        checkin: '/api/points/checkin',
        login: '/api/auth/login',
        logout: '/api/auth/logout',
        webConsole: '/dashboard',
        webRegister: '/register',
        webDocs: '/docs',
        webTerms: '/terms',
        webExternalDomains: '/external-domains',
        webReport: '/report',
      },
      capabilities: {
        native: ['home', 'domains', 'points', 'profile', 'login', 'checkin', 'lookup', 'whois'],
        browserOnly: ['register', 'oauth', 'dnsWrite', 'admin', 'docs', 'externalDomains'],
      },
    });
    /* 私有短缓存：刷新 / 切后台回来最多省一次往返；含登录态所以绝不 public。
       写操作（签到 / 申请 / 审核）后 App 会带 ?_= 强制 fresh，见 Api.bootstrap。 */
    res.headers.set('Cache-Control', 'private, max-age=10');
    return res;
  });

  return r;
}

/** /api/auth/me 的同源精简版：账号公开字段 + 已用额度。 */
async function meSnapshot(c: any, u: any) {
  const full = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
  const used = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subdomains WHERE user_id = ? AND status IN ('pending','approved','suspended')"
  ).bind(u.id).first();
  return { user: publicUser(full), used: Number(used?.n || 0) || 0 };
}
