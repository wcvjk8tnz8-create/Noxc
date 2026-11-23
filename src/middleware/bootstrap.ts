/**
 * 请求引导 · 把原来散在 index.ts 的 4 个 app.use('*') 收成一处
 *
 * 为什么要收：那 4 个中间件对**所有**请求生效，包括 /assets/*.js、/img/*、
 * /docs/*。一个页面加载十几个静态资源，每个都跑 mergeRootEnv 的 4 次
 * settings 查询 + 带 cookie 时一次 sessions JOIN —— 请求量最大的那一类
 * 反而最费 D1，正是 1.52M/5M 的主要来源。
 *
 * 分层规则（唯一来源，别再各写各的）：
 *   静态资源        → 整段跳过，0 次 D1
 *   /api/*、/oauth/* → 需要登录态，跑 loadUser
 *   其余 HTML 页面   → 不查登录态（React 壳自己调 /api 拿），只合并根域名配置
 *
 * 配置读取统一走 settingsCache（isolate 缓存 + 写失效），所以非静态请求
 * 的 mergeRootEnv 在缓存命中时也是 0 次 D1。
 */
import { mergeRootEnv } from '../lib/rootStore.js';
import { ensureMigrations } from '../lib/runtimeMigrations.js';
import { invalidateSettings } from '../lib/settingsCache.js';
import { loadUser } from './auth.js';

/** 静态资源路径：Worker 只需把它交给 ASSETS，不需要任何数据库上下文 */
const ASSET_EXT = /\.(?:css|js|mjs|map|json|txt|xml|png|jpe?g|webp|gif|ico|svg|woff2?|ttf|otf|eot|mp4|webmanifest)$/i;
const ASSET_PREFIX = /^\/(?:assets|img|css|js|fonts|static|docs)\//i;
const ASSET_FILE = /^\/(?:favicon\.ico|robots\.txt|sitemap\.xml|manifest\.webmanifest|apple-touch-icon\.png)$/i;

export function isStaticAsset(path: string): boolean {
  return ASSET_EXT.test(path) || ASSET_PREFIX.test(path) || ASSET_FILE.test(path);
}

/** 纯公开接口：不读登录态，连一次 sessions JOIN 都省掉。
 *  只列确定不依赖 c.get('user') 的探针 / 配置 / 头像；
 *  /api/abuse/mine、/api/subdomains 等受 requireAuth 保护的路径一律不进这张表。 */
const PUBLIC_API_EXACT = new Set(['/api/health', '/api/config', '/api/stats']);
const PUBLIC_API_PREFIX = /^\/api\/avatar\//;

/** 需要服务端登录态的路径 */
export function needsUser(path: string): boolean {
  if (PUBLIC_API_EXACT.has(path) || PUBLIC_API_PREFIX.test(path)) return false;
  return path.startsWith('/api/') || path.startsWith('/oauth/');
}

export async function bootstrap(c: any, next: () => Promise<void>): Promise<any> {
  let path = '/';
  let fresh = false;
  try {
    const u = new URL(c.req.url);
    path = u.pathname;
    fresh = u.searchParams.has('_');
  } catch { /* 畸形 URL：按非静态处理，后续路由自己报错 */ }

  // 静态资源：连 c.set 都不做，彻底零 D1
  if (isStaticAsset(path)) return next();

  // 后台保存配置后前端带 ?_= 刷新：强制绕过本地配置缓存，保证「保存即生效」
  if (fresh) invalidateSettings();

  await ensureMigrations(c.env);

  if (needsUser(path)) await loadUser(c);
  else c.set('user', null);

  // 动态根域名合并（后台导入 / 移除）。loadExtra 现在走 settingsCache，命中 0 次 D1。
  try {
    const merged = await mergeRootEnv(c.env);
    if (merged) {
      Object.assign(c.env, {
        ROOT_DOMAINS: merged.ROOT_DOMAINS,
        ROOT_DOMAIN: merged.ROOT_DOMAIN,
        CF_ZONE_ID: merged.CF_ZONE_ID,
        CF_ZONE_IDS: merged.CF_ZONE_IDS,
      });
      try { c.env = merged; } catch { /* 受控属性：Object.assign 已兜底 */ }
    }
  } catch { /* settings 表尚未建立等异常：降级走原环境变量 */ }

  return next();
}
