/**
 * 按根域名限制「每个账号能注册几次」
 *
 * 后台「站点设置 → 按根域名设置每人注册次数」逐个后缀填：
 *   留空 = 不限制；-1 = 无限；0 = 禁止该后缀；正整数 = 累计次数上限。
 * 配置只影响之后的新申请，**不回溯历史**：已注册用户手里的域名一个都不动。
 *
 * 计数存在独立的 root_reg_counts 表里，与 subdomains 解耦：
 * 释放 / 删除域名不会退还次数，所以「只能注册 N 次」是真正的累计上限。
 * 管理员是「开通」不是申请：既不校验次数、也不累计（见 subdomains.ts）。
 *
 * 配置优先级：settings.root_reg_limits > 环境变量 ROOT_REG_LIMITS。
 */

export type RootRegLimits = Record<string, number>;

function normDomain(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
    .replace(/^\.+/, '').replace(/\.+$/, '')
    .replace(/^https?:\/\//i, '').split('/')[0];
}

/** 解析 "meoy.top:1,noxc.uk:-1"；忽略空白与无效项 */
export function parseRootRegLimits(raw: unknown): RootRegLimits {
  const out: RootRegLimits = {};
  const text = String(raw ?? '').replace(/[，、；\n\r]+/g, ',');
  for (const token of text.split(',')) {
    const part = String(token || '').trim();
    if (!part) continue;
    const i = part.lastIndexOf(':');
    if (i < 1) continue;
    const domain = normDomain(part.slice(0, i));
    const num = part.slice(i + 1).trim();
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) continue;
    if (!/^-?\d+$/.test(num)) continue;
    const n = Number(num);
    if (!Number.isFinite(n) || n < -1 || n > 10000) continue;
    out[domain] = Math.floor(n);
  }
  return out;
}

/** 规范化回写，避免后台输入框里堆垃圾字符 */
export function serializeRootRegLimits(map: RootRegLimits): string {
  return Object.keys(map).sort().map((d) => `${d}:${map[d]}`).join(',');
}

async function setting(env: any, key: string): Promise<string | undefined> {
  try {
    const row: any = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    return row ? String(row.value ?? '') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 取某个后缀的上限。
 *   null = 没配限制（不限制）
 *   -1   = 显式无限
 *   >=0  = 累计次数上限（0 = 禁止）
 */
export async function rootRegLimitOf(env: any, rootRaw: unknown): Promise<number | null> {
  const root = normDomain(rootRaw);
  if (!root) return null;
  const dbVal = await setting(env, 'root_reg_limits');
  const text = String(dbVal ?? '').trim() || String(env?.ROOT_REG_LIMITS || '').trim();
  const map = parseRootRegLimits(text);
  if (!Object.prototype.hasOwnProperty.call(map, root)) return null;
  return map[root];
}

/** 该用户在该后缀下已成功申请过多少次（独立累计表，释放不减） */
export async function userRootRegCount(db: any, userId: unknown, rootRaw: unknown): Promise<number> {
  const root = normDomain(rootRaw);
  if (!root) return 0;
  try {
    const row: any = await db.prepare(
      'SELECT count FROM root_reg_counts WHERE user_id = ? AND root_domain = ?'
    ).bind(Number(userId), root).first();
    return Math.max(0, Number(row?.count || 0));
  } catch {
    return 0; // 老库尚无计数表：降级为不限制，不阻断注册
  }
}

/** 一次成功申请后 +1；UPSERT 保证重复 / 并发都不会把计数改小 */
export async function bumpRootRegCount(db: any, userId: unknown, rootRaw: unknown, ts: number): Promise<void> {
  const root = normDomain(rootRaw);
  if (!root) return;
  try {
    await db.prepare(
      `INSERT INTO root_reg_counts (user_id, root_domain, count, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, root_domain) DO UPDATE SET
         count = root_reg_counts.count + 1,
         updated_at = excluded.updated_at`
    ).bind(Number(userId), root, Number(ts) || Date.now()).run();
  } catch {
    /* 计数失败不影响域名本身已注册成功 */
  }
}
