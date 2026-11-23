/**
 * /api/config 整响应缓存 · 减少 D1 读取（2026-11-23 D1 5M 超限事故）
 *
 * 一次 /api/config 内部要跑十几个 settings 单点 SELECT，外加公开统计。
 * 旧版每个页面 mount、每次切页都重新算一遍：前台 loadBranding 还是
 * stale-while-revalidate，缓存命中仍会在后台再发一次请求。
 *
 * 这里做两层节流：
 *   1) isolate 级：30 秒内重复请求直接复用整份 JSON，不碰 D1
 *   2) 浏览器侧：Cache-Control: private, max-age=30，切页不再重复发请求
 * 后台保存任何设置 / 根域名 / 暂停名单后调用 invalidatePublicConfig()，
 * 前端 resetBranding() 再带 cache-buster 强制拉一次，保证「保存即生效」。
 */
let cache: { at: number; data: any } | null = null;
export const CONFIG_TTL = 30_000;
export const CONFIG_CACHE_CONTROL = 'private, max-age=30';

export function getConfigCache(): any | null {
  return cache && Date.now() - cache.at < CONFIG_TTL ? cache.data : null;
}
export function setConfigCache(data: any): void { cache = { at: Date.now(), data }; }
export function invalidatePublicConfig(): void { cache = null; }
