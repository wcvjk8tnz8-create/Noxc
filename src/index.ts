import { effectiveRootList } from './lib/rootStore.js';
import { DEFAULT_MESSAGE } from './lib/applyGate.js';
import { loadAiConfig } from './lib/aiReview.js';
import { parseRootCosts } from './lib/points.js';
import { POINT_DEFAULTS } from './lib/pointDefaults.js';
import { runAiReviewBatch } from './lib/aiBatch.js';
import { emailRuleHint, emailRuleOf } from './lib/emailRule.js';
import { DEFAULT_FOOTER_ICP_HTML } from './lib/footerIcp.js';
import { DEFAULT_FOOTER_CONTACT_HTML } from './lib/footerContact.js';
import { reservedLabelsOf } from './lib/reserved.js';
import { publicStats, invalidatePublicStats } from './lib/publicStats.js';
import { getConfigCache, setConfigCache, CONFIG_CACHE_CONTROL, invalidatePublicConfig } from './lib/configCache.js';
import { pickSettings, invalidateSettings } from './lib/settingsCache.js';
import { parsePausedRoots } from './lib/applyGate.js';
import { nodelocEnabled } from './lib/nodeloc.js';
import { githubEnabled } from './lib/github.js';
import { showcaseRewardOf } from './lib/showcaseReward.js';
import { expiryRules } from './lib/expiry.js';
import { rootPageFor } from './html/rootPages.js';
import { spaFallbackPaths } from './lib/spaRoutes.js';
import { Hono } from 'hono';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import { bootstrap } from './middleware/bootstrap.js';
import { ok, fail, defaultQuotaOf } from './lib/util.js';
import { RECORD_TYPES, TTL_CHOICES, VERIFY_PRESETS, HOSTING_NS_PRESETS, TYPE_NAMES } from './lib/records.js';
import authRoutes from './routes/auth.js';
import externalDomainRoutes from './routes/externalDomains.js';
import nodelocRoutes from './routes/nodeloc.js';
import githubRoutes from './routes/github.js';
import termsRoutes from './routes/terms.js';
import whoisRoutes from './routes/whois.js';
import delegationRoutes from './routes/delegation.js';
import pointRoutes from './routes/points.js';
import subdomainRoutes from './routes/subdomains.js';
import captchaRoutes from './routes/captcha.js';
import { captchaEnabled } from './lib/captcha.js';
import recordRoutes from './routes/records.js';
import adminRoutes from './routes/admin.js';
import redeemRoutes from './routes/redeem.js';
import chatRoutes from './routes/chat.js';
import notificationRoutes from './routes/notifications.js';
import profileRoutes from './routes/profile.js';
import ticketRoutes from './routes/tickets.js';
import transferRoutes from './routes/transfer.js';
import abuseRoutes from './routes/abuse.js';
import backupRoutes from './routes/backup.js';
import emailRequestRoutes from './routes/emailRequests.js';
import showcaseRoutes from './routes/showcase.js';

const app = new Hono();

/**
 * 服务文档静态资源的取用：ASSETS 的 html_handling 会把
 *   /docs/index.html → /docs/、/docs/foo.html → /docs/foo
 * 这类路径做规范化 3xx。如果直接把 3xx 交回浏览器，下一轮请求又进 Worker，
 * Worker 又把路径改写回 /docs/index.html，就形成 Safari 报的
 * 「太多重新导向」无限循环（/docs 改 VitePress 后真实踩过）。
 *
 * 这里在 Worker 内部跟随这些 3xx，只把最终的 200/404 返回给浏览器；
 * 记录访问过的 path，检测到自指立即停下并回 404，绝不外吐 3xx。
 */
async function docsAsset(c: any, startPath: string): Promise<Response> {
  let url = new URL(startPath, c.req.url);
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const key = url.pathname;
    if (seen.has(key)) break;            // 内部自指循环，停止
    seen.add(key);
    const res = await c.env.ASSETS.fetch(new Request(url, c.req.raw));
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get('location');
    if (!loc) return res;
    url = new URL(loc, url);
  }
  return new Response('docs asset redirect loop', { status: 404 });
}

