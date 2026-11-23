/**
 * 用户案例展示奖励专项回归（CI 步骤：用户案例展示奖励回归）
 *
 * 真跑 src/lib/showcaseReward.ts + 内存 D1，覆盖：
 *   · 首次开启已开通域名 → +6000；已领过 / 关掉重开 / 展示更多域名都不叠加
 *   · 只有 approved 域名算展示；管理员 / 无限积分账号跳过
 *   · 后台改金额（1234 / 0 关闭 / 调回来）与存量用户惰性补发
 *   · 并发只发一次、入账失败回滚后可重试、关闭展示不回收、老用户补偿不丢
 *
 * 运行：npx tsx scripts/showcase-reward-regression.ts
 */
import { ensureShowcaseReward, showcaseRewardOf } from '../src/lib/showcaseReward.js';
import { SHOWCASE_REWARD_POINTS } from '../src/lib/pointDefaults.js';
import { invalidateSettings } from '../src/lib/settingsCache.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));

type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  users: Row[];
  subdomains: Row[];
  showcase_rewards: Row[];
  user_points: Row[];
  point_logs: Row[];
  failAddPoints: boolean;
};

function fresh(): Store {
  return {
    settings: new Map(),
    users: [{ id: 1, role: 'user' }],
    subdomains: [],
    showcase_rewards: [],
    user_points: [],
    point_logs: [],
    failAddPoints: false,
  };
}

function makeEnv(S: Store) {
  const exec = (sql: string, args: any[]): { rows: Row[]; changes: number } => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const rows: Row[] = [];
    let changes = 0;
  /* 统一配置层：SELECT key, value FROM settings（真实 D1 同形） */
  if (/^SELECT key, value FROM settings$/.test(s)) {
    for (const [key, value] of S.settings) rows.push({ key, value: String(value) });
    return { rows, changes };
  }
    const uid = Number(args[0]);

    if (/^CREATE TABLE IF NOT EXISTS showcase_rewards/.test(s)) {
      /* 内存表本来无 schema，忽略 */
    } else if (/^SELECT amount FROM showcase_rewards WHERE user_id = \?/.test(s)) {
      const r = S.showcase_rewards.find((x) => x.user_id === uid);
      if (r) rows.push({ amount: r.amount });
    } else if (/^SELECT fqdn FROM subdomains WHERE user_id = \? AND showcase = 1 AND status = 'approved'/.test(s)) {
      const r = S.subdomains
        .filter((x) => x.user_id === uid && x.showcase === 1 && x.status === 'approved')
        .sort((a, b) => Number(a.id) - Number(b.id))[0];
      if (r) rows.push({ fqdn: r.fqdn });
    } else if (/^SELECT role FROM users WHERE id = \?/.test(s)) {
      const r = S.users.find((x) => x.id === uid);
      if (r) rows.push({ role: r.role });
    } else if (/^SELECT key, value FROM settings WHERE key IN/.test(s)) {
      for (const k of ['showcase_reward_points', 'initial_points', 'domain_cost']) {
        const v = S.settings.get(k);
        if (v !== undefined) rows.push({ key: k, value: v });
      }
    } else if (/^SELECT value FROM settings WHERE key = 'showcase_reward_points'/.test(s)) {
      const v = S.settings.get('showcase_reward_points');
      if (v !== undefined) rows.push({ value: v });
    } else if (/^INSERT OR IGNORE INTO showcase_rewards/.test(s)) {
      if (!S.showcase_rewards.some((x) => x.user_id === uid)) {
        S.showcase_rewards.push({ user_id: uid, amount: Number(args[1]), fqdn: String(args[2]), created_at: Number(args[3]) });
        changes = 1;
      }
    } else if (/^UPDATE showcase_rewards SET amount = 0 WHERE user_id = \?/.test(s)) {
      const r = S.showcase_rewards.find((x) => x.user_id === uid);
      if (r) { r.amount = 0; changes = 1; }
    } else if (/^DELETE FROM showcase_rewards WHERE user_id = \?/.test(s)) {
      const n = S.showcase_rewards.length;
      S.showcase_rewards = S.showcase_rewards.filter((x) => x.user_id !== uid);
      changes = n - S.showcase_rewards.length;
    } else if (/^UPDATE user_points SET points = \?, updated_at = \? WHERE user_id = \?/.test(s)) {
      const r = S.user_points.find((x) => x.user_id === Number(args[2]));
      if (r) { r.points = Number(args[0]); r.updated_at = Number(args[1]); changes = 1; }
    } else if (/^DELETE FROM user_points WHERE user_id = \?/.test(s)) {
      const n = S.user_points.length;
      S.user_points = S.user_points.filter((x) => x.user_id !== uid);
      changes = n - S.user_points.length;
    } else if (/^SELECT points FROM user_points WHERE user_id = \?/.test(s)) {
      const r = S.user_points.find((x) => x.user_id === uid);
      if (r) rows.push({ points: r.points });
    } else if (/^SELECT COUNT\(\*\) AS n FROM subdomains WHERE user_id = \?/.test(s)) {
      const n = S.subdomains.filter((x) => x.user_id === uid && x.status !== 'rejected').length;
      rows.push({ n });
    } else if (/^INSERT INTO user_points/.test(s)) {
      const pts = Number(args[1]);
      const cur = S.user_points.find((x) => x.user_id === uid);
      if (/ON CONFLICT/.test(s)) {
        if (cur) { cur.points = pts; cur.updated_at = Number(args[2]); }
        else S.user_points.push({ user_id: uid, points: pts, updated_at: Number(args[2]) });
      } else {
        if (cur) throw new Error('UNIQUE constraint failed: user_points.user_id');
        S.user_points.push({ user_id: uid, points: pts, updated_at: Number(args[2]) });
      }
      changes = 1;
    } else if (/^INSERT INTO point_logs/.test(s)) {
      const reason = String(args[3]);
      if (S.failAddPoints && reason === 'showcase') throw new Error('mock D1 write failure');
      S.point_logs.push({
        user_id: Number(args[0]), delta: Number(args[1]), balance: Number(args[2]),
        reason, detail: String(args[4]), created_at: Number(args[5]),
      });
      changes = 1;
    } else {
      throw new Error('未覆盖的 SQL: ' + s.slice(0, 140));
    }
    return { rows, changes };
  };

  const prepare = (sql: string) => {
    let bound: any[] = [];
    const self: any = {
      bind(...v: any[]) { bound = v; return self; },
      async first() { return exec(sql, bound).rows[0] ?? null; },
      async all() { return { results: exec(sql, bound).rows }; },
      async run() { const r = exec(sql, bound); return { meta: { changes: r.changes } }; },
    };
    return self;
  };
  return { DB: { prepare } } as any;
}

