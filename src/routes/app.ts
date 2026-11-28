/**
 * Noxc App 专用接口族 · /api/app/v1/*
 *
 * 为什么单独开一个前缀：手机版是**完全原生** App，首屏要同时拿到「站点公告 +
 * 公开统计 + 积分规则 + 后缀列表」以及登录后的「账号 + 我的域名 + 积分」。
 * bootstrap 一次返回全部数据，且**所有业务数据都复用站点原有函数**，不另写规则。
 *
 * 这一版把**所有写操作**（DNS 记录增删改、申请域名、管理后台审核 / 用户 /
 * 设置 / IP 封禁、第三方域名、通知工单等）都开放给原生端：endpoints 是全量
 * 接口地图，App 从这里读路径，不在客户端硬编码；capabilities.browserOnly 只剩
 * 第三方 OAuth（授权规范强制浏览器安全上下文，改在 /app-authorize 浏览器授权页完成）。
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
  'nodelocEnabled', 'githubEnabled', 'mailVerifyRequired', 'verifyRequired',
  'signupEmailRule', 'signupEmailHint', 'mailOk',
] as const;

type BuildConfig = (c: any) => Promise<Record<string, any>>;

/**
 * factory 而不是直接 import buildConfigData：那个函数仍在 index.ts 作用域里，
 * 用参数注入可以避免 route ↔ entry 循环依赖，同时保证口径 100% 同源。
 */