// /api/xxx/ 与 /api/xxx 等价（去掉结尾斜杠后重新分发）
app.use('/api/*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.length > 1 && url.pathname.endsWith('/') && !c.req.header('x-rewrite')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
    const headers = new Headers(c.req.raw.headers);
    headers.set('x-rewrite', '1');
    const req = new Request(url.toString(), { method: c.req.method, headers, body: c.req.raw.body });
    return app.fetch(req, c.env, c.executionCtx);
  }
  return next();
});

/**
 * whois.<根域名> 服务端重定向（不依赖前端 JS，最可靠）
 *  - /            → /whois.html
 *  - /google      → /whois.html?name=google
 *
 * 铁律：WHOIS 页本身（/whois.html、/whois、带查询串）永不被重定向，
 * 且不受任何登录态影响。下面的白名单在任何其它判断之前生效。
 */
app.use('*', async (c, next) => {
  let u;
  try { u = new URL(c.req.url); } catch { return next(); }
  const p = u.pathname;

  // ① WHOIS 页与接口、静态资源：绝对放行，任何 host 都不重定向
  if (/^\/whois(\.html)?$/i.test(p)) return next();
  if (p.startsWith('/api/')) return next();
  if (/\.(css|js|png|jpg|jpeg|webp|ico|svg|json|txt|woff2?)$/i.test(p)) return next();

  const seg = u.hostname.toLowerCase().split('.');
  if (seg.length < 3 || seg[0] !== 'whois') return next();

  // ② 只接管入口页（/ 与 /index.html）
  const root = p.replace(/^\/+|\/+$/g, '');
  if (root === '' || root === 'index.html') {
    return c.redirect('/whois.html', 302);
  }

  // ③ whois.<域>/<名称> 直接查询：仅限单一路径段且不是任何已知页面
  const KNOWN = new Set(['whois', 'whois.html', 'dashboard', 'dashboard.html',
    'admin', 'admin.html', 'domain', 'domain.html', 'terms', 'terms.html', 'index.html',
    'docs', 'docs.html']);
  if (!KNOWN.has(root.toLowerCase()) && !/[./]/.test(root) && !u.search) {
    return c.redirect(`/whois.html?name=${encodeURIComponent(root)}`, 302);
  }
  return next();
});

/* 请求引导（唯一入口）：静态资源整段跳过 D1、按需加载登录态、
   合并动态根域名、跨 isolate 幂等补列。详见 middleware/bootstrap.ts。
   放在 whois 重定向之后 —— 被 302 提前返回的请求一次库都不用查。 */
app.use('*', bootstrap);

/* 旧链接 /docs/dnshe 回到 VitePress 的 DNSHE 章节。
   不能直接 302 到 /docs/dnshe.html：ASSETS 会把 .html 规范化回 /docs/dnshe，
   又撞上这条路由 → 循环。改为内部取到内容后直接响应，浏览器零重定向。 */
app.get('/docs/dnshe', (c) => docsAsset(c, '/docs/dnshe.html'));
app.get('/docs/dnshe.html', (c) => docsAsset(c, '/docs/dnshe.html'));

// 健康检查
app.get('/api/health', (c) =>
  ok(c, { ok: true, root: c.env.ROOT_DOMAIN, mock: c.env.CF_MOCK === '1', time: new Date().toISOString() })
);

// 头像读取代理（未配置 R2 公开域名时走这里；已配置则可直连 R2）
app.get('/api/avatar/:key', async (c) => {
  const key = String(c.req.param('key') || '');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(key)) return c.text('bad key', 400);
  // 与上传一致：绑定存在即启用（R2 由 CI 自动绑定）
  if (!c.env.AVATARS) {
    return c.text('avatar storage not configured', 404);
  }
  const obj = await c.env.AVATARS.get(key);
  if (!obj) return c.text('not found', 404);
  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(obj.body, { headers });
});

/**
 * 公开配置跨域：根域名静态页挂在 meoy.top / v-1.top 等独立域上，
 * 需要 fetch 官网的 /api/config 才能拿到「全部生效后缀」。
 * 该接口只读、不含任何密钥或用户信息，允许任意来源读取；
 * 其余 /api/* 接口保持同源，不受影响。
 */
