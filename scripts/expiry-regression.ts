/**
 * 域名有效期 / 续期窗口专项回归（CI 步骤：有效期与续期回归）
 *
 * 真跑 src/lib/expiry.ts 纯函数 + 内存 D1，覆盖：
 *   · 续期窗口默认 = 有效期的一半（向下取整）：365→182、90→45、1→1
 *   · 后台显式填天数可覆盖；留空 / 非法值回落自动；改有效期窗口自动跟着变
 *   · expiryState 边界：剩余 183 天不可续、182 天可续；过期 / 永久不可续
 *   · 首页后缀卡 / 注册须知文案随站点设置变，不再写死 365 / 180
 *   · 续期顺延一个完整周期
 *
 * 运行：npx tsx scripts/expiry-regression.ts
 */
import {
  DEFAULT_VALID_DAYS,
  RENEW_HALF_RATIO,
  renewalWindowDays,
  expiryRules,
  expiryTipText,
  expiryState,
  computeExpiry,
  renewExpiry,
} from '../src/lib/expiry.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const DAY = 24 * 60 * 60 * 1000;

/** 内存 D1：只实现 expiryRules 用到的 SELECT value FROM settings WHERE key = ? */
function makeEnv(settings: Record<string, string>) {
  const prepare = (sql: string) => {
    let bound: any[] = [];
    const self: any = {
      bind(...v: any[]) { bound = v; return self; },
      async first() {
        const k = String(bound[0]);
        return Object.prototype.hasOwnProperty.call(settings, k) ? { value: settings[k] } : null;
      },
      async all() { return { results: [] }; },
      async run() { return { meta: { changes: 0 } }; },
    };
    return self;
  };
  return { DB: { prepare } } as any;
}

