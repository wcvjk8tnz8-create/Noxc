/**
 * Noxc · 用户案例展示积分奖励
 *
 * 规则（2026-11-22）：
 *   · 账号首次把「任意一个已开通域名」开启展示 → 一次性 +6000 积分（后台可改）
 *   · 每个账号只发一次：再开、换域名、关掉重开、重复提交都不叠加
 *   · 关闭展示 **不回收**（与 NodeLoc / GitHub Star 奖励口径一致）
 *   · 只有 status='approved' 的域名算「真的展示了」——展示页本身也按这个过滤
 *   · 管理员 / 无限积分账号跳过
 *   · 存量已开启展示的用户，下次访问积分接口自动补发，不用重新点一次开关
 *
 * 防并发：INSERT OR IGNORE 用 user_id 主键，只有抢到插入的那个请求才入账；
 * 入账失败会删掉占位记录，下次可重试，绝不出现「记了已领但没加分」。
 *
 * 建表用 CREATE TABLE IF NOT EXISTS（写入 schema.sql，运行时再兜底一次），
 * 绝不 RENAME / DROP 业务表 —— 展示开关曾因重建表被反复清空。
 */

import { ensurePoints, addPoints, UNLIMITED_POINTS } from './points.js';
import {
  POINT_DEFAULTS,
  SHOWCASE_REWARD_POINTS,
  SHOWCASE_REWARD_CAP,
} from './pointDefaults.js';

let tableReady = false;

async function ensureRewardTable(db: any): Promise<void> {
  if (tableReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS showcase_rewards (
    user_id     INTEGER PRIMARY KEY,
    amount      INTEGER NOT NULL DEFAULT 0,
    fqdn        TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  )`).run().catch(() => null);
  tableReady = true;
}

/** 当前生效的奖励积分（后台 settings 优先，非法值回落内置默认） */
export async function showcaseRewardOf(env: any): Promise<number> {
  try {
    const r: any = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'showcase_reward_points'"
    ).first();
    const n = Number(r?.value);
    if (Number.isFinite(n) && n >= 0 && n <= SHOWCASE_REWARD_CAP) return Math.floor(n);
  } catch { /* 老库尚无该 key */ }
  return SHOWCASE_REWARD_POINTS;
}

/** 一次性读取奖励值与积分初始化口径，避免在 lib 里 import routes 造成循环依赖 */
async function rewardConfig(env: any) {
  const cfg = {
    amount: SHOWCASE_REWARD_POINTS,
    initial: POINT_DEFAULTS.initial as number,
    domainCost: POINT_DEFAULTS.domainCost as number,
  };
  try {
    const r: any = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE key IN ('showcase_reward_points','initial_points','domain_cost')"
    ).all();
    for (const row of r?.results || []) {
      const n = Number(row?.value);
      if (!Number.isFinite(n) || n < 0) continue;
      if (row.key === 'showcase_reward_points' && n <= SHOWCASE_REWARD_CAP) cfg.amount = Math.floor(n);
      else if (row.key === 'initial_points') cfg.initial = Math.floor(n);
      else if (row.key === 'domain_cost') cfg.domainCost = Math.floor(n);
    }
  } catch { /* 用内置默认 */ }
  return cfg;
}

/**
 * 检查并发放奖励。
 * @returns 本次实际入账的积分；0 = 没资格 / 已领过 / 管理员 / 奖励设为 0 / 并发未抢到
 */
export async function ensureShowcaseReward(env: any, userId: number): Promise<number> {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return 0;
  const db = env.DB;
  await ensureRewardTable(db);

  const already: any = await db.prepare(
    'SELECT amount FROM showcase_rewards WHERE user_id = ?'
  ).bind(uid).first().catch(() => null);
  if (already) return 0;

  const shown: any = await db.prepare(
    "SELECT fqdn FROM subdomains WHERE user_id = ? AND showcase = 1 AND status = 'approved' ORDER BY id ASC LIMIT 1"
  ).bind(uid).first().catch(() => null);
  if (!shown) return 0;

  const user: any = await db.prepare(
    'SELECT role FROM users WHERE id = ?'
  ).bind(uid).first().catch(() => null);
  if (!user || String(user.role) === 'admin') return 0;

  const cfg = await rewardConfig(env);
  if (cfg.amount <= 0) return 0;   // 后台设 0 = 暂时关闭奖励，以后调回来仍可领

  const ins: any = await db.prepare(
    'INSERT OR IGNORE INTO showcase_rewards (user_id, amount, fqdn, created_at) VALUES (?,?,?,?)'
  ).bind(uid, cfg.amount, String(shown.fqdn || ''), Date.now()).run();
  if (Number(ins?.meta?.changes || 0) <= 0) return 0;   // 并发下被别的请求抢先

  let before: number | null = null;
  try {
    // 先按站点正常口径初始化，避免「首次动作就是开展示」丢掉老域名补偿
    await ensurePoints(db, uid, { initial: cfg.initial, domainCost: cfg.domainCost });
    const cur: any = await db.prepare(
      'SELECT points FROM user_points WHERE user_id = ?'
    ).bind(uid).first().catch(() => null);
    if (cur && Number(cur.points) === UNLIMITED_POINTS) {
      await db.prepare('UPDATE showcase_rewards SET amount = 0 WHERE user_id = ?')
        .bind(uid).run().catch(() => null);
      return 0;
    }
    before = cur ? Number(cur.points) : null;
    await addPoints(db, uid, cfg.amount, 'showcase',
      `用户案例展示奖励（${String(shown.fqdn || '')}）`);
    return cfg.amount;
  } catch {
    /* addPoints 分两步写（余额 + 流水），第二步失败会留下「余额涨了但没记流水」。
       回滚余额再撤掉占位，保证重试时不会重复累加。 */
    if (before === null) {
      await db.prepare('DELETE FROM user_points WHERE user_id = ?')
        .bind(uid).run().catch(() => null);
    } else {
      await db.prepare('UPDATE user_points SET points = ?, updated_at = ? WHERE user_id = ?')
        .bind(before, Date.now(), uid).run().catch(() => null);
    }
    await db.prepare('DELETE FROM showcase_rewards WHERE user_id = ?')
      .bind(uid).run().catch(() => null);
    return 0;
  }
}