const publicCors = async (c, next) => {
  const origin = c.req.header('Origin') || '*';
  const hdrs: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '600',
  };
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });
  await next();
  try { for (const [k, v] of Object.entries(hdrs)) c.res.headers.set(k, v); } catch { /* 响应不可写时忽略 */ }
};
/* 任何写操作成功后立即让 /api/config 的整响应缓存失效。
   一处覆盖全部写路径（设置 / 根域名 / 暂停名单 / 审核 / 登录绑定…），
   不用在十几个路由里逐个加，也不会漏。统计快照只在会影响
   subdomains / users 的写路径失效，其余写操作只清内存缓存。 */
app.use('*', async (c, next) => {
  await next();
  try {
    if (c.req.method === 'GET' || c.res.status >= 400) return;
    invalidatePublicConfig();
    /* 统一配置层也要失效：后台改了任何 settings（暂停名单 / 根域名 / 公告 /
       积分规则…），本 isolate 的 30 秒缓存必须立刻作废，否则「保存即生效」会
       被缓存拖住。跨 isolate 由前端 ?_= 强制 fresh 兜底。 */
    invalidateSettings();
    const p = new URL(c.req.url).pathname;
    if (/^\/api\/(admin\/)?subdomains/.test(p)
      || /^\/api\/auth\/register/.test(p)
      || /^\/oauth\//.test(p)
      || /^\/api\/admin\/users/.test(p)
      || /^\/api\/admin\/backup\/import\/(users|subdomains)/.test(p)) {
      /* 备份汇入会新增用户 / 域名，公开统计快照必须同步失效，否则首页数字滞后 */
      await invalidatePublicStats(c.env);
    }
  } catch { /* 失效失败不能影响写操作本身 */ }
});

app.use('/api/config', publicCors);
app.use('/api/stats', publicCors);

