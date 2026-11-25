/**
 * 组合任务奖励 + DC 积分兑换码专项回归
 *
 * 需求：
 *  1) 用户「绑定 NodeLoc」且「Star 并领取」后才一次性获得 3000 积分（完成所有才算）
 *  2) 管理员可在奖励中心创建积分优惠码，形式 DC-XXXXXX
 *
 * 真跑 src/lib/comboReward.ts、src/routes/redeem.ts、src/routes/points.ts
 * + 内存 D1（Hono app.fetch），覆盖：
 *   A. 组合奖励：两条件缺一不发、集齐发 3000、只发一次、并发、管理员 /
 *      无限积分跳过、后台设 0 / 改金额 / 非法值回落、入账失败回滚、
 *      存量补发、任务状态接口
 *   B. DC 码：格式、生成权限 / 校验 / 上限、预览、兑换加积分、重复兑换、
 *      停用 / 过期 / 用完、管理员无限积分、兑换流水
 *   C. 管理员编辑券：面值 / 总使用量 / 已用量修正 / 有效期 / 备注，
 *      权限、上下界校验、并发兜底、改完兑换链路立即按新值生效
 *   D. 静态断言：schema / 前端奖励中心 / CI / README 口径一致
 *
 * 运行：npx tsx scripts/rewards-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import redeemRoutes, { makeCode } from '../src/routes/redeem.js';
import pointRoutes from '../src/routes/points.js';
import {
  ensureComboReward, comboRewardStatus, comboRewardOf, __resetComboRewardForTest,
} from '../src/lib/comboReward.js';
import {
  COMBO_REWARD_POINTS, DC_CODE_PREFIX, DC_CODE_LEN, DC_POINTS_CAP,
} from '../src/lib/pointDefaults.js';
import { invalidateSettings } from '../src/lib/settingsCache.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  users: Row[];
  subdomains: Row[];
  user_points: Row[];
  point_logs: Row[];
  oauth_bindings: Row[];
  oauth_grants: Row[];
  combo_rewards: Row[];
  redeem_codes: Row[];
  redeem_logs: Row[];
  checkins: Row[];
  audit: Row[];
  seq: number;
  failPointLog: boolean;
  /** 测试钩子：下一次按 id 读券时，模拟「读取后、写入前」又被兑换一次 */
  bumpUsedOnSelect?: number;
  unknownSql: string[];
};

function fresh(): Store {
  return {
    settings: new Map(),
    users: [{ id: 1, role: 'user', status: 'active', quota: 5, email: 'u@example.com' }],
    subdomains: [], user_points: [], point_logs: [],
    oauth_bindings: [], oauth_grants: [], combo_rewards: [],
    redeem_codes: [], redeem_logs: [], checkins: [], audit: [],
    seq: 0, failPointLog: false, bumpUsedOnSelect: undefined, unknownSql: [],
  };
}

function bindNodeLoc(S: Store, uid = 1) {
  S.oauth_bindings.push({ provider: 'nodeloc', user_id: uid, sub: 'nl-1' });
}
function claimStar(S: Store, uid = 1) {
  S.oauth_grants.push({ provider: 'github-star', user_id: uid, amount: 5 });
}

