/**
 * Noxc · 组合任务积分奖励（绑定 NodeLoc + Star 项目）
 *
 * 规则（2026-11-23）：
 *   · 必须**同时**完成两项才发：① 绑定 NodeLoc ② 给项目点 Star 并领取 Star 奖励
 *   · 只完成其中一项不发；两项都完成也只发一次，解绑 / 重复领取都不叠加
 *   · 一次性 +3000 积分（后台 settings.combo_reward_points 可改，设 0 = 关闭）
 *   · 管理员 / 无限积分账号跳过；已领过不回收
 *   · 存量用户（功能上线前就已绑定 + 领过 Star）访问积分接口自动补发
 *
 * 完成判据刻意复用「已有的真实校验结果」，不重复请求第三方：
 *   · NodeLoc 绑定 → oauth_bindings(provider='nodeloc')
 *   · Star 完成    → oauth_quota_grants(provider='github-star')，该记录只有
 *     /claim-star 实时向 GitHub 复核 204 后才写入，本身就是可信的完成凭据。
 *
 * 防并发与回滚口径完全对齐 showcaseReward.ts：user_id 主键 + INSERT OR IGNORE，
 * 入账失败删占位，绝不出现「记了已领但没加分」。
 * 建表用 CREATE TABLE IF NOT EXISTS（schema.sql + 运行时兜底），绝不重建业务表。
 */

import { readSetting, pickSettings } from './settingsCache.js';
import { ensurePoints, addPoints, UNLIMITED_POINTS } from './points.js';
import {
  POINT_DEFAULTS,
  COMBO_REWARD_POINTS,
  COMBO_REWARD_CAP,
} from './pointDefaults.js';
import { NODELOC_PROVIDER } from './nodeloc.js';
import { GITHUB_STAR_PROVIDER } from './github.js';

let tableReady = false;

async function ensureRewardTable(db: any): Promise<void> {
  if (tableReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS combo_rewards (
    user_id     INTEGER PRIMARY KEY,
    amount      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  )`).run().catch(() => null);
  tableReady = true;
}

/** 供回归模拟冷启动 isolate */
export function __resetComboRewardForTest(): void { tableReady = false; }

/** 当前生效的奖励积分（后台 settings 优先，非法值回落内置默认） */
export async function comboRewardOf(env: any): Promise<number> {
  try {
    const n = Number(await readSetting(env, 'combo_reward_points'));
    if (Number.isFinite(n) && n >= 0 && n <= COMBO_REWARD_CAP) return Math.floor(n);
  } catch { /* 老库尚无该 key */ }
  return COMBO_REWARD_POINTS;
}

/** 一次性读取奖励值与积分初始化口径，避免在 lib 里 import routes 造成循环依赖 */
async function rewardConfig(env: any) {
  const cfg = {
    amount: COMBO_REWARD_POINTS,
    initial: POINT_DEFAULTS.initial as number,
    domainCost: POINT_DEFAULTS.domainCost as number,
  };
  try {
    const s = await pickSettings(env, ['combo_reward_points', 'initial_points', 'domain_cost']);
    for (const [key, value] of Object.entries(s)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) continue;
      if (key === 'combo_reward_points' && n <= COMBO_REWARD_CAP) cfg.amount = Math.floor(n);
      else if (key === 'initial_points') cfg.initial = Math.floor(n);
      else if (key === 'domain_cost') cfg.domainCost = Math.floor(n);
    }
  } catch { /* 用内置默认 */ }
  return cfg;
}

export interface ComboRewardStatus {
  nodelocLinked: boolean;
  starClaimed: boolean;
  allDone: boolean;
  claimed: boolean;
  amount: number;
  points: number;
}

/** 三个条件并发查一次，供「奖励中心」展示任务进度，不发任何奖励。 */
export async function comboRewardStatus(env: any, userId: number): Promise<ComboRewardStatus> {
  const uid = Number(userId);
  const db = env.DB;
  await ensureRewardTable(db);
  const [nl, star, got, points] = await Promise.all([
    db.prepare('SELECT 1 AS ok FROM oauth_bindings WHERE provider = ? AND user_id = ? LIMIT 1')
      .bind(NODELOC_PROVIDER, uid).first().catch(() => null),
    db.prepare('SELECT 1 AS ok FROM oauth_quota_grants WHERE provider = ? AND user_id = ? LIMIT 1')
      .bind(GITHUB_STAR_PROVIDER, uid).first().catch(() => null),
    db.prepare('SELECT amount FROM combo_rewards WHERE user_id = ?')
      .bind(uid).first().catch(() => null),
    comboRewardOf(env),
  ]);
  const nodelocLinked = !!nl;
  const starClaimed = !!star;
  return {
    nodelocLinked,
    starClaimed,
    allDone: nodelocLinked && starClaimed,
    claimed: !!got,
    amount: Number(got?.amount ?? 0),
    points,
  };
}

/**
 * 检查并发放奖励。
 * @returns 本次实际入账的积分；0 = 没集齐 / 已领过 / 管理员 / 奖励设为 0 / 并发未抢到
 */
export async function ensureComboReward(env: any, userId: number): Promise<number> {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return 0;
  const db = env.DB;
  await ensureRewardTable(db);

  /* 「完成所有才算」：任一条件缺失立即退出，且不写任何占位记录 */
  const [nl, star] = await Promise.all([
    db.prepare('SELECT 1 AS ok FROM oauth_bindings WHERE provider = ? AND user_id = ? LIMIT 1')
      .bind(NODELOC_PROVIDER, uid).first().catch(() => null),
    db.prepare('SELECT 1 AS ok FROM oauth_quota_grants WHERE provider = ? AND user_id = ? LIMIT 1')
      .bind(GITHUB_STAR_PROVIDER, uid).first().catch(() => null),
  ]);
  if (!nl || !star) return 0;

  const already: any = await db.prepare(
    'SELECT amount FROM combo_rewards WHERE user_id = ?'
  ).bind(uid).first().catch(() => null);
  if (already) return 0;

  const user: any = await db.prepare(
    'SELECT role FROM users WHERE id = ?'
  ).bind(uid).first().catch(() => null);
  if (!user || String(user.role) === 'admin') return 0;

  const cfg = await rewardConfig(env);
  if (cfg.amount <= 0) return 0;   // 后台设 0 = 暂时关闭奖励，以后调回来仍可领

  const ins: any = await db.prepare(
    'INSERT OR IGNORE INTO combo_rewards (user_id, amount, created_at) VALUES (?,?,?)'
  ).bind(uid, cfg.amount, Date.now()).run();
  if (Number(ins?.meta?.changes || 0) <= 0) return 0;   // 并发下被别的请求抢先

  let before: number | null = null;
  try {
    // 先按站点正常口径初始化，避免「首次动作就是领奖励」丢掉老域名补偿
    await ensurePoints(db, uid, { initial: cfg.initial, domainCost: cfg.domainCost });
    const cur: any = await db.prepare(
      'SELECT points FROM user_points WHERE user_id = ?'
    ).bind(uid).first().catch(() => null);
    if (cur && Number(cur.points) === UNLIMITED_POINTS) {
      await db.prepare('UPDATE combo_rewards SET amount = 0 WHERE user_id = ?')
        .bind(uid).run().catch(() => null);
      return 0;
    }
    before = cur ? Number(cur.points) : null;
    await addPoints(db, uid, cfg.amount, 'combo',
      `组合任务奖励（NodeLoc 绑定 + Star 项目）`);
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
    await db.prepare('DELETE FROM combo_rewards WHERE user_id = ?')
      .bind(uid).run().catch(() => null);
    return 0;
  }
}