// 前端初始化配置
// 公开配置（含站点品牌，登录页也要用）
async function buildConfigData(c: any) {
  /* 白名单挑字段：整张 settings 只在 Worker 内存里，绝不下发敏感 key。
     统一配置层命中缓存时这里是 0 次 D1，未命中也只 1 次全表读。 */
  const CONFIG_KEYS = ['site_name','logo_url','favicon_url','footer_icp_html','footer_contact_html','font_body','font_display','mail_verify_required','mail_provider','mail_from','apply_paused','apply_paused_message','ai_review_roots','dns_unlimited_roots','root_point_costs','domain_cost','short_domain_cost','short_domain_len','checkin_points','initial_points','default_quota','announcement','root_apply_paused'] as const;
  const s = await pickSettings(c.env, CONFIG_KEYS);
  // 显式取「生效列表」：不依赖中间件是否成功替换 c.env 引用，
  // 后台导入 / 移除 / 恢复的根域名都能立即出现在注册页与首页下拉。
  const effectiveRoots = (await effectiveRootList(c.env)).map((r) => r.domain);
  // 注册是否需要邮箱验证码（后台开启且邮件服务已配置时才真正启用）
  const mailOk = !!(String(s.mail_provider || c.env.MAIL_PROVIDER || '').trim()
    && String(c.env.MAIL_API_KEY || '').trim());
  const verifyRequired =
    String(c.env.MAIL_VERIFY_REQUIRED || s.mail_verify_required || '0').trim() === '1';
  // AI 状态只给标志位，绝不下发地址与密钥
  const ai = await loadAiConfig(c.env).catch(() => null);
  const emailRule = await emailRuleOf(c.env);
  return {
    signupEmailRule: emailRule,
    signupEmailHint: emailRuleHint(emailRule),
    rootDomain: effectiveRoots[0] || c.env.ROOT_DOMAIN,
    rootDomains: effectiveRoots,
    // 系统保留名称：公开名单，注册页 / WHOIS 可即时提示；管理员仍可自建
    reservedLabels: [...(await reservedLabelsOf(c.env))],
    // 注册滑块验证：前端据此决定是否渲染，后端注册接口用同一份判定
    captchaEnabled: await captchaEnabled(c.env),
    // NodeLoc 第三方登录：只有后台开启且凭据齐备才显示按钮，不下发任何密钥
    nodelocEnabled: await nodelocEnabled(c.env),
    // GitHub 第三方登录 / 绑定：同样只下发布尔值，Secret 与 access_token 绝不出 Worker
    githubEnabled: await githubEnabled(c.env),
    // 存储绑定状态：只给布尔值，方便一眼确认 KV / R2 是否已自动挂上
    kvBound: !!c.env.KV,
    avatarUpload: !!c.env.AVATARS,
    // 注册页后缀菜单据此显示每个后缀的积分（0 = Free，未配置 = 按全局规则）
    rootPointCosts: parseRootCosts(s.root_point_costs),
    // 用户案例展示奖励：前端提示「开启展示可得 X 积分」，随后台设置变
    showcaseRewardPoints: await showcaseRewardOf(c.env),
    // 域名有效期 / 续期窗口（窗口留空时按有效期一半自动推算）：首页与注册须知据此渲染
    expiry: await expiryRules(c.env),
    // 与后台「积分规则」同一份生效值；页面说明据此实时渲染，不再写死数字
    pointRules: {
      checkin: Number(s.checkin_points ?? POINT_DEFAULTS.checkin) || 0,
      initial: Number(s.initial_points ?? POINT_DEFAULTS.initial) || 0,
      domainCost: Number(s.domain_cost ?? POINT_DEFAULTS.domainCost) || 0,
      shortCost: Number(s.short_domain_cost ?? POINT_DEFAULTS.shortCost) || 0,
      shortLen: Number(s.short_domain_len ?? POINT_DEFAULTS.shortLen) || 1,
    },
    allowSignup: c.env.ALLOW_SIGNUP !== '0',
    requireApproval: c.env.REQUIRE_APPROVAL === '1',
    applyPaused: String(c.env.APPLY_PAUSED || s.apply_paused || '').trim() === '1',
    applyPausedMessage: String(s.apply_paused_message || '').trim() || DEFAULT_MESSAGE,
    // 按后缀单独暂停：公开名单（不含任何敏感信息），首页 / 注册页据此标注与锁定。
    // 环境变量 ROOT_APPLY_PAUSED 与后台设置取并集，与注册接口的 applyGate 同口径。
    pausedRoots: parsePausedRoots([
      String(c.env.ROOT_APPLY_PAUSED || ''), String(s.root_apply_paused || ''),
    ].join(',')),
    rootApplyPausedFromEnv: parsePausedRoots(c.env.ROOT_APPLY_PAUSED || '').length > 0,
    recordTypes: TYPE_NAMES.map((k) => ({ key: k, ...RECORD_TYPES[k] })),
    ttlChoices: TTL_CHOICES,
    verifyPresets: VERIFY_PRESETS,
    // 托管服务 NS 预设：NS 也是普通 DNS 记录，前端不写死服务器名
    hostingNsPresets: HOSTING_NS_PRESETS,
    siteName: s.site_name || 'Noxc',
    logoUrl: s.logo_url || '/img/logo.jpg',
    faviconUrl: s.favicon_url || '/favicon.ico',
    // 站点公告：后台「站点设置 → 站点公告」的纯文本，留空则不渲染。
    // 以前漏在 SELECT 清单外，前端永远读到 undefined，公告条一次都没出现过。
    // 只回纯文本（不解析 HTML），前端用 textContent 渲染，管理员写什么就显示什么。
    announcement: String(s.announcement || '').trim().slice(0, 300),
    fontBody: s.font_body || 'system',
    fontDisplay: s.font_display || 'system',
    // 首页展示的额度跟着后台「站点设置」走，与注册同一逐级回落口径
    defaultQuota: await defaultQuotaOf(c.env),
    // 首页「注册人数 / 已开通域名」：随 /api/config 一次返回，不新增首屏请求
    publicStats: await publicStats(c.env),
    // 页脚备案链接：首次部署即显示（审核要求），后台可覆盖；管理员主动清空则隐藏
    footerIcpHtml: s.footer_icp_html === undefined ? DEFAULT_FOOTER_ICP_HTML : String(s.footer_icp_html),
    // 页脚联系方式：首次部署即显示（Telegram 邀请链接），后台可覆盖；管理员主动清空则隐藏
    footerContactHtml: s.footer_contact_html === undefined ? DEFAULT_FOOTER_CONTACT_HTML : String(s.footer_contact_html),
    // 仅名单，不含任何 AI 接口地址或密钥
    aiReviewRoots: String(s.ai_review_roots || 'v-1.top').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    dnsUnlimitedRoots: String(s.dns_unlimited_roots || 'v-1.top').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    aiStatus: ai ? {
      enabled: ai.enabled,
      ready: ai.configured,
      provider: ai.provider,
      roots: ai.roots,
      model: ai.model || '',
      modelSelected: !!ai.model,
    } : { enabled: false, ready: false, provider: 'custom', roots: [], model: '', modelSelected: false },
    // 邮箱验证码：mailOk 表示邮件服务已配置（可发送），verifyRequired 表示后台开了注册验证
    mailOk,
    mailVerifyRequired: verifyRequired,
    verifyRequired: verifyRequired && mailOk,
  };
}