export function createAppRoutes(buildConfigData: BuildConfig, dispatch?: (c: any, path: string) => Promise<any>) {
  const r = new Hono();

  /** GET /api/app/v1/admin/overview —— 管理后台首屏一次拿全 9 段数据。
      通过注入的 dispatch 复用现有 /api/admin/* 端点（同源、同 requireAdmin），
      不在 App 专用层另写一套查询；任一段失败只降级为 null，不影响其它段。 */
  r.get('/admin/overview', async (c) => {
    if (!dispatch) return ok(c, { sections: {} });
    const paths: Record<string, string> = {
      stats: '/api/admin/stats',
      pending: '/api/admin/subdomains?status=pending',
      subdomains: '/api/admin/subdomains',
      users: '/api/admin/users',
      locks: '/api/admin/locks',
      audit: '/api/admin/audit',
      ips: '/api/admin/ips',
      settings: '/api/admin/settings',
      externalDomains: '/api/admin/external-domains',
      emailRequests: '/api/admin/email-requests',
      roots: '/api/admin/roots',
    };
    const keys = Object.keys(paths);
    const settled = await Promise.all(keys.map(async (k) => {
      try {
        const d = await dispatch(c, paths[k]);
        return [k, d && d.success ? d.data : null];
      } catch { return [k, null]; }
    }));
    const sections: Record<string, any> = {};
    for (const [k, v] of settled) sections[k] = v;
    const res = ok(c, { sections });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  });

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
    /* 管理员标识随登录态下发：App 据此显示第 5 个「管理」tab。
       真正的权限判定仍在服务端 requireAdmin，这个字段只控制 UI 显隐。 */
    site.isAdmin = !!u && u.role === 'admin';

    const res = ok(c, {
      api: APP_API_VERSION,
      site,
      user: meData ? meData.user : null,
      used: meData ? meData.used : 0,
      domains,
      points,
      /* App 其余交互都走这里给出的路径，不在客户端硬编码一整套 API。
         原生端完成登录 / 注册 / 找回密码；改记录 / 后台 / 文档走应用内标签页。 */
      /* 全量接口地图：App 的每一个按钮都从这里取路径。
         {id} / {email} 是占位符，客户端替换后请求；新增接口只需在这里加一行。 */
      endpoints: {
        // 公开查询
        check: '/api/subdomains/check',
        whois: '/api/whois',
        config: '/api/config',
        terms: '/api/terms',
        rules: '/api/rules',
        showcase: '/api/showcase',
        pointsCost: '/api/points/cost',
        stats: '/api/stats',
        // 账号
        login: '/api/auth/login',
        logout: '/api/auth/logout',
        register: '/api/auth/register',
        verifySend: '/api/auth/verify/send',
        verifyCheck: '/api/auth/verify/check',
        reset: '/api/auth/reset',
        me: '/api/auth/me',
        oauthNodeloc: '/api/auth/nodeloc/start',
        oauthGithub: '/api/auth/github/start',
        // 浏览器授权登录：在站点登录后点「授权给 App」，App 用一次性码换会话
        appTokenIssue: '/api/app/v1/auth/issue',
        appTokenExchange: '/api/app/v1/auth/exchange',
        appAuthorize: '/app-authorize',
        // 我的域名
        mine: '/api/subdomains/mine',
        apply: '/api/subdomains',
        subdomain: '/api/subdomains/{id}',
        subdomainUpdate: '/api/subdomains/{id}',
        renew: '/api/subdomains/{id}/renew',
        subdomainDelete: '/api/subdomains/{id}',
        // DNS 记录（完整增删改 + 验证锁）
        records: '/api/subdomains/{id}/records',
        recordUpdate: '/api/records/{rid}',
        recordDelete: '/api/records/{rid}',
        verifyStart: '/api/subdomains/{id}/verify',
        verifyConfirm: '/api/records/{rid}/verify-confirm',
        forceUnlock: '/api/records/{rid}/force-unlock',
        soa: '/api/soa',
        // 积分 / 兑换 / 签到
        pointsMe: '/api/points/me',
        checkin: '/api/points/checkin',
        rewards: '/api/points/rewards',
        redeem: '/api/redeem/redeem',
        redeemMine: '/api/redeem/mine',
        redeemGenerate: '/api/redeem/admin/generate',
        redeemList: '/api/redeem/admin/list',
        // 个人中心 / 消息 / 工单 / 转让 / 举报 / 聊天
        profile: '/api/profile',
        profileEmailSend: '/api/profile/email/send',
        profileEmailConfirm: '/api/profile/email/confirm',
        passwordSendCode: '/api/auth/password/send-code',
        passwordChange: '/api/auth/password',
        notifications: '/api/notifications',
        notificationsRead: '/api/notifications/read',
        notificationsReadAll: '/api/notifications/read-all',
        notificationDelete: '/api/notifications/{id}',
        tickets: '/api/tickets',
        ticketCreate: '/api/tickets',
        ticketReply: '/api/tickets/{id}/reply',
        ticketClose: '/api/tickets/{id}/close',
        ticketDetail: '/api/tickets/{id}',
        transferNotice: '/api/transfer/notice',
        transferPreview: '/api/transfer/preview',
        transferCommit: '/api/transfer/commit',
        transferMine: '/api/transfer/mine',
        abuse: '/api/abuse',
        abuseAdmin: '/api/abuse/admin',
        abuseMine: '/api/abuse/mine',
        chatPosts: '/api/chat/posts',
        chatReply: '/api/chat/posts/{id}/replies',
        delegationProviders: '/api/delegation/providers',
        delegation: '/api/subdomains/{id}/delegation',
        delegationCheck: '/api/subdomains/{id}/delegation/check',
        // 第三方域名
        externalDomains: '/api/external-domains',
        externalDomainVerify: '/api/external-domains/{id}/verify',
        externalDomainConnect: '/api/external-domains/{id}/connect',
        externalDomainCheckNs: '/api/external-domains/{id}/check-ns',
        externalDomainDelete: '/api/external-domains/{id}',
        emailRequest: '/api/email-request',
        emailRequestStatus: '/api/email-request/status',
        captcha: '/api/captcha/challenge',
        captchaVerify: '/api/captcha/verify',
        // 管理后台（仅 admin，服务端仍有 requireAdmin）
        adminOverview: '/api/app/v1/admin/overview',
        adminStats: '/api/admin/stats',
        adminSubdomains: '/api/admin/subdomains?status={status}',
        adminApprove: '/api/admin/subdomains/{id}/approve',
        adminReject: '/api/admin/subdomains/{id}/reject',
        adminSuspend: '/api/admin/subdomains/{id}/suspend',
        adminRestore: '/api/admin/subdomains/{id}/restore',
        adminSubdomainDelete: '/api/admin/subdomains/{id}',
        adminUsers: '/api/admin/users',
        adminUserPoints: '/api/admin/users/{id}/points',
        adminUserBan: '/api/admin/users/{id}/ban',
        adminUserUnban: '/api/admin/users/{id}/unban',
        adminUserQuota: '/api/admin/users/{id}/quota',
        adminLocks: '/api/admin/locks',
        adminAudit: '/api/admin/audit',
        adminReconcile: '/api/admin/reconcile/{id}',
        adminIps: '/api/admin/ips',
        adminIpBan: '/api/admin/ips/ban',
        adminIpUnban: '/api/admin/ips/unban',
        adminSettings: '/api/admin/settings',
        adminExternalDomains: '/api/admin/external-domains',
        adminExternalApprove: '/api/admin/external-domains/{id}/approve',
        adminExternalReject: '/api/admin/external-domains/{id}/reject',
        adminEmailRequests: '/api/admin/email-requests',
        adminEmailApprove: '/api/admin/email-requests/{id}/approve',
        adminEmailReject: '/api/admin/email-requests/{id}/reject',
        adminEmailAllowlist: '/api/admin/email-allowlist',
        adminRoots: '/api/admin/roots',
        adminRootBackend: '/api/admin/roots/{domain}/backend',
        adminRootRestore: '/api/admin/roots/{domain}/restore',
        adminResetLogo: '/api/admin/settings/reset-logo',
        adminBackupExport: '/api/admin/backup/export/{kind}',
        adminBackupImport: '/api/admin/backup/import/{kind}',
        adminAiReviewRun: '/api/admin/ai-review-run',
        adminAiReviewStatus: '/api/admin/ai-review-status',
        // 纯阅读类（Custom Tab 在 App 内打开，不算「操控」）
        webConsole: '/dashboard',
        webDocs: '/docs',
        webTerms: '/terms',
        webExternalDomains: '/external-domains',
        webReport: '/report',
      },
      capabilities: {
        native: ['home', 'domains', 'points', 'profile', 'admin',
          'login', 'register', 'forgotPassword', 'checkin', 'lookup', 'whois',
          'applySubdomain', 'renew', 'deleteSubdomain', 'dnsCreate', 'dnsUpdate',
          'dnsDelete', 'dnsVerify', 'adminReview', 'adminUsers', 'adminSettings',
          'adminIps', 'adminAudit', 'externalDomains', 'notifications', 'tickets',
          'redeem', 'transfer', 'abuse'],
        /* 只剩第三方 OAuth：授权规范强制浏览器安全上下文，用 Custom Tab 在 App 内完成。
           静态文档 / 条款是「阅读」不是「操控」，也走 Custom Tab，但不离开 App。 */
        /* 第三方 OAuth 仍在浏览器侧完成，但不再是 App 直接跳 /start：
           App 打开 /app-authorize，用户在浏览器里用 GitHub / NodeLoc 登录，
           再点「授权给 App」把登录态一次性交接给原生端。 */
        browserOnly: ['oauth'],
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
