import { mergeRootEnv, effectiveRootList } from './lib/rootStore.js';
import { DEFAULT_MESSAGE } from './lib/applyGate.js';
import { loadAiConfig } from './lib/aiReview.js';
import { parseRootCosts } from './lib/points.js';
import { runAiReviewBatch } from './lib/aiBatch.js';
import { emailRuleHint, emailRuleOf } from './lib/emailRule.js';
import { DEFAULT_FOOTER_ICP_HTML } from './lib/footerIcp.js';
import { DEFAULT_FOOTER_CONTACT_HTML } from './lib/footerContact.js';
import { reservedLabelsOf } from './lib/reserved.js';
import { publicStats } from './lib/publicStats.js';
import { nodelocEnabled } from './lib/nodeloc.js';
import { ensureCoreColumns } from './lib/showcase.js';
import { rootPageFor } from './html/rootPages.js';
import { docsHtml } from './html/docs.js';
import { Hono } from 'hono';
import { attachUser, requireAuth, requireAdmin } from './middleware/auth.js';
import { ok, fail, defaultQuotaOf } from './lib/util.js';
import { RECORD_TYPES, TTL_CHOICES, VERIFY_PRESETS, HOSTING_NS_PRESETS, TYPE_NAMES } from './lib/records.js';
import authRoutes from './routes/auth.js';
import nodelocRoutes from './routes/nodeloc.js';
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
import emailRequestRoutes from './routes/emailRequests.js';
import showcaseRoutes from './routes/showcase.js';

const app = new Hono();

// /api/xxx/ 与 /api/xxx 等价（去掉结尾斜杠后重新分发）
/* 老库补列：任何请求进来先跑一次（模块级缓存，成功即不再查 PRAGMA）。
   以前靠 schema.sql 重建表补列，每次部署都会清空用户案例展示开关。 */
app.use('*', async (c, next) => { await ensureCoreColumns(c.env); await next(); });

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

app.use('*', attachUser);

/**
 * 动态根域名：把后台「Spaceship 导入」添加的域名合并进本次请求的 env。
 * 这样 roots.ts（纯函数）与所有既有调用点都不用改，配置保存后下一个请求即生效。
 * 无动态配置时不做任何赋值，零开销。
 */
app.use('*', async (c, next) => {
  try {
    const merged = await mergeRootEnv(c.env);
    if (merged) {
      // 关键：Hono 的 c.env 在部分运行时是受控属性，直接替换引用不一定会
      // 传递到后续路由；后台导入的根域名因此会「有些加载不出来」。
      // 同时把合并结果写回原对象，保证所有 c.env 读取都拿到完整列表。
      Object.assign(c.env, {
        ROOT_DOMAINS: merged.ROOT_DOMAINS,
        ROOT_DOMAIN: merged.ROOT_DOMAIN,
        CF_ZONE_ID: merged.CF_ZONE_ID,
        CF_ZONE_IDS: merged.CF_ZONE_IDS,
      });
      try { c.env = merged; } catch {}
    }
  } catch { /* settings 表尚未建立等异常：降级走原环境变量，不影响站点 */ }
  return next();
});

/* 旧链接 /docs/dnshe 一律回到直出页的 DNSHE 章节，不留 404。
   /docs 本体在下方 app.all('*') 里按 path 由 TypeScript 模板直出。 */
app.get('/docs/dnshe', (c) => c.redirect('/docs#dnshe', 302));
app.get('/docs/dnshe.html', (c) => c.redirect('/docs#dnshe', 302));

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
app.use('/api/config', publicCors);
app.use('/api/stats', publicCors);