/* 公开配置：整响应缓存 30 秒 + 浏览器私有缓存 30 秒。
   所有字段都是公开配置，不含登录态数据，可安全跨请求复用。 */
app.get('/api/config', async (c) => {
  /* 后台保存后前端会带 ?_=<ts> 强制刷新：必须绕过 isolate 缓存，
     否则落到旧 isolate 会返回 30 秒内的旧配置，破坏「保存即生效」。 */
  const bypass = !!c.req.query('_');
  const hit = bypass ? null : getConfigCache();
  const data = hit ?? await buildConfigData(c);
  if (!hit) setConfigCache(data);
  const res = ok(c, data);
  res.headers.set('Cache-Control', CONFIG_CACHE_CONTROL);
  return res;
});


// 公开统计（与 /api/config 同源同口径，便于根域名静态页 / 第三方读取）
app.get('/api/stats', async (c) => {
  const res = ok(c, await publicStats(c.env));
  res.headers.set('Cache-Control', 'public, max-age=60');
  return res;
});

// 认证
/* NodeLoc OAuth 必须先于 /api/auth 挂载：Hono 按注册顺序匹配，
   否则 /api/auth 子应用会先把 /nodeloc/start 吞成 404。
   同时注册 /oauth/nodeloc 前缀，便于在 NodeLoc 应用里登记直观的回调地址。 */
app.route('/api/auth/nodeloc', nodelocRoutes);
app.route('/oauth/nodeloc', nodelocRoutes);
/* GitHub OAuth 同样必须先于 /api/auth 挂载，否则会被子应用吞成 404。
   回调地址在 GitHub OAuth App 里登记为 https://<域名>/oauth/github/callback。 */
