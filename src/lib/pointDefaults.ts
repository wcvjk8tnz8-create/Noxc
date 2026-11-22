/**
 * Noxc · 积分规则默认值（唯一来源）
 *
 * 2026-11-22 按站点设置口径调整：签到 +30、新用户 100、普通域名 60、单字域名 300。
 * 以前 5 / 10 / 5 / 35 散落在 schema.sql、points.ts、routes/points.ts、
 * /api/config、后台输入框、注册须知与首页说明里，改一处就「页面说明与实际
 * 消耗对不上」。现在所有兜底值都引用这里；schema.sql 是 SQL 无法 import，
 * 由 scripts/health-check.ts 断言两边逐项一致，防止回流。
 *
 * 注意：这些只是「数据库里没有该 key」时的兜底。管理员在后台保存过的值
 * 优先级更高，任何迁移都不得覆盖自定义值。
 */
export const POINT_DEFAULTS = {
  checkin: 30,
  initial: 100,
  domainCost: 60,
  shortCost: 300,
  shortLen: 1,
} as const;

/**
 * 用户案例展示奖励：账号首次把任意一个已开通域名开启展示，一次性发放。
 * 关闭展示不回收；再开、换域名、重复提交都不叠加（口径同 Star / NodeLoc 奖励）。
 * 后台「站点设置 → 积分规则」可用 settings.showcase_reward_points 覆盖；
 * 设 0 = 关闭奖励，但已领过的不回收。
 */
export const SHOWCASE_REWARD_POINTS = 6000;
export const SHOWCASE_REWARD_CAP = 100000;

/** schema.sql 里的旧默认（5 / 10 / 5 / 35）只用于一次性迁移判定，不参与运行期逻辑。 */