function makeEnv(S: Store) {
  const exec = (sql: string, args: any[]): { rows: Row[]; changes: number; lastRowId: number } => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const rows: Row[] = [];
    let changes = 0;
    const uid = Number(args[0]);

    /* ── settings ── */
    if (/^SELECT key, value FROM settings$/.test(s)) {
      for (const [key, value] of S.settings) rows.push({ key, value: String(value) });
    } else if (/^SELECT key, value FROM settings WHERE key IN/.test(s)) {
      for (const [key, value] of S.settings) rows.push({ key, value: String(value) });
    } else if (/^SELECT value FROM settings WHERE key = \?/.test(s)) {
      const v = S.settings.get(String(args[0]));
      if (v !== undefined) rows.push({ value: v });
    /* ── 组合奖励表 ── */
    } else if (/^CREATE TABLE IF NOT EXISTS combo_rewards/.test(s)) {
      /* 内存表无 schema，忽略 */
    } else if (/^SELECT 1 AS ok FROM oauth_bindings WHERE provider = \? AND user_id = \? LIMIT 1/.test(s)) {
      const r = S.oauth_bindings.find((x) => x.provider === args[0] && x.user_id === Number(args[1]));
      if (r) rows.push({ ok: 1 });
    } else if (/^SELECT 1 AS ok FROM oauth_quota_grants WHERE provider = \? AND user_id = \? LIMIT 1/.test(s)) {
      const r = S.oauth_grants.find((x) => x.provider === args[0] && x.user_id === Number(args[1]));
      if (r) rows.push({ ok: 1 });
    } else if (/^SELECT amount FROM combo_rewards WHERE user_id = \?/.test(s)) {
      const r = S.combo_rewards.find((x) => x.user_id === uid);
      if (r) rows.push({ amount: r.amount });
    } else if (/^INSERT OR IGNORE INTO combo_rewards/.test(s)) {
      if (!S.combo_rewards.some((x) => x.user_id === uid)) {
        S.combo_rewards.push({ user_id: uid, amount: Number(args[1]), created_at: Number(args[2]) });
        changes = 1;
      }
    } else if (/^UPDATE combo_rewards SET amount = 0 WHERE user_id = \?/.test(s)) {
      const r = S.combo_rewards.find((x) => x.user_id === uid);
      if (r) { r.amount = 0; changes = 1; }
    } else if (/^DELETE FROM combo_rewards WHERE user_id = \?/.test(s)) {
      const n = S.combo_rewards.length;
      S.combo_rewards = S.combo_rewards.filter((x) => x.user_id !== uid);
      changes = n - S.combo_rewards.length;
    /* ── users / 积分 ── */
    } else if (/^SELECT role FROM users WHERE id = \?/.test(s)) {
      const r = S.users.find((x) => x.id === uid);
      if (r) rows.push({ role: r.role });
    } else if (/^SELECT COUNT\(\*\) AS n FROM subdomains WHERE user_id = \?/.test(s)) {
      rows.push({ n: S.subdomains.filter((x) => x.user_id === uid && x.status !== 'rejected').length });
    } else if (/^SELECT points FROM user_points WHERE user_id = \?/.test(s)) {
      const r = S.user_points.find((x) => x.user_id === uid);
      if (r) rows.push({ points: r.points });
    } else if (/^UPDATE user_points SET points = \?, updated_at = \? WHERE user_id = \?/.test(s)) {
      const r = S.user_points.find((x) => x.user_id === Number(args[2]));
      if (r) { r.points = Number(args[0]); r.updated_at = Number(args[1]); changes = 1; }
    } else if (/^DELETE FROM user_points WHERE user_id = \?/.test(s)) {
      const n = S.user_points.length;
      S.user_points = S.user_points.filter((x) => x.user_id !== uid);
      changes = n - S.user_points.length;
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
      if (S.failPointLog && reason !== 'grant') throw new Error('mock D1 write failure');
      S.point_logs.push({
        user_id: Number(args[0]), delta: Number(args[1]), balance: Number(args[2]),
        reason, detail: String(args[4]), created_at: Number(args[5]),
      });
      changes = 1;
    } else if (/^SELECT delta, balance, reason, detail, created_at FROM point_logs/.test(s)) {
      rows.push(...S.point_logs.filter((x) => x.user_id === uid).slice(-20).reverse());
    } else if (/^SELECT id FROM checkins WHERE user_id = \?/.test(s)) {
      const r = S.checkins.find((x) => x.user_id === uid && x.day === args[1]);
      if (r) rows.push({ id: r.id });
    /* ── 兑换码 ── */
    } else if (/^SELECT \* FROM redeem_codes WHERE code = \?/.test(s)) {
      const r = S.redeem_codes.find((x) => x.code === args[0]);
      if (r) rows.push({ ...r });
    } else if (/^SELECT code, type, value, status, expires_at, used_count, max_uses FROM redeem_codes WHERE code = \?/.test(s)) {
      const r = S.redeem_codes.find((x) => x.code === args[0]);
      if (r) rows.push({ ...r });
    } else if (/^SELECT id FROM redeem_codes WHERE code = \?/.test(s)) {
      const r = S.redeem_codes.find((x) => x.code === args[0]);
      if (r) rows.push({ id: r.id });
    } else if (/^SELECT \* FROM redeem_codes WHERE id = \?/.test(s)) {
      const r = S.redeem_codes.find((x) => x.id === uid);
      if (r) {
        rows.push({ ...r });                       // 读到的是快照
        if (S.bumpUsedOnSelect === r.id) {         // 随后别处又用了一次
          r.used_count = Number(r.used_count) + 1;
          S.bumpUsedOnSelect = undefined;
        }
      }
    } else if (/^SELECT code FROM redeem_codes WHERE id = \?/.test(s)) {
      const r = S.redeem_codes.find((x) => x.id === uid);
      if (r) rows.push({ code: r.code });
    } else if (/^SELECT r\.\*, u\.email AS creator FROM redeem_codes/.test(s)) {
      for (const r of S.redeem_codes) rows.push({ ...r, creator: 'admin@x.com' });
    } else if (/^SELECT COUNT\(\*\) AS n FROM redeem_codes/.test(s)) {
      rows.push({ n: S.redeem_codes.length });
    } else if (/^INSERT INTO redeem_codes/.test(s)) {
      const id = ++S.seq;
      S.redeem_codes.push({
        id, code: String(args[0]), type: String(args[1]), value: Number(args[2]),
        max_uses: Number(args[3]), used_count: 0, status: 'active',
        note: args[4] ?? null, expires_at: args[5] ?? null,
        created_by: args[6] ?? null, created_at: Number(args[7]),
      });
      changes = 1;
    } else if (/^UPDATE redeem_codes SET used_count = used_count \+ 1 WHERE id = \?/.test(s)) {
      const r = S.redeem_codes.find((x) => x.id === uid);
      if (r) { r.used_count = Number(r.used_count) + 1; changes = 1; }
    } else if (/^UPDATE redeem_codes SET status = \? WHERE id = \?/.test(s)) {
      const r = S.redeem_codes.find((x) => x.id === Number(args[1]));
      if (r) { r.status = String(args[0]); changes = 1; }
    } else if (/^UPDATE redeem_codes SET/.test(s)) {
      /* 编辑券：SET 列顺序 = args[0..n-1]，随后是 id 与并发 guard。
         guard 有两种：used_count = 原值（乐观锁）/ used_count <= 新总量。 */
      const m = s.match(/^UPDATE redeem_codes SET (.*?) WHERE id = \? (AND used_count = \?|AND used_count <= \?)$/);
      if (!m) { S.unknownSql.push(s.slice(0, 120)); }
      else {
        const cols = m[1].split(',').map((x) => x.trim().split(/\s*=\s*/)[0].trim());
        const id = Number(args[cols.length]);
        const guard = Number(args[cols.length + 1]);
        const r = S.redeem_codes.find((x) => x.id === id);
        const pass = r && (m[2] === 'AND used_count = \?'
          ? Number(r.used_count) === guard : Number(r.used_count) <= guard);
        if (pass) {
          cols.forEach((col, i) => { (r as Row)[col] = args[i]; });
          changes = 1;
        }
      }
    } else if (/^DELETE FROM redeem_codes WHERE id = \?/.test(s)) {
      const n = S.redeem_codes.length;
      S.redeem_codes = S.redeem_codes.filter((x) => x.id !== uid);
      changes = n - S.redeem_codes.length;
    } else if (/^DELETE FROM redeem_codes$/.test(s)) {
      changes = S.redeem_codes.length; S.redeem_codes = [];
    } else if (/^SELECT id FROM redeem_logs WHERE code = \? AND user_id = \?/.test(s)) {
      const r = S.redeem_logs.find((x) => x.code === args[0] && x.user_id === Number(args[1]));
      if (r) rows.push({ id: r.id });
    } else if (/^SELECT l\.\*, s\.fqdn FROM redeem_logs/.test(s)) {
      rows.push(...S.redeem_logs.filter((x) => x.user_id === uid).reverse());
    } else if (/^INSERT INTO redeem_logs/.test(s)) {
      S.redeem_logs.push({
        id: ++S.seq, code: String(args[0]), user_id: Number(args[1]),
        type: String(args[2]), subdomain_id: args[3] ?? null,
        value: Number(args[4]), created_at: Number(args[5]),
      });
      changes = 1;
    } else if (/^SELECT COUNT\(\*\) AS n FROM redeem_logs/.test(s)) {
      rows.push({ n: S.redeem_logs.length });
    } else if (/^DELETE FROM redeem_logs$/.test(s)) {
      changes = S.redeem_logs.length; S.redeem_logs = [];
    } else if (/^UPDATE users SET quota = \? WHERE id = \?/.test(s)) {
      const r = S.users.find((x) => x.id === Number(args[1]));
      if (r) { r.quota = Number(args[0]); changes = 1; }
    } else if (/^INSERT INTO audit_log/.test(s)) {
      S.audit.push({ action: args[1] ?? '', detail: String(args[3] ?? '') });
      changes = 1;
    } else {
      S.unknownSql.push(s.slice(0, 120));
    }
    return { rows, changes, lastRowId: S.seq };
  };

  const prepare = (sql: string) => {
    let bound: any[] = [];
    const self: any = {
      bind(...v: any[]) { bound = v; return self; },
      async first() { return exec(sql, bound).rows[0] ?? null; },
      async all() { return { results: exec(sql, bound).rows }; },
      async run() { const r = exec(sql, bound); return { meta: { changes: r.changes, last_row_id: r.lastRowId } }; },
    };
    return self;
  };
  return { DB: { prepare } } as any;
}