async function main() {
  /* 1. 半程窗口纯函数 */
  check(RENEW_HALF_RATIO === 0.5 && DEFAULT_VALID_DAYS === 365, '默认有效期 365 天，窗口比例 0.5');
  check(renewalWindowDays(365, null) === 182, '365 天 → 182 天窗口（少于一半）');
  check(renewalWindowDays(90, null) === 45, '90 天 → 45 天窗口');
  check(renewalWindowDays(730, null) === 365, '730 天 → 365 天窗口');
  check(renewalWindowDays(1, null) === 1, '1 天有效期窗口至少 1 天，不会变成 0');
  for (const v of [undefined, null, '', '   ', 'abc', NaN, -1]) {
    check(renewalWindowDays(365, v) === 182, `留空 / 非法 override ${String(v)} 回落自动 182`);
  }
  check(renewalWindowDays(365, 60) === 60, '后台显式填 60 天 → 覆盖为 60');
  check(renewalWindowDays(365, 0) === 0, '后台显式填 0 → 关闭续期窗口（合法值）');
  check(renewalWindowDays(0, null) === 182 && renewalWindowDays('bad', null) === 182,
    '非法 validDays 回落 365 天口径');

  /* 2. expiryRules 读取 settings（含「改有效期窗口自动跟着变」） */
  {
    const r = await expiryRules(makeEnv({}));
    check(r.validDays === 365 && r.renewWindowDays === 182 && r.renewWindowAuto === true,
      '全新库：365 天 / 182 天窗口 / 自动模式');
  }
  {
    const r = await expiryRules(makeEnv({ domain_valid_days: '90', renew_window_days: '' }));
    check(r.validDays === 90 && r.renewWindowDays === 45 && r.renewWindowAuto === true,
      '后台把有效期改成 90 天，窗口自动变成 45 天');
  }
  {
    const r = await expiryRules(makeEnv({ domain_valid_days: '180', renew_window_days: '' }));
    check(r.validDays === 180 && r.renewWindowDays === 90, '有效期 180 → 窗口 90');
  }
  {
    const r = await expiryRules(makeEnv({ renew_window_days: '60' }));
    check(r.renewWindowDays === 60 && r.renewWindowAuto === false,
      '后台显式填 60 天：窗口固定 60，不再跟随有效期');
  }
  {
    const r = await expiryRules(makeEnv({ renew_window_days: '180' }));
    check(r.renewWindowDays === 180 && r.renewWindowAuto === false,
      '老库未迁移时旧值 180 仍被当作显式覆盖（由 schema 一次性迁移清空）');
  }
  {
    const r = await expiryRules(makeEnv({ domain_valid_days: 'abc', renew_window_days: 'xyz' }));
    check(r.validDays === 365 && r.renewWindowDays === 182 && r.renewWindowAuto === true,
      '非法设置回落内置默认并按自动口径计算，不产生 NaN');
  }

  /* 3. 文案随设置变，不再写死 365 / 180 */
  check(expiryTipText({ validDays: 365, renewWindowDays: 182 }) === '单次注册 365 天，到期前 182 天可续期',
    '默认文案：单次注册 365 天，到期前 182 天可续期');
  check(expiryTipText({ validDays: 90, renewWindowDays: 45 }) === '单次注册 90 天，到期前 45 天可续期',
    '后台改有效期后首页卡片文案同步变化');
  check(expiryTipText({ validDays: 365, renewWindowDays: 60 }) === '单次注册 365 天，到期前 60 天可续期',
    '后台显式覆盖窗口后文案同步');
  check(!expiryTipText({ validDays: 365, renewWindowDays: 182 }).includes('180'),
    '文案里不再出现旧的 180 天');

  /* 4. expiryState 边界 */
  const now = 1_800_000_000_000;
  const row = (days: number) => ({ expires_at: now + days * DAY, perpetual: 0 });
  {
    const s = expiryState(row(183), { renewWindowDays: 182, now });
    check(!s.canRenew && !s.expired && s.daysLeft === 183, '剩余 183 天（还超过一半）不可续期');
  }
  {
    const s = expiryState(row(182), { renewWindowDays: 182, now });
    check(s.canRenew && s.willExpire && !s.expired && s.daysLeft === 182,
      '剩余 182 天（少于一半）可续期');
  }
  {
    const s = expiryState(row(46), { renewWindowDays: 45, now });
    const t = expiryState(row(45), { renewWindowDays: 45, now });
    check(!s.canRenew && t.canRenew, '有效期 90 天：46 天不可续 / 45 天可续');
  }
  {
    const s = expiryState({ expires_at: now, perpetual: 0 }, { renewWindowDays: 182, now });
    check(s.expired && !s.canRenew, '刚好到期：已过期且不可续期');
  }
  {
    const s = expiryState({ expires_at: null, perpetual: 1 }, { renewWindowDays: 182, now });
    check(s.perpetual && !s.canRenew && s.daysLeft === null, '永久域名不可续期');
  }
  {
    const s = expiryState(row(100), { now });   // 不传窗口：默认按 365/2
    check(s.canRenew, '未显式传窗口时按内置 365 天的一半判定');
  }
  {
    const s = expiryState(row(100), { renewWindowDays: 0, now });
    check(!s.canRenew, '窗口设为 0 时不可续期');
  }

  /* 5. 到期时间计算与续期顺延 */
  {
    const exp = computeExpiry({ validDays: 365, from: now });
    check(exp === now + 365 * DAY, '新域名到期时间 = 现在 + 有效期');
    check(computeExpiry({ perpetual: true, from: now }) === null, '永久域名无到期时间');
    const renewed = renewExpiry(row(100), { validDays: 365, now });
    check(renewed.ok && renewed.expiresAt === now + 100 * DAY + 365 * DAY,
      '未过期续期：在原到期时间上顺延一个完整周期');
    const expired = renewExpiry({ expires_at: now - 5 * DAY, perpetual: 0 }, { validDays: 365, now });
    check(expired.ok && expired.expiresAt === now + 365 * DAY, '已过期续期：从现在重新起算');
    check(!renewExpiry({ perpetual: 1 }, { now }).ok, '永久域名续期被拒绝');
  }

  console.log(`有效期与续期回归：${ok.length} 通过，${bad.length} 失败`);
  for (const m of bad) console.error('  ✗ ' + m);
  if (bad.length) process.exit(1);
}

main().catch((e) => { console.error('回归异常:', e); process.exit(1); });