// 前端初始化配置
// 公开配置（含站点品牌，登录页也要用）
app.get('/api/config', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('site_name','logo_url','favicon_url','footer_icp_html','footer_contact_html','font_body','font_display','mail_verify_required','mail_provider','mail_from','apply_paused','apply_paused_message','ai_review_roots','dns_unlimited_roots','root_point_costs','domain_cost','short_domain_cost','short_domain_len','default_quota')"
  ).all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
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
  return ok(c, {
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
    // 存储绑定状态：只给布尔值，方便一眼确认 KV / R2 是否已自动挂上
    kvBound: !!c.env.KV,
    avatarUpload: !!c.env.AVATARS,
    // 注册页后缀菜单据此显示每个后缀的积分（0 = Free，未配置 = 按全局规则）
    rootPointCosts: parseRootCosts(s.root_point_costs),
    pointRules: {
      domainCost: Number(s.domain_cost || 5) || 0,
      shortCost: Number(s.short_domain_cost || 35) || 0,
      shortLen: Number(s.short_domain_len || 1) || 1,
    },
    allowSignup: c.env.ALLOW_SIGNUP !== '0',
    requireApproval: c.env.REQUIRE_APPROVAL === '1',
    applyPaused: String(c.env.APPLY_PAUSED || s.apply_paused || '').trim() === '1',
    applyPausedMessage: String(s.apply_paused_message || '').trim() || DEFAULT_MESSAGE,
    recordTypes: TYPE_NAMES.map((k) => ({ key: k, ...RECORD_TYPES[k] })),
    ttlChoices: TTL_CHOICES,
    verifyPresets: VERIFY_PRESETS,
    // 托管服务 NS 预设：NS 也是普通 DNS 记录，前端不写死服务器名
    hostingNsPresets: HOSTING_NS_PRESETS,
    siteName: s.site_name || 'Noxc',
    logoUrl: s.logo_url || '/img/logo.jpg',
    faviconUrl: s.favicon_url || '/favicon.ico',
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
  });
});

// 公开统计（与 /api/config 同源同口径，便于根域名静态页 / 第三方读取）
app.get('/api/stats', async (c) => ok(c, await publicStats(c.env)));

// 认证
/* NodeLoc OAuth 必须先于 /api/auth 挂载：Hono 按注册顺序匹配，
   否则 /api/auth 子应用会先把 /nodeloc/start 吞成 404。
   同时注册 /oauth/nodeloc 前缀，便于在 NodeLoc 应用里登记直观的回调地址。 */
app.route('/api/auth/nodeloc', nodelocRoutes);
app.route('/oauth/nodeloc', nodelocRoutes);
app.route('/api/auth', authRoutes);
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
   注意：静态资源（/assets、/css、/img…）仍原样交给 ASSETS。 */
const SPA_PATHS = new Set([
  '/', '/index.html', '/home.html', '/dashboard.html', '/domain.html',
  '/register.html', '/whois.html', '/admin.html', '/checkin.html',
  '/rewards.html', '/chat.html', '/tickets.html', '/transfer.html',
  '/profile.html', '/terms.html', '/docs.html', '/showcase.html',
  '/login', '/login.html', '/home', '/dashboard', '/domain', '/register', '/whois',
  '/admin', '/checkin', '/rewards', '/chat', '/tickets', '/transfer',
  '/profile', '/terms', '/docs', '/showcase',
]);
app.all('*', async (c) => {
  const reqUrl = new URL(c.req.url);
  const path = reqUrl.pathname.replace(/\/+$/, '') || '/';
  // 根域名落地页由 TypeScript 模板直出：两个域名既可以指到本 Worker，
  // 也可以 npm run emit:root-pages 导出后继续挂静态托管，不必再往仓库放 .html。
  if (path === '/' || path === '/index.html') {
    const rootPage = rootPageFor(reqUrl.hostname);
    if (rootPage) return c.html(rootPage);
  }
  /* 服务文档：TypeScript 模板直出。纯阅读页不需要登录态、不需要
     refreshRuntime 那一串首屏接口，也不挂载 React —— 一个 HTML 请求就完，
     比走 SPA 快一截（用户反复反馈过切页 / 加载慢）。
     /docs 仍留在 SPA_PATHS 里作兜底：直出不可用时 ASSETS 回落不会 404。 */
  if (path === '/docs' || path === '/docs.html') return c.html(docsHtml);
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
