/**
 * 首页公开统计：只返回两个总数，不含任何用户邮箱、域名明细或后台数据。
 * 表尚未建立（首次部署 / D1 抖动）时降级为 0，不拖垮 /api/config。
 * 30 秒 isolate 内缓存：/api/config 每次切页都被请求，两个 COUNT 不该反复打库。
 */
export type PublicStats = { users: number; domains: number };

let cached: { at: number; value: PublicStats } | null = null;
const TTL = 30_000;

export async function publicStats(env: any): Promise<PublicStats> {
  if (cached && Date.now() - cached.at < TTL) return cached.value;
  let value: PublicStats = { users: 0, domains: 0 };
  try {
    const [u, d] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM subdomains WHERE status = 'approved'").first(),
    ]);
    value = {
      users: Number(u?.n || 0) || 0,
      domains: Number(d?.n || 0) || 0,
    };
  } catch { /* 表未建 / D1 暂不可用：显示 0，不影响首页 */ }
  cached = { at: Date.now(), value };
  return value;
}
