/**
 * 首页公开统计：总数 + 按根域名拆分。
 *
 * 只返回聚合数字，不含任何用户邮箱、域名明细或后台数据。
 * 表尚未建立（首次部署 / D1 抖动）时降级为 0，不拖垮 /api/config。
 * 30 秒 isolate 内缓存：/api/config 每次切页都被请求，COUNT 不该反复打库。
 *
 * roots 里会补上「生效根域名列表」中当前还没有已开通域名的后缀（0 / 0），
 * 这样首页展开看到的清单和注册页后缀选择器是同一份，不会少几个。
 * 老数据没有 root_domain 时从 fqdn 里截出第一个点之后的根域名。
 */
import { effectiveRootList } from './rootStore.js';

export type PublicRootStat = {
  domain: string;
  /** 该根域名下已开通（approved）的子域名数 */
  domains: number;
  /** 该根域名下注册过去重后的用户数 */
  users: number;
};

export type PublicStats = {
  users: number;
  domains: number;
  roots: PublicRootStat[];
  /** 已开通子域名最多的根域名；全为 0 时为 null（首页不标 HOT） */
  hottest: string | null;
};

let cached: { at: number; value: PublicStats } | null = null;
const TTL = 30_000;

const GROUP_SQL = `
  SELECT
    CASE
      WHEN COALESCE(root_domain, '') <> '' THEN lower(trim(root_domain))
      WHEN instr(fqdn, '.') > 0 THEN lower(substr(fqdn, instr(fqdn, '.') + 1))
      ELSE lower(fqdn)
    END AS d,
    COUNT(*) AS n,
    COUNT(DISTINCT user_id) AS u
  FROM subdomains
  WHERE status = 'approved'
  GROUP BY d
`;

export async function publicStats(env: any): Promise<PublicStats> {
  if (cached && Date.now() - cached.at < TTL) return cached.value;
  let value: PublicStats = { users: 0, domains: 0, roots: [], hottest: null };
  try {
    const [u, d, grouped] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM subdomains WHERE status = 'approved'").first(),
      env.DB.prepare(GROUP_SQL).all(),
    ]);

    const counts = new Map<string, { domains: number; users: number }>();
    for (const r of (grouped?.results || []) as any[]) {
      const key = String(r?.d ?? '').trim().toLowerCase();
      if (!key) continue;
      counts.set(key, {
        domains: Number(r?.n || 0) || 0,
        users: Number(r?.u || 0) || 0,
      });
    }

    // 把后台生效的后缀补齐，保证展开清单完整（0 / 0 也列出来）
    try {
      for (const r of await effectiveRootList(env)) {
        const key = String(r?.domain ?? '').trim().toLowerCase();
        if (key && !counts.has(key)) counts.set(key, { domains: 0, users: 0 });
      }
    } catch { /* 动态根域名读取失败：只展示已有统计，不影响首页 */ }

    const roots: PublicRootStat[] = [...counts.entries()]
      .map(([domain, v]) => ({ domain, domains: v.domains, users: v.users }))
      .sort((a, b) =>
        b.domains - a.domains || b.users - a.users || a.domain.localeCompare(b.domain));

    value = {
      users: Number(u?.n || 0) || 0,
      domains: Number(d?.n || 0) || 0,
      roots,
      // 并列时取字典序靠前的那个，保证结果稳定、不会每次刷新乱跳
      hottest: roots.length && roots[0].domains > 0 ? roots[0].domain : null,
    };
  } catch { /* 表未建 / D1 暂不可用：显示 0，不影响首页 */ }
  cached = { at: Date.now(), value };
  return value;
}

/** 测试用：清掉 isolate 缓存，便于连续校验不同数据 */
export function resetPublicStatsCache(): void { cached = null; }
