import { Hono } from 'hono';
import { POINT_DEFAULTS } from '../lib/pointDefaults.js';
import { ensureShowcaseReward } from '../lib/showcaseReward.js';
import { ensureComboReward, comboRewardStatus } from '../lib/comboReward.js';
import { ok, fail, now, audit } from '../lib/util.js';
import {
  UNLIMITED_POINTS,
  getPoints,
  ensurePoints,
  addPoints,
  todayStr,
  hasCheckedIn,
  recordCheckin,
  domainCost,
  parseRootCosts,
} from '../lib/points.js';

const app = new Hono();

/** 读取积分规则设置 */
export async function pointRules(env) {
  const rows = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN
     ('checkin_points','domain_cost','short_domain_cost','short_domain_len','initial_points','root_point_costs')`
  ).all();
  const m = {};
  for (const r of rows.results || []) m[r.key] = r.value;
  const num = (k, d) => {
    const n = Number(m[k]);
    return Number.isFinite(n) && m[k] !== undefined && m[k] !== '' ? n : d;
  };
  return {
    checkin: Math.max(0, num('checkin_points', POINT_DEFAULTS.checkin)),
    domainCost: Math.max(0, num('domain_cost', POINT_DEFAULTS.domainCost)),
    shortCost: Math.max(0, num('short_domain_cost', POINT_DEFAULTS.shortCost)),
    shortLen: Math.max(1, num('short_domain_len', POINT_DEFAULTS.shortLen)),
    initial: Math.max(0, num('initial_points', POINT_DEFAULTS.initial)),
    rootCosts: parseRootCosts(m.root_point_costs),
  };
}

/** 我的积分概览（登录即可访问） */
app.get('/me', async (c) => {
  const u = c.get('user');
  const rules = await pointRules(c.env);
  const isAdmin = u.role === 'admin';
  /* 存量用户：功能上线前就已经开启展示的，进控制台 / 签到地时自动补发一次，
     不需要重新点开关。奖励本身失败不影响积分接口返回。 */
  if (!isAdmin) {
    try {
      const bonus = await ensureShowcaseReward(c.env, u.id);
      if (bonus > 0) await audit(c, u.id, 'points.showcase_reward', 'showcase',
        `用户案例展示奖励补发 +${bonus}`);
    } catch { /* 降级：积分照常返回 */ }
    /* 组合任务：绑定 NodeLoc + Star 项目都完成才补发一次 3000 积分。
       惰性补发放在这里，存量用户不用重新做任务；失败不影响积分接口返回。 */
    try {
      const combo = await ensureComboReward(c.env, u.id);
      if (combo > 0) await audit(c, u.id, 'points.combo_reward', 'combo',
        `组合任务奖励 +${combo}（NodeLoc 绑定 + Star 项目）`);
    } catch { /* 降级：积分照常返回 */ }
  }
  const points = isAdmin ? UNLIMITED_POINTS : await ensurePoints(c.env.DB, u.id, rules);
  const day = todayStr();
  const checked = await hasCheckedIn(c.env.DB, u.id, day);

  const { results: logs } = await c.env.DB.prepare(
    'SELECT delta, balance, reason, detail, created_at FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 20'
  )
    .bind(u.id)
    .all();

  return ok(c, {
    points,
    unlimited: isAdmin,
    rules,
    today: day,
    checkedIn: checked,
    canCheckIn: !checked,
    logs: logs || [],
  });
});

/**
 * 组合任务奖励状态（奖励中心用）。
 * 默认只读不写；带 ?check=1 时主动复核并补发一次，让「两个任务都做完了」
 * 的用户点一下就能立即看到 3000 入账，不用等下次访问积分接口。
 * 管理员恒返回只读状态，不参与发放。
 */
app.get('/rewards', async (c) => {
  const u = c.get('user');
  const isAdmin = u.role === 'admin';
  let granted = 0;
  if (!isAdmin && String(c.req.query('check') || '').trim() === '1') {
    try {
      granted = await ensureComboReward(c.env, u.id);
      if (granted > 0) await audit(c, u.id, 'points.combo_reward', 'combo',
        `组合任务奖励 +${granted}（奖励中心主动领取）`);
    } catch { /* 降级：状态照常返回 */ }
  }
  const status = await comboRewardStatus(c.env, u.id);
  return ok(c, { ...status, isAdmin, granted, unlimited: isAdmin });
});

/** 每日签到 */
app.post('/checkin', async (c) => {
  const u = c.get('user');
  const rules = await pointRules(c.env);
  const day = todayStr();

  if (await hasCheckedIn(c.env.DB, u.id, day)) return fail(c, '今天已经签到过了，明天再来');

  const isAdmin = u.role === 'admin';
  const before = isAdmin ? UNLIMITED_POINTS : await ensurePoints(c.env.DB, u.id, rules);

  // 先记签到（唯一索引兜底并发），再入账
  try {
    await recordCheckin(c.env.DB, u.id, day, rules.checkin);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/UNIQUE|constraint/i.test(msg)) return fail(c, '今天已经签到过了');
    throw e;
  }

  const after = isAdmin
    ? UNLIMITED_POINTS
    : await addPoints(c.env.DB, u.id, rules.checkin, 'checkin', `每日签到 ${day}`);

  await audit(c, u.id, 'points.checkin', `+${rules.checkin}`, day);
  return ok(c, {
    gained: isAdmin ? 0 : rules.checkin,
    points: after,
    unlimited: isAdmin,
    before,
    day,
  });
});

/** 预查询：申请某名称需要多少积分（前端实时提示） */
app.get('/cost', async (c) => {
  const u = c.get('user');
  const rules = await pointRules(c.env);
  const label = String(c.req.query('label') || '').toLowerCase();
  if (!label) return fail(c, '缺少 label');
  const isAdmin = u.role === 'admin';
  const { cost, short } = domainCost(
    label,
    { domainCost: rules.domainCost, shortCost: rules.shortCost, shortLen: rules.shortLen },
    isAdmin
  );
  const points = isAdmin ? UNLIMITED_POINTS : await ensurePoints(c.env.DB, u.id, rules);
  return ok(c, {
    label,
    cost,
    short,
    points,
    unlimited: isAdmin,
    enough: isAdmin || points >= cost,
    shortCost: rules.shortCost,
    domainCost: rules.domainCost,
  });
});

export default app;