app.route('/api/auth/github', githubRoutes);
app.route('/oauth/github', githubRoutes);
app.route('/api/auth', authRoutes);
/* 第三方域名接入（外部域名）：独立表，不参与公开统计聚合 */
app.route('/api/external-domains', externalDomainRoutes);
// 第三方邮箱注册申请：公开，不需要登录（管理员审批接口在 /api/admin 下）
app.route('/api', emailRequestRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api', termsRoutes);
// WHOIS 公开查询（无需登录）
app.route('/api', whoisRoutes);
// 用户案例展示：公开只读，默认不展示，只有用户主动开启的域名会出现
app.route('/api', showcaseRoutes);

// 需要登录的接口
// 滑块验证独立前缀也要登录：未登录领不到挑战，也就没法为别人刷票据
app.use('/api/captcha', requireAuth);
app.use('/api/captcha/*', requireAuth);
app.use('/api/subdomains/*', requireAuth);
app.use('/api/points/*', requireAuth);
app.use('/api/delegation/*', requireAuth);
app.use('/api/records/*', requireAuth);
app.use('/api/soa', requireAuth);
app.use('/api/admin/*', requireAuth, requireAdmin);
app.use('/api/redeem/*', requireAuth);
app.use('/api/chat/*', requireAuth);
app.use('/api/profile/*', requireAuth);
app.use('/api/tickets/*', requireAuth);
app.use('/api/transfer/*', requireAuth);

// 独立前缀，且必须早于 recordRoutes 的 /subdomains/:id/verify：
// 旧 /api/subdomains/captcha/verify 会被 :id 当成域名查库，回「子域名不存在」
app.route('/api/captcha', captchaRoutes);
app.route('/api', recordRoutes);
app.route('/api/profile', profileRoutes);
app.route('/api/tickets', ticketRoutes);
app.route('/api/transfer', transferRoutes);
app.route('/api/points', pointRoutes);
app.route('/api/subdomains', subdomainRoutes);
// NS 委派：/api/delegation/providers 与 /api/subdomains/:id/delegation
app.route('/api/delegation', delegationRoutes);
app.route('/api/subdomains', delegationRoutes);
app.route('/api/admin', adminRoutes);
/* 数据备份：子域名 / 用户 CSV + 站点设置 JSON，可重新汇入（仅管理员） */
app.route('/api/admin/backup', backupRoutes);
app.route('/api/redeem', redeemRoutes);
app.route('/api/chat', chatRoutes);

// 滥用举报：提交与配置公开，管理端点要求管理员
app.use('/api/abuse/admin', requireAuth, requireAdmin);
app.use('/api/abuse/admin/*', requireAuth, requireAdmin);
app.use('/api/abuse/mine', requireAuth);
app.route('/api/abuse', abuseRoutes);

// API 兜底
app.all('/api/*', (c) => fail(c, '接口不存在', 404));

// 静态资源：run_worker_first = true 时由 Worker 回落到 ASSETS
// 注意：不要自己改写路径（补 index.html、去 .html 等）。
// ASSETS 自带规范化（/xxx.html ⇄ /xxx），Worker 再改一次就会形成自指 307 循环。
/* SPA 回落：Vite 只产出一个 index.html，所有页面路径都由 React 接管。
   注意：静态资源（/assets、/css、/img…）仍原样交给 ASSETS。
   清单来自 lib/spaRoutes.ts（唯一来源），不再手写第二份 —— 以前 /report
   与 /abuse 只加在前端 ROUTES、没加进这里，直接打开就被 ASSETS 判 404
   空 body，整页白屏。新增页面只需改 SPA_PAGE_NAMES。 */
const SPA_PATHS = new Set(spaFallbackPaths());
app.all('*', async (c) => {
  const reqUrl = new URL(c.req.url);
  const path = reqUrl.pathname.replace(/\/+$/, '') || '/';
  // 根域名落地页由 TypeScript 模板直出：两个域名既可以指到本 Worker，
  // 也可以 npm run emit:root-pages 导出后继续挂静态托管，不必再往仓库放 .html。
  if (path === '/' || path === '/index.html') {
    const rootPage = rootPageFor(reqUrl.hostname);
    if (rootPage) return c.html(rootPage);
  }
  /* 服务文档：VitePress 静态站（产物由 scripts/copy-docs.ts 并入
     dist/client/docs/，base = /docs/）。
     注意：不要再自己改写 /docs → /docs/index.html。ASSETS 自带规范化会把
     /docs/index.html 301 回 /docs/，而 /docs/ 进 Worker 后尾斜杠被去掉又成
     /docs，浏览器侧就无限重定向（Safari 直接报「太多重新导向」）。
     统一经 docsAsset() 在 Worker 内部消化 3xx，只外吐 200/404。
     SPA_PATHS 里仍留 docs 作兜底，但这个分支更靠前，不会走 React 外壳。 */
  if (path === '/docs' || path === '/docs/') return docsAsset(c, '/docs/');
  if (path === '/docs.html') return c.redirect('/docs/', 302);
  if (path.startsWith('/docs/')) return docsAsset(c, reqUrl.pathname);
  if (SPA_PATHS.has(path) || SPA_PATHS.has(path + '.html')) {
    const url = new URL('/', c.req.url);
    return c.env.ASSETS.fetch(new Request(url, c.req.raw));
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.notFound((c) => fail(c, '页面不存在', 404));

/**
 * 定时触发：每小时整点把所有待审域名重新交给 AI 判定一次
 * （wrangler.toml [triggers] crons = ["0 * * * *"]）。
 * 除了 cron，新申请提交时也会立即跑同一套批处理，所以网关偶尔超时
 * 留下的 pending 不会被永久挂住。两条路径靠 ai_claim_at 原子锁互斥，
 * 不会重复调用模型或重复批准。
 */
/* ctx / scheduledController 由 Workers 运行时提供，形状由运行时保证。
   这里用 any 承接，避免依赖全局类型声明（本地无 workers-types 时会误报
   TS2304，而 CI 已把 TS2304 设为阻断项）。 */
export default {
  fetch: (request: Request, env: any, ctx: any) => app.fetch(request, env, ctx),
  async scheduled(_controller: any, env: any, ctx: any) {
    ctx.waitUntil(runAiReviewBatch(env, 'cron'));
  },
};