const pts = (S: Store) => Number(S.user_points.find((x) => x.user_id === 1)?.points ?? -999);
const rewards = (S: Store) => S.showcase_rewards.filter((x) => x.user_id === 1);
const showLog = (S: Store) => S.point_logs.filter((x) => x.reason === 'showcase');
const domain = (id: number, status = 'approved', showcase = 1) =>
  ({ id, user_id: 1, fqdn: `d${id}.meoy.top`, status, showcase });

async function main() {
  /* 0. 常量口径 */
  check(SHOWCASE_REWARD_POINTS === 6000, '默认奖励为 6000 分');

  /* 1. 没有展示域名 → 不发 */
  {
    const S = fresh();
    const got = await ensureShowcaseReward(makeEnv(S), 1);
    check(got === 0 && rewards(S).length === 0 && S.user_points.length === 0,
      '未开启展示不发奖、不初始化积分');
  }

  /* 2. 只有 pending 域名开启展示 → 不发（展示页也只列 approved） */
  {
    const S = fresh();
    S.subdomains.push(domain(1, 'pending', 1));
    const got = await ensureShowcaseReward(makeEnv(S), 1);
    check(got === 0 && S.user_points.length === 0, '待审核域名不算「真的展示了」，不发奖');
  }

  /* 3. 首次开启已开通域名 → +6000，余额 = 初始 100 + 6000 */
  {
    const S = fresh();
    S.subdomains.push(domain(1));
    const env = makeEnv(S);
    const got = await ensureShowcaseReward(env, 1);
    check(got === 6000, '首次开启已开通域名发放 6000 分');
    check(pts(S) === 6100, `余额按正常口径初始化后累加（实际 ${pts(S)}）`);
    check(showLog(S).length === 1 && showLog(S)[0].delta === 6000,
      'point_logs 写入一条 showcase 流水');
    check(rewards(S).length === 1 && rewards(S)[0].fqdn === 'd1.meoy.top',
      '领取记录带首次展示的域名');

    /* 4. 重复调用 / 关闭展示 / 再开 / 展示更多域名都不叠加，也不回收 */
    const again = await ensureShowcaseReward(env, 1);
    check(again === 0 && pts(S) === 6100, '同一账号重复调用不叠加');
    S.subdomains[0].showcase = 0;
    const off = await ensureShowcaseReward(env, 1);
    check(off === 0 && pts(S) === 6100, '关闭展示不回收积分');
    S.subdomains[0].showcase = 1;
    S.subdomains.push(domain(2));
    const more = await ensureShowcaseReward(env, 1);
    check(more === 0 && pts(S) === 6100 && rewards(S).length === 1,
      '关掉重开、再展示第二个域名都不叠加');
  }

  /* 5. 管理员跳过且不占位；降级为普通用户后仍可领 */
  {
    const S = fresh();
    S.users[0].role = 'admin';
    S.subdomains.push(domain(1));
    const env = makeEnv(S);
    const got = await ensureShowcaseReward(env, 1);
    check(got === 0 && rewards(S).length === 0, '管理员不发奖、也不写入已领记录');
    S.users[0].role = 'user';
    const after = await ensureShowcaseReward(env, 1);
    check(after === 6000, '管理员降级为普通用户后仍可正常领取');
  }

  /* 6. 无限积分账号：记为已领但不入账 */
  {
    const S = fresh();
    S.subdomains.push(domain(1));
    S.user_points.push({ user_id: 1, points: -1, updated_at: 0 });
    const got = await ensureShowcaseReward(makeEnv(S), 1);
    check(got === 0 && pts(S) === -1 && rewards(S)[0]?.amount === 0,
      '无限积分账号不入账、标记为已领');
  }

  /* 7. 后台可改金额：1234 / 0 关闭 / 调回来 */
  {
    const S = fresh();
    S.subdomains.push(domain(1));
    S.settings.set('showcase_reward_points', '1234');
  invalidateSettings();  // 后台保存：统一配置缓存必须失效
    const env = makeEnv(S);
    check((await showcaseRewardOf(env)) === 1234, 'showcaseRewardOf 读取后台配置');
    const got = await ensureShowcaseReward(env, 1);
    check(got === 1234 && pts(S) === 1334, '后台改金额后按新值发放');
  }
  {
    const S = fresh();
    S.subdomains.push(domain(1));
    S.settings.set('showcase_reward_points', '0');
  invalidateSettings();  // 后台保存：统一配置缓存必须失效
    const env = makeEnv(S);
    const off = await ensureShowcaseReward(env, 1);
    check(off === 0 && rewards(S).length === 0 && S.user_points.length === 0,
      '设 0 = 关闭奖励且不占位');
    S.settings.set('showcase_reward_points', '6000');
  invalidateSettings();  // 后台保存：统一配置缓存必须失效
    const back = await ensureShowcaseReward(env, 1);
    check(back === 6000, '调回 6000 后仍可领取');
  }
  {
    const S = fresh();
    S.settings.set('showcase_reward_points', 'not-a-number');
  invalidateSettings();  // 后台保存：统一配置缓存必须失效
    check((await showcaseRewardOf(makeEnv(S))) === 6000, '非法配置回落内置默认 6000');
  }

  /* 8. 并发只发一次 */
  {
    const S = fresh();
    S.subdomains.push(domain(1));
    const env = makeEnv(S);
    const [a, b] = await Promise.all([
      ensureShowcaseReward(env, 1),
      ensureShowcaseReward(env, 1),
    ]);
    check(a + b === 6000 && pts(S) === 6100 && showLog(S).length === 1,
      `并发两个请求只入账一次（${a} / ${b}）`);
  }

  /* 9. 入账失败回滚，下次可重试 */
  {
    const S = fresh();
    S.subdomains.push(domain(1));
    S.failAddPoints = true;
    const env = makeEnv(S);
    const got = await ensureShowcaseReward(env, 1);
    check(got === 0 && rewards(S).length === 0, '入账失败撤掉占位记录，不出现「记了已领却没加分」');
    S.failAddPoints = false;
    const retry = await ensureShowcaseReward(env, 1);
    check(retry === 6000 && pts(S) === 6100, '失败后重试可正常领取');
  }

  /* 10. 存量用户：功能上线前已展示、已有积分余额 → 惰性补发 */
  {
    const S = fresh();
    S.subdomains.push(domain(1));
    S.user_points.push({ user_id: 1, points: 500, updated_at: 0 });
    const got = await ensureShowcaseReward(makeEnv(S), 1);
    check(got === 6000 && pts(S) === 6500, '存量已展示用户补发 6000，不重置原有余额');
  }

  /* 11. 老用户补偿不丢：3 个已开通域名、首次动作就是开展示 */
  {
    const S = fresh();
    S.subdomains.push(domain(1), domain(2), domain(3));
    const got = await ensureShowcaseReward(makeEnv(S), 1);
    check(got === 6000 && pts(S) === 6180,
      `首次动作即开展示仍按已有域名补偿 max(100, 3×60)=180（实际 ${pts(S)}）`);
  }

  console.log(`用户案例展示奖励回归：${ok.length} 通过，${bad.length} 失败`);
  for (const m of bad) console.error('  ✗ ' + m);
  if (bad.length) process.exit(1);
}

main().catch((e) => { console.error('回归异常:', e); process.exit(1); });
