/**
 * 首页公开统计：总数 + 按根域名拆分。
 *
 * 只返回聚合数字，不含任何用户邮箱、域名明细或后台数据。
 *
 * ── 为什么改成「持久化快照」（2026-11-23 D1 读取超限事故）──────────
 * 旧版只做 30 秒 isolate 内缓存：Cloudflare 每次请求可能落到不同 isolate，
 * 每个 isolate 过期后都要跑 GROUP BY 全表扫 subdomains（N 行 = N rows read），
 * 外加两个 COUNT。/api/config 又被每个页面 / 每次切页请求，几千个域名时
 * 每几十秒就吃掉几千 rows read，免费版 5M/天 很快打满，站点 500。
 *
 * 现在把聚合结果写进 settings 表的一行 JSON，读取只花 **1 row read**：
 *   - 快照 10 分钟才重算一次（重算仍是一次全表扫描，但频率降两个数量级）
 *   - 多个 isolate 共享同一行，不再各自扫全表
 *   - 域名开通 / 审核 / 删除写路径调用 invalidatePublicStats() 主动失效，
 *     数字最多延迟一个快照周期，正常操作即时刷新
 *   - isolate 内再叠 30 秒内存缓存，连那 1 行都不用反复读
 * 表未建 / 快照读写失败一律静默降级为内存缓存 + 重算，绝不让首页挂掉。
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

/** 快照键：复用 settings 表，不新增表、不需要迁移 */
const SNAPSHOT_KEY = 'public_stats_snapshot';
/** 快照有效期：环境变量可调（秒），默认 10 分钟 */
function snapshotTtl(env: any): number {
  const n = Number(env?.PUBLIC_STATS_TTL || 600);
  return (Number.isFinite(n) && n >= 30 ? n : 600) * 1000;
}
/** isolate 内缓存：连快照那 1 行都不重复读 */
const MEM_TTL = 30_000;

let cached: { at: number; value: PublicStats } | null = null;

type Snapshot = { at: number; value: PublicStats };

async function readSnapshot(env: any): Promise<Snapshot | null> {
  try {
    const row: any = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'public_stats_snapshot'"
    ).first();
    if (!row || !row.value) return null;
    const parsed = JSON.parse(String(row.value));
    if (!parsed || !parsed.value || !Array.isArray(parsed.value.roots)) return null;
    return { at: Number(parsed.at) || 0, value: parsed.value as PublicStats };
  } catch { return null; }   // 表未建 / 旧 mock / D1 抖动
}

async function writeSnapshot(env: any, value: PublicStats): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO settings(key, value) VALUES ('public_stats_snapshot', ?) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
      .bind(JSON.stringify({ at: Date.now(), value }))
      .run();
  } catch { /* 写失败只影响刷新频率，不影响本次返回 */ }
}

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

/** 真正算一次：两个 COUNT + 一次 GROUP BY（全表扫描），只在快照过期时跑 */
async function compute(env: any): Promise<PublicStats> {
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
  return value;
}

export async function publicStats(env: any): Promise<PublicStats> {
  if (cached && Date.now() - cached.at < MEM_TTL) return cached.value;

  const snap = await readSnapshot(env);
  if (snap && snap.at && Date.now() - snap.at < snapshotTtl(env)) {
    cached = { at: Date.now(), value: snap.value };
    return snap.value;                       // 只花了 1 row read
  }

  const value = await compute(env);
  cached = { at: Date.now(), value };
  await writeSnapshot(env, value);
  return value;
}

/**
 * 写路径主动失效：域名开通 / 审核 / 释放 / 新用户注册后调用。
 * 删快照行 + 清 isolate 缓存，下一次 /api/config 立即重算并回写。
 * 任何失败都吞掉，绝不阻断主业务。
 */
export async function invalidatePublicStats(env: any): Promise<void> {
  cached = null;
  try {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'public_stats_snapshot'").run();
  } catch { /* 表未建 / mock 环境 */ }
}

/** 测试用：清掉 isolate 缓存，便于连续校验不同数据 */
export function resetPublicStatsCache(): void { cached = null; }