const CTX: any = { waitUntil() {}, passThroughOnException() {} };
function appFor(S: Store, role: 'user' | 'admin' | 'none' = 'user') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user', role === 'none' ? null : {
      id: 1, role, status: 'active', quota: role === 'admin' ? -1 : 5,
      email: role === 'admin' ? 'admin@x.com' : 'u@example.com',
    });
    await next();
  });
  app.route('/api/redeem', redeemRoutes);
  app.route('/api/points', pointRoutes);
  const env = makeEnv(S);
  const call = (p: string, init?: RequestInit) =>
    app.fetch(new Request('https://nic.test' + p, init), env, CTX);
  return { call, env };
}
const post = (body: any): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const putReq = (body: any): RequestInit => ({ ...post(body), method: 'PUT' });
const json = async (r: Response) => await r.json() as any;

const pts = (S: Store, uid = 1) => Number(S.user_points.find((x) => x.user_id === uid)?.points ?? -999);
const comboLog = (S: Store) => S.point_logs.filter((x) => x.reason === 'combo');

async function main() {
  /* ═════════ A. 组合任务奖励 ═════════ */
  check(COMBO_REWARD_POINTS === 3000, '组合奖励默认 3000 积分');

  {
    const S = fresh();
    const got = await ensureComboReward(makeEnv(S), 1);
    check(got === 0 && S.combo_rewards.length === 0 && S.user_points.length === 0,
      '两项都没完成：不发、不写占位、不初始化积分');
  }
  {
    const S = fresh(); bindNodeLoc(S);
    const got = await ensureComboReward(makeEnv(S), 1);
    check(got === 0 && S.combo_rewards.length === 0, '只绑定 NodeLoc：不发（完成所有才算）');
    const st = await comboRewardStatus(makeEnv(S), 1);
    check(st.nodelocLinked && !st.starClaimed && !st.allDone && !st.claimed,
      '状态接口正确反映「缺 Star」');
  }
  {
    const S = fresh(); claimStar(S);
    const got = await ensureComboReward(makeEnv(S), 1);
    check(got === 0 && S.combo_rewards.length === 0, '只 Star：不发（完成所有才算）');
  }
  {
    const S = fresh(); bindNodeLoc(S); claimStar(S);
    const got = await ensureComboReward(makeEnv(S), 1);
    check(got === 3000 && pts(S) === 3100 && comboLog(S).length === 1,
      `两项都完成 → +3000（初始 100 → 3100），流水 reason=combo（实际 ${pts(S)}）`);
    const again = await ensureComboReward(makeEnv(S), 1);
    check(again === 0 && pts(S) === 3100 && comboLog(S).length === 1,
      '每个账号只发一次，重复调用不叠加');
    const st = await comboRewardStatus(makeEnv(S), 1);
    check(st.allDone && st.claimed && st.amount === 3000 && st.points === 3000,
      '状态接口返回已领取 +3000');
  }
  {
    const S = fresh(); bindNodeLoc(S); claimStar(S);
    const env = makeEnv(S);
    const [a, b] = await Promise.all([ensureComboReward(env, 1), ensureComboReward(env, 1)]);
    check(a + b === 3000 && pts(S) === 3100 && comboLog(S).length === 1,
      `并发两个请求只入账一次（${a} / ${b}）`);
  }
  {
    const S = fresh(); bindNodeLoc(S); claimStar(S);
    S.users[0].role = 'admin';
    check(await ensureComboReward(makeEnv(S), 1) === 0 && S.combo_rewards.length === 0,
      '管理员账号跳过，不写占位');
  }
  {
    const S = fresh(); bindNodeLoc(S); claimStar(S);
    S.user_points.push({ user_id: 1, points: -1, updated_at: 0 });
    const got = await ensureComboReward(makeEnv(S), 1);
    check(got === 0 && pts(S) === -1, '无限积分账号不叠加');
  }
  {
    const S = fresh(); bindNodeLoc(S); claimStar(S);
    S.settings.set('combo_reward_points', '0'); invalidateSettings();
    const off = await ensureComboReward(makeEnv(S), 1);
    check(off === 0 && S.combo_rewards.length === 0, '后台设 0 = 关闭奖励且不占位');
    S.settings.set('combo_reward_points', '1234'); invalidateSettings();
    const back = await ensureComboReward(makeEnv(S), 1);
    check(back === 1234 && pts(S) === 1334, '后台调成 1234 后按新值发放');
    invalidateSettings();
  }
  {
    const S = fresh(); bindNodeLoc(S); claimStar(S);
    S.settings.set('combo_reward_points', 'not-a-number'); invalidateSettings();
    check(await comboRewardOf(makeEnv(S)) === 3000, '非法配置回落内置默认 3000');
    const got = await ensureComboReward(makeEnv(S), 1);
    check(got === 3000, '非法配置下仍按 3000 发放');
    invalidateSettings();
  }
  {
    const S = fresh(); bindNodeLoc(S); claimStar(S);
    S.failPointLog = true;
    const got = await ensureComboReward(makeEnv(S), 1);
    check(got === 0 && S.combo_rewards.length === 0,
      '入账失败撤掉占位，不出现「记了已领却没加分」');
    S.failPointLog = false;
    const retry = await ensureComboReward(makeEnv(S), 1);
    check(retry === 3000 && pts(S) === 3100, '失败后重试可正常领取');
  }
  {
    const S = fresh(); bindNodeLoc(S); claimStar(S);
    S.user_points.push({ user_id: 1, points: 500, updated_at: 0 });
    const got = await ensureComboReward(makeEnv(S), 1);
    check(got === 3000 && pts(S) === 3500, '存量用户（已有余额）惰性补发，不重置余额');
  }
  {
    /* /api/points/rewards：只读不写；?check=1 主动补发 */
    const S = fresh(); bindNodeLoc(S); claimStar(S);
    const { call } = appFor(S, 'user');
    const ro = await json(await call('/api/points/rewards'));
    check(ro.success && ro.allDone && !ro.claimed && ro.points === 3000 && ro.granted === 0,
      '任务状态接口只读，不擅自发放');
    check(pts(S) === -999, '只读接口没有初始化积分');
    const rc = await json(await call('/api/points/rewards?check=1'));
    check(rc.success && rc.granted === 3000 && rc.claimed && rc.amount === 3000,
      '?check=1 主动复核并发放 3000');
    const rc2 = await json(await call('/api/points/rewards?check=1'));
    check(rc2.granted === 0 && rc2.claimed, '再次 check 不重复发放');
  }
  {
    const S = fresh(); bindNodeLoc(S); claimStar(S);
    const { call } = appFor(S, 'admin');
    const r = await json(await call('/api/points/rewards?check=1'));
    check(r.success && r.isAdmin && r.granted === 0 && !r.claimed,
      '管理员访问任务接口只读，不参与发放');
  }

  /* ═════════ B. DC 积分兑换码 ═════════ */
  {
    const set = new Set<string>();
    for (let i = 0; i < 40; i++) set.add(makeCode('points'));
    const list = [...set];
    check(list.every((c) => new RegExp(`^${DC_CODE_PREFIX}[A-Z2-9]{${DC_CODE_LEN}}$`).test(c)),
      'makeCode(points) 全部为 DC-XXXXXX（大写、6 位、无易混淆字符）');
    check(list.length > 30, '40 次生成无撞码');
    check(/^V-/.test(makeCode('permanent')) && /^PE-/.test(makeCode('quota')),
      '旧 V / PE 码格式不受影响');
  }
  {
    const S = fresh();
    const { call } = appFor(S, 'admin');
    const r = await json(await call('/api/redeem/admin/generate', post({ type: 'points', count: 3, value: 3000, note: '活动' })));
    check(r.success && r.count === 3 && r.codes.length === 3 && r.value === 3000,
      '管理员在奖励中心批量生成 3 张 DC 码');
    check(r.codes.every((c: string) => /^DC-[A-Z2-9]{6}$/.test(c)), '生成的码均为 DC-XXXXXX');
    check(S.redeem_codes.every((c) => c.type === 'points' && c.value === 3000),
      '入库类型 / 面值正确');
    const badType = await json(await call('/api/redeem/admin/generate', post({ type: 'bogus' })));
    check(!badType.success, '未知类型被拒绝');
    const capped = await json(await call('/api/redeem/admin/generate', post({ type: 'points', count: 1, value: 99999999 })));
    check(capped.success && capped.value === DC_POINTS_CAP,
      `积分面值夹到上限 ${DC_POINTS_CAP}`);
  }
  {
    const S = fresh();
    const { call } = appFor(S, 'user');
    const r = await json(await call('/api/redeem/admin/generate', post({ type: 'points', count: 1 })));
    check(!r.success, '普通用户不能生成兑换码（403）');
  }
  {
    const S = fresh();
    const { call } = appFor(S, 'admin');
    const gen = await json(await call('/api/redeem/admin/generate', post({ type: 'points', count: 1, value: 3000 })));
    const code = gen.codes[0];
    const pre = await json(await call('/api/redeem/preview?code=' + encodeURIComponent(code.toLowerCase())));
    check(pre.success && pre.type === 'points' && pre.typeText === '积分' && pre.value === 3000 && pre.usable,
      '预览：小写输入也识别为「积分 ×3000」且可用');
  }
  {
    const S = fresh();
    const { call } = appFor(S, 'admin');
    const gen = await json(await call('/api/redeem/admin/generate', post({ type: 'points', count: 1, value: 3000 })));
    const code = gen.codes[0];
    const user = appFor(S, 'user');
    const r = await json(await user.call('/api/redeem/redeem', post({ code })));
    check(r.success && r.type === 'points' && r.added === 3000 && r.after === 3100,
      `兑换 DC 码 → 积分 +3000（100 → 3100，实际 ${r.after}）`);
    check(S.point_logs.some((l) => l.reason === 'redeem_points' && l.delta === 3000),
      '积分流水 reason=redeem_points');
    check(S.redeem_logs.length === 1 && S.redeem_logs[0].type === 'points' && S.redeem_codes[0].used_count === 1,
      '兑换记录与用量计数正确');
    const dup = await json(await user.call('/api/redeem/redeem', post({ code })));
    check(!dup.success && /已经使用过/.test(dup.message), '同一账号重复兑换被拒绝');
    check(pts(S) === 3100, '重复兑换没有重复加分');
  }
  {
    const S = fresh();
    const { call } = appFor(S, 'admin');
    const gen = await json(await call('/api/redeem/admin/generate', post({ type: 'points', count: 1, value: 500, maxUses: 1 })));
    const code = gen.codes[0];
    const u2 = appFor(S, 'user');
    const a = await json(await u2.call('/api/redeem/redeem', post({ code })));
    check(a.success && pts(S) === 600, `小面值 DC 码 +500（实际 ${pts(S)}）`);
    // 换一个账号用同一张券（总用量 1 → 已用完）
    const S2 = S;
    const app2 = new Hono();
    app2.use('*', async (c, next) => { c.set('user', { id: 2, role: 'user', status: 'active', quota: 5 }); await next(); });
    app2.route('/api/redeem', redeemRoutes);
    const b = await json(await app2.fetch(new Request('https://nic.test/api/redeem/redeem', post({ code })), makeEnv(S2), CTX));
    check(!b.success && /用完/.test(b.message), '券总用量耗尽后拒绝兑换');
  }
  {
    const S = fresh();
    const { call } = appFor(S, 'admin');
    const gen = await json(await call('/api/redeem/admin/generate', post({ type: 'points', count: 1, value: 3000 })));
    const code = gen.codes[0];
    await call('/api/redeem/admin/1/toggle', post({}));
    const u = appFor(S, 'user');
    const r = await json(await u.call('/api/redeem/redeem', post({ code })));
    check(!r.success && /停用/.test(r.message), '停用码不可兑换');
  }
  {
    const S = fresh();
    const { call } = appFor(S, 'admin');
    const gen = await json(await call('/api/redeem/admin/generate', post({ type: 'points', count: 1, value: 3000 })));
    const code = gen.codes[0];
    const admin = appFor(S, 'admin');
    const r = await json(await admin.call('/api/redeem/redeem', post({ code })));
    check(r.success && r.unlimited === true && r.added === 0 && r.after === -1,
      '无限积分账号兑换：不叠加、标记 unlimited');
    check(S.redeem_logs.length === 1, '无限账号兑换仍留兑换记录');
  }
  {
    const S = fresh();
    const { call } = appFor(S, 'admin');
    const mine = await json(await call('/api/redeem/mine'));
    check(mine.success && Array.isArray(mine.items), '我的兑换记录接口可用');
  }

  /* ═════════ C. 管理员编辑券（真跑 PUT /api/redeem/admin/:id） ═════════ */
  {
    const S = fresh();
    const admin = appFor(S, 'admin');
    const gen = await json(await admin.call('/api/redeem/admin/generate',
      post({ type: 'points', count: 1, value: 3000, maxUses: 10, days: 7, note: '活动奖励' })));
    const code = gen.codes[0];
    const row = S.redeem_codes[0];
    const id = row.id;
    const edit = (body: any, role: 'user' | 'admin' | 'none' = 'admin') =>
      appFor(S, role).call('/api/redeem/admin/' + id, putReq(body));

    const deny = await json(await edit({ maxUses: 3 }, 'user'));
    check(!deny.success, '普通用户不能编辑券（403）');

    const r = await json(await edit({ value: 500, maxUses: 3, note: '改过的备注', expiresAt: null }));
    check(r.success && row.value === 500 && row.max_uses === 3
      && row.note === '改过的备注' && row.expires_at === null,
      '面值 / 总使用量 / 备注 / 改为长期有效一次改成功');
    check(row.code === code && row.type === 'points' && row.created_by === 1,
      '券码 / 类型 / 创建人不可被编辑接口改动');
    check(S.audit.some((a) => a.action === 'redeem.edit' && String(a.detail).includes('面值')),
      '编辑写审计日志 redeem.edit');

    const list = await json(await admin.call('/api/redeem/admin/list'));
    const li = list.items.find((x: any) => x.id === id);
    check(li && li.value === 500 && li.max_uses === 3 && li.expires_at === null,
      '列表接口立刻返回编辑后的值（前端刷新即可看到）');

    const noChange = await json(await edit({}));
    check(noChange.success && noChange.unchanged === true, '空提交返回 unchanged，不写库不写审计');

    const badMax = await json(await edit({ maxUses: 0 }));
    check(!badMax.success, '总使用量 0 被拒绝');
    const badVal = await json(await edit({ value: -5 }));
    check(!badVal.success, '负 / 非整数面值被拒绝');
    const badUsed = await json(await edit({ usedCount: 99, maxUses: 3 }));
    check(!badUsed.success && /不能超过/.test(badUsed.message),
      '已用量不能超过总使用量（同时改两个字段也一起校验）');
    check(row.used_count === 0 && row.max_uses === 3, '非法编辑不产生任何写入');

    const capped = await json(await edit({ value: 999999999 }));
    check(capped.success && row.value === DC_POINTS_CAP,
      `积分券面值封顶 ${DC_POINTS_CAP}（实际 ${row.value}）`);

    const adj = await json(await edit({ usedCount: 1 }));
    check(adj.success && row.used_count === 1 && S.audit.some((a) => String(a.detail).includes('已用量')),
      '管理员修正已用量留痕');

    /* 乐观锁：显式改已用量时，若「读取后、写入前」又被兑换一次就 409 要求刷新 */
    const S3 = fresh();
    const a3 = appFor(S3, 'admin');
    const g3 = await json(await a3.call('/api/redeem/admin/generate', post({ type: 'points', count: 1, value: 100 })));
    const r3 = S3.redeem_codes[0];
    await appFor(S3, 'user').call('/api/redeem/redeem', post({ code: g3.codes[0] }));
    S3.bumpUsedOnSelect = r3.id;
    const lockFail = await json(await appFor(S3, 'admin').call('/api/redeem/admin/' + r3.id, putReq({ usedCount: 0 })));
    check(!lockFail.success && /刷新/.test(lockFail.message) && r3.used_count === 2,
      `编辑期间券被用过则拒绝覆盖，不静默抹掉真实用量（${lockFail.message}）`);

    /* 并发兜底：读取时总量合法，但写入前又被用一次 → UPDATE guard 拦下 */
    const S4 = fresh();
    const a4 = appFor(S4, 'admin');
    const g4 = await json(await a4.call('/api/redeem/admin/generate', post({ type: 'points', count: 1, value: 100, maxUses: 9 })));
    const r4 = S4.redeem_codes[0];
    await appFor(S4, 'user').call('/api/redeem/redeem', post({ code: g4.codes[0] }));
    S4.bumpUsedOnSelect = r4.id;
    const guardFail = await json(await appFor(S4, 'admin').call('/api/redeem/admin/' + r4.id, putReq({ maxUses: 1 })));
    check(!guardFail.success && /刷新/.test(guardFail.message) && r4.used_count === 2,
      `并发下总量降到低于真实已用量被 guard 拦下（${guardFail.message}）`);
    const equal = await json(await appFor(S4, 'admin').call('/api/redeem/admin/' + r4.id, putReq({ maxUses: 2 })));
    check(equal.success && r4.max_uses === 2, '刷新后总量设成等于已用量是允许的');
    const impossible = await json(await appFor(S4, 'admin').call('/api/redeem/admin/' + r4.id, putReq({ maxUses: 0 })));
    check(!impossible.success, '总量 0 / 低于已用量被前置校验拦下');

    /* 改完总量后，兑换链路立即按新值生效 */
    const S5 = fresh();
    const a5 = appFor(S5, 'admin');
    const g5 = await json(await a5.call('/api/redeem/admin/generate', post({ type: 'points', count: 1, value: 100, maxUses: 10 })));
    const r5 = S5.redeem_codes[0];
    await appFor(S5, 'admin').call('/api/redeem/admin/' + r5.id, putReq({ maxUses: 1 }));
    const u5 = appFor(S5, 'user');
    const first = await json(await u5.call('/api/redeem/redeem', post({ code: g5.codes[0] })));
    const app6 = new Hono();
    app6.use('*', async (c, next) => { c.set('user', { id: 2, role: 'user', status: 'active', quota: 5 }); await next(); });
    app6.route('/api/redeem', redeemRoutes);
    const second = await json(await app6.fetch(
      new Request('https://nic.test/api/redeem/redeem', post({ code: g5.codes[0] })), makeEnv(S5), CTX));
    check(first.success && !second.success && /用完/.test(second.message),
      '总量改成 1 后第二个账号兑换立即被拦（不是旧值 10）');

    /* 过期时间：改到过去后预览与兑换都判过期 */
    const S6 = fresh();
    const a6 = appFor(S6, 'admin');
    const g6 = await json(await a6.call('/api/redeem/admin/generate', post({ type: 'points', count: 1, value: 100 })));
    const r6 = S6.redeem_codes[0];
    await appFor(S6, 'admin').call('/api/redeem/admin/' + r6.id, putReq({ expiresAt: Date.now() - 86400000 }));
    const pre = await json(await appFor(S6, 'user').call('/api/redeem/preview?code=' + g6.codes[0]));
    check(!pre.usable && /过期/.test(pre.reason), '编辑到期时间后预览立即判过期');

    /* 永久化券不允许改面值 */
    const S7 = fresh();
    const a7 = appFor(S7, 'admin');
    const g7 = await json(await a7.call('/api/redeem/admin/generate', post({ type: 'permanent', count: 1 })));
    const r7 = S7.redeem_codes[0];
    const perm = await json(await appFor(S7, 'admin').call('/api/redeem/admin/' + r7.id, putReq({ value: 9 })));
    check(!perm.success && r7.value === 1, '永久化券没有面值可改');
    const permMax = await json(await appFor(S7, 'admin').call('/api/redeem/admin/' + r7.id, putReq({ maxUses: 2 })));
    check(permMax.success && r7.max_uses === 2, '永久化券仍可改总使用量');
  }

  /* ═════════ D. 静态口径 ═════════ */
  const schema = read('schema.sql');
  const rewardPage = read('src/app/pages/Rewards.tsx');
  const rewardCtrl = read('src/app/legacy/rewards.ts');
  const comboLib = read('src/lib/comboReward.ts');
  const redeemRoute = read('src/routes/redeem.ts');
  const pointsRoute = read('src/routes/points.ts');
  const ci = read('.github/workflows/deploy.yml');
  const readme = read('README.md');

  check(/CREATE TABLE IF NOT EXISTS combo_rewards/.test(schema)
    && /permanent \| quota \| points/.test(schema) && /DC-XXXXXX/.test(schema),
    'schema.sql 声明 combo_rewards 表与 DC 码类型');
  check(/NODELOC_PROVIDER/.test(comboLib) && /GITHUB_STAR_PROVIDER/.test(comboLib)
    && /if \(!nl \|\| !star\) return 0/.test(comboLib),
    '完成判据复用真实绑定 / Star 领取记录，两项缺一不发');
  check(/INSERT OR IGNORE INTO combo_rewards/.test(comboLib)
    && /DELETE FROM combo_rewards/.test(comboLib), '并发去重 + 失败回滚');
  check(/ensureComboReward\(c\.env, u\.id\)/.test(pointsRoute)
    && /app\.get\('\/rewards'/.test(pointsRoute),
    '/api/points/me 惰性补发 + /api/points/rewards 任务状态接口');
  check(/DC_CODE_PREFIX \+ rand\(DC_CODE_LEN\)/.test(redeemRoute)
    && /row\.type === 'points'/.test(redeemRoute)
    && /'redeem_points'/.test(redeemRoute),
    '兑换路由：DC 码生成 / 积分入账 / 独立流水');
  check(/value="points">DC 码 · 积分/.test(rewardPage)
    && /DC-XXXXXX/.test(rewardPage) && /id="comboCard"/.test(rewardPage)
    && /btnComboCheck/.test(rewardPage),
    '奖励中心有任务奖励卡与 DC 码生成选项');
  check(/\/api\/points\/rewards\?check=1/.test(rewardCtrl)
    && /v === 'points' \? '积分数量'/.test(rewardCtrl)
    && /loadCombo\(\)/.test(rewardCtrl),
    '奖励中心控制器：任务主动领取 / 积分数量标签 / 状态加载');
  check(/data-en="/.test(rewardCtrl) && /data-en="/.test(rewardPage),
    '新增文案覆盖英文模式');
  check(/app\.put\('\/admin\/:id'/.test(redeemRoute), '后端提供 PUT /admin/:id 编辑券');
  check(/data-ed="\$\{r\.id\}"/.test(rewardCtrl) && /api\.put\('\/api\/redeem\/admin\/'/.test(rewardCtrl)
    && /id="eMax"/.test(rewardPage) && /id="eUsed"/.test(rewardPage),
    '奖励中心列表有编辑按钮 + 总用量 / 已用量 / 面值 / 到期 / 备注表单');
  check(/AND used_count <= \?/.test(redeemRoute) && /AND used_count = \?/.test(redeemRoute),
    '编辑接口有并发兜底：降总量不越过真实用量、修正用量用乐观锁');
  check(/rewards-regression\.ts/.test(ci), '专项回归挂进 CI');
  check(/3000/.test(readme) && /DC-XXXXXX/.test(readme), 'README 记录两项新规则');

  for (const m of ok) console.log('  ✓ ' + m);
  for (const m of bad) console.error('  ✗ ' + m);
  console.log(`组合任务奖励与 DC 积分码回归：${ok.length} 通过，${bad.length} 失败`);
  if (bad.length) process.exit(1);
}

main().catch((e) => { console.error('回归异常:', e); process.exit(1); });
