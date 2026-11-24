/**
 * DC 积分优惠码 · 注册域名时抵扣 专项回归
 *
 * 真实用途：`DC-XXXXXX` 不是用来「兑换成积分余额」，而是用户申请子域名时
 * 直接抵扣本次积分消耗。奖励中心的直接兑换路径保留兼容，两者共用去重口径。
 *
 * 本回归用 node:sqlite 真跑 schema.sql + Hono 的
 *   /api/redeem/admin/generate、/api/subdomains/check、/api/subdomains
 * 三条真实链路（不是字符串断言），覆盖：
 *   · 全额 / 部分抵扣、实付积分、apply_cost 与积分流水
 *   · 同账号重复用券、券总用量耗尽、停用 / 过期 / 错格式 / 非 DC 码
 *   · 本次免费不浪费券、唯一约束撞车时完整回滚券
 *   · /check 即时预览「原价 / 抵扣 / 实付」
 *   · 直接兑换成积分的旧路径仍可用
 *
 * 运行：npx tsx scripts/discount-code-regression.ts
 * 注意：依赖 node:sqlite（Node 22.5+ 内置、Node 23.4+/24 默认可用），
 *       CI 在 Node 20 的 job 里临时切到 24 只跑本脚本，随后切回 20 构建部署。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import redeemRoutes from '../src/routes/redeem.js';
import subdomainRoutes from '../src/routes/subdomains.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* 外部请求一律失败：AI 审核降级、邮件通知不干扰申请主链路 */
(globalThis as any).fetch = async () => { throw new Error('network disabled in regression'); };

const SCHEMA = read('schema.sql');

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  const prepare = (sql: string) => {
    let args: any[] = [];
    const self: any = {
      bind(...v: any[]) { args = v.map((x) => (x === undefined ? null : x)); return self; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() {
        const r: any = sqlite.prepare(sql).run(...args);
        return { meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
      },
    };
    return self;
  };
  const q = (sql: string, ...a: any[]) => sqlite.prepare(sql).all(...a) as any[];
  const one = (sql: string, ...a: any[]) => (sqlite.prepare(sql).get(...a) as any) ?? null;
  const exec = (sql: string, ...a: any[]) => sqlite.prepare(sql).run(...a);
  return { DB: { prepare }, q, one, exec };
}

function envOf(db: ReturnType<typeof makeDb>, extra: Record<string, string> = {}) {
  return {
    DB: db.DB,
    ROOT_DOMAIN: 'meoy.top', ROOT_DOMAINS: 'meoy.top,noxc.uk',
    DEFAULT_QUOTA: '20', REQUIRE_APPROVAL: '0', ALLOW_SIGNUP: '1',
    APPLY_PAUSED: '0', CF_MOCK: '1', MAIL_PROVIDER: '', RESERVED_LABELS: '',
    ...extra,
  } as any;
}

/** 写积分规则：普通域名 60、初始 100、关掉滑块与 AI */
function seedRules(db: ReturnType<typeof makeDb>, extra: Record<string, string> = {}) {
  const s: Record<string, string> = {
    domain_cost: '60', short_domain_cost: '300', short_domain_len: '1',
    initial_points: '100', checkin_points: '30',
    captcha_enabled: '0', ai_review_enabled: '0', apply_paused: '0',
    ...extra,
  };
  for (const [k, v] of Object.entries(s)) {
    db.exec('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
  }
}

const CTX: any = { waitUntil() {}, passThroughOnException() {} };

function buildApp(db: ReturnType<typeof makeDb>) {
  let user: any = null;
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('user', user); await next(); });
  app.route('/api/redeem', redeemRoutes);
  app.route('/api/subdomains', subdomainRoutes);
  const env = envOf(db);
  const call = async (p: string, method = 'GET', body?: any) => {
    const r = await app.fetch(new Request('https://nic.test' + p, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }), env, CTX);
    return { status: r.status, body: await r.json().catch(() => ({})) as any };
  };
  const asUser = (id: number, role = 'user') => {
    user = { id, role, status: 'active', quota: 20, email: `u${id}@example.com` };
    if (!db.one('SELECT id FROM users WHERE id = ?', id)) {
      db.exec('INSERT INTO users(id, email, password_hash, role, status, quota, created_at) VALUES (?,?,?,?,?,?,?)',
        id, `u${id}@example.com`, 'pbkdf2$x', role, 'active', 20, Date.now());
    }
  };
  return { call, asUser, env };
}

/** 管理员批量生成 DC 码，返回第一张 */
async function genDc(app: ReturnType<typeof buildApp>, value: number, maxUses = 10, days = 0) {
  app.asUser(999, 'admin');
  const r = await app.call('/api/redeem/admin/generate', 'POST', {
    type: 'points', count: 1, value, maxUses, days, note: '注册抵扣回归',
  });
  return { res: r, code: String(r.body?.codes?.[0] || '') };
}

const pointsOf = (db: ReturnType<typeof makeDb>, uid: number) =>
  Number(db.one('SELECT points FROM user_points WHERE user_id = ?', uid)?.points ?? -999);
const couponOf = (db: ReturnType<typeof makeDb>, code: string) =>
  db.one('SELECT * FROM redeem_codes WHERE code = ?', code);
const logsOf = (db: ReturnType<typeof makeDb>, code: string) =>
  db.q('SELECT * FROM redeem_logs WHERE code = ?', code);

async function main() {
  /* ═════ 1. 全额抵扣：60 分域名 → 实付 0，券只抵 60 不找零 ═════ */
  {
    const db = makeDb(); seedRules(db);
    const app = buildApp(db);
    const { code, res } = await genDc(app, 3000);
    check(res.status === 200 && /^DC-[A-Z2-9]{6}$/.test(code), '管理员生成 DC-XXXXXX 成功');

    app.asUser(1);
    const before = pointsOf(db, 1);
    const r = await app.call('/api/subdomains', 'POST', {
      label: 'dcone', root: 'meoy.top', note: 'test', discountCode: code.toLowerCase(),
    });
    check(r.status === 200 && r.body.success === true, `带 DC 码申请成功（${r.status}）`);
    check(r.body.cost === 60 && r.body.discount === 60 && r.body.pay === 0,
      `原价 60 · 抵扣 60 · 实付 0（实际 ${r.body.cost}/${r.body.discount}/${r.body.pay}）`);
    check(pointsOf(db, 1) === 100,
      `余额不变仍为 100（实际 ${pointsOf(db, 1)}；未把 3000 面值变现）`);
    check(Number(couponOf(db, code).used_count) === 1 && logsOf(db, code).length === 1,
      '券用量 +1、兑换记录 1 条（抵扣路径也走去重表）');
    check(Number(logsOf(db, code)[0].value) === 60 && logsOf(db, code)[0].type === 'points',
      '日志记录的是实际抵扣额 60，不是面值 3000');
    check(Number(db.one('SELECT apply_cost FROM subdomains WHERE fqdn = ?', 'dcone.meoy.top')?.apply_cost) === 0,
      'apply_cost 记实付 0（AI 事后驳回退分不会多退）');
    check(!db.q("SELECT * FROM point_logs WHERE user_id = 1 AND reason = 'apply'").length,
      '全额抵扣时不写扣分流水');
  }

  /* ═════ 2. 部分抵扣：面值 20 → 实付 40 ═════ */
  {
    const db = makeDb(); seedRules(db);
    const app = buildApp(db);
    const { code } = await genDc(app, 20);
    app.asUser(1);
    const r = await app.call('/api/subdomains', 'POST', {
      label: 'dcpart', root: 'meoy.top', discountCode: code,
    });
    check(r.body.discount === 20 && r.body.pay === 40 && pointsOf(db, 1) === 60,
      `面值 20 → 抵扣 20、实付 40、余额 60（实际 ${pointsOf(db, 1)}）`);
    check(Number(db.one('SELECT apply_cost FROM subdomains WHERE fqdn = ?', 'dcpart.meoy.top')?.apply_cost) === 40,
      'apply_cost 记实付 40');
    const log = db.q("SELECT * FROM point_logs WHERE user_id = 1 AND reason = 'apply'")[0];
    check(Number(log.delta) === -40 && /DC 码/.test(String(log.detail)),
      '扣分流水 -40 且注明 DC 码抵扣');
  }

  /* ═════ 3. 不带码仍是原价 ═════ */
  {
    const db = makeDb(); seedRules(db);
    const app = buildApp(db);
    app.asUser(1);
    const r = await app.call('/api/subdomains', 'POST', { label: 'plain', root: 'meoy.top' });
    check(r.body.cost === 60 && r.body.pay === 60 && r.body.discount === 0 && pointsOf(db, 1) === 40,
      '不填优惠码按原价 60 分扣除');
  }

  /* ═════ 4. 同账号重复用同一张券 ═════ */
  {
    const db = makeDb(); seedRules(db);
    const app = buildApp(db);
    const { code } = await genDc(app, 3000);
    app.asUser(1);
    await app.call('/api/subdomains', 'POST', { label: 'first', root: 'meoy.top', discountCode: code });
    const r = await app.call('/api/subdomains', 'POST', { label: 'second', root: 'meoy.top', discountCode: code });
    check(r.status === 400 && r.body.discountInvalid === true && /已经使用过/.test(r.body.message),
      '同一账号重复用券被拦下并给出明确原因');
    check(!db.one('SELECT id FROM subdomains WHERE fqdn = ?', 'second.meoy.top'),
      '被拦时没有写入域名');
    check(Number(couponOf(db, code).used_count) === 1 && pointsOf(db, 1) === 100,
      '券用量与积分余额都没有被重复改动');
  }

  /* ═════ 5. 券总用量耗尽（两个不同账号） ═════ */
  {
    const db = makeDb(); seedRules(db);
    const app = buildApp(db);
    const { code } = await genDc(app, 3000, 1);
    app.asUser(1);
    const a = await app.call('/api/subdomains', 'POST', { label: 'u1', root: 'meoy.top', discountCode: code });
    app.asUser(2);
    const b = await app.call('/api/subdomains', 'POST', { label: 'u2', root: 'meoy.top', discountCode: code });
    check(a.body.success === true && b.status === 400 && /用完/.test(b.body.message),
      '总用量 1 的券：第一个账号用掉后第二个账号被拦');
    check(Number(couponOf(db, code).used_count) === 1 && logsOf(db, code).length === 1,
      '并发口径下也没有超发');
  }

  /* ═════ 6. 不可用券：停用 / 过期 / 错格式 / 非 DC 码 / 不存在 ═════ */
  {
    const cases: Array<[string, (app: ReturnType<typeof buildApp>, db: ReturnType<typeof makeDb>) => Promise<string>, RegExp]> = [
      ['格式错误', async () => 'DC-', /格式/],
      ['不存在', async () => 'DC-ZZZZZZ', /不存在/],
      ['非 DC 码（PE 配额码）', async (app) => {
        app.asUser(999, 'admin');
        const r = await app.call('/api/redeem/admin/generate', 'POST', { type: 'quota', count: 1, value: 5 });
        return String(r.body.codes[0]);
      }, /格式|不是积分优惠码/],
      ['停用', async (app, db) => {
        const { code } = await genDc(app, 3000);
        db.exec("UPDATE redeem_codes SET status = 'disabled' WHERE code = ?", code);
        return code;
      }, /停用/],
      ['过期', async (app, db) => {
        const { code } = await genDc(app, 3000);
        db.exec('UPDATE redeem_codes SET expires_at = ? WHERE code = ?', Date.now() - 1000, code);
        return code;
      }, /过期/],
    ];
    for (const [label, make, re] of cases) {
      const db = makeDb(); seedRules(db);
      const app = buildApp(db);
      const code = await make(app, db);
      app.asUser(1);
      const r = await app.call('/api/subdomains', 'POST', { label: 'badcase', root: 'meoy.top', discountCode: code });
      check(r.status === 400 && r.body.discountInvalid === true && re.test(r.body.message),
        `${label}：明确拦下且不扣积分`);
      check(!db.one('SELECT id FROM subdomains WHERE fqdn = ?', 'badcase.meoy.top')
        && pointsOf(db, 1) === -999,
        `${label}：域名未写入、积分未初始化`);
    }
  }

  /* ═════ 7. 本次免费不浪费券 ═════ */
  {
    const db = makeDb(); seedRules(db, { domain_cost: '0' });
    const app = buildApp(db);
    const { code } = await genDc(app, 3000);
    app.asUser(1);
    const r = await app.call('/api/subdomains', 'POST', { label: 'free', root: 'meoy.top', discountCode: code });
    check(r.body.success === true && r.body.cost === 0 && r.body.pay === 0,
      '0 分域名仍可正常申请');
    check(Number(couponOf(db, code).used_count) === 0 && logsOf(db, code).length === 0,
      '本次免费时券完全不消耗，留到下次用');
  }

  /* ═════ 8. 域名唯一约束撞车 → 券完整回滚 ═════ */
  {
    const db = makeDb(); seedRules(db);
    const app = buildApp(db);
    app.asUser(1);
    await app.call('/api/subdomains', 'POST', { label: 'taken', root: 'meoy.top' });
    const { code } = await genDc(app, 3000);
    app.asUser(1);
    const r = await app.call('/api/subdomains', 'POST', { label: 'taken', root: 'meoy.top', discountCode: code });
    check(r.status === 409, `同名撞车返回 409（实际 ${r.status}）`);
    check(Number(couponOf(db, code).used_count) === 0 && logsOf(db, code).length === 0,
      '撞车后券用量与兑换记录都回滚，不出现「券没了域名也没拿到」');
  }

  /* ═════ 9. /check 即时预览 ═════ */
  {
    const db = makeDb(); seedRules(db);
    const app = buildApp(db);
    const { code } = await genDc(app, 3000);
    app.asUser(1);
    const plain = await app.call('/api/subdomains/check?label=preview&root=meoy.top');
    const withDc = await app.call('/api/subdomains/check?label=preview&root=meoy.top&discountCode=' + code);
    check(plain.body.cost === 60 && plain.body.pay === 60 && plain.body.discount === 0,
      '不带码：原价 60、实付 60');
    check(withDc.body.cost === 60 && withDc.body.discount === 60
      && withDc.body.pay === 0 && withDc.body.discountValid === true,
      '带码：原价 60、抵扣 60、实付 0，前端可直接显示');
    check(Number(couponOf(db, code).used_count) === 0,
      '查价只做只读校验，绝不提前消耗券');
    const bad = await app.call('/api/subdomains/check?label=preview&root=meoy.top&discountCode=DC-NOPE');
    check(bad.body.available === true && bad.body.discountValid === false && !!bad.body.discountReason,
      '券不可用时只回原因，不影响「域名可注册」判定');
  }

  /* ═════ 10. 积分不足时按「实付」判定 ═════ */
  {
    const db = makeDb(); seedRules(db, { initial_points: '30' });
    const app = buildApp(db);
    app.asUser(1);
    const noCode = await app.call('/api/subdomains', 'POST', { label: 'poor', root: 'meoy.top' });
    check(noCode.status === 402, '余额 30 < 原价 60：拦下');
    const { code } = await genDc(app, 40);
    app.asUser(1);
    const withDc = await app.call('/api/subdomains', 'POST', { label: 'poor', root: 'meoy.top', discountCode: code });
    check(withDc.body.success === true && withDc.body.pay === 20 && pointsOf(db, 1) === 10,
      `抵扣后实付 20 ≤ 余额 30：放行（余额 ${pointsOf(db, 1)}）`);
    check(Number(couponOf(db, code).used_count) === 1, '成功申请才消耗券');
  }

  /* ═════ 11. 直接兑换成积分的旧路径仍兼容 ═════ */
  {
    const db = makeDb(); seedRules(db);
    const app = buildApp(db);
    const { code } = await genDc(app, 500);
    app.asUser(1);
    const r = await app.call('/api/redeem/redeem', 'POST', { code });
    check(r.body.success === true && r.body.added === 500 && pointsOf(db, 1) === 600,
      '奖励中心直接兑换仍按面值加积分（已派发的券不失效）');
    const reuse = await app.call('/api/subdomains', 'POST', { label: 'after', root: 'meoy.top', discountCode: code });
    check(reuse.status === 400 && /已经使用过/.test(reuse.body.message),
      '两条路径共用 redeem_logs 去重：兑换过的码不能再拿去抵扣');
  }

  /* ═════ 12. 静态口径 ═════ */
  const sub = read('src/routes/subdomains.ts');
  const lib = read('src/lib/discountCode.ts');
  const reg = read('src/app/legacy/register.ts');
  const regPage = read('src/app/pages/Register.tsx');
  const rewards = read('src/app/legacy/rewards.ts');
  const readme = read('README.md');
  const ci = read('.github/workflows/deploy.yml');
  const health = read('scripts/health-check.ts');

  check(/resolveDiscountCode\(c\.env\.DB, discountCode, u\.id, cost\)/.test(sub)
    && /consumeDiscountCode\(/.test(sub) && /rollbackDiscountCode\(/.test(sub),
    '注册接口接上解析 / 消耗 / 回滚三步');
  check(/-payable/.test(sub) && /apply_cost = \?/.test(sub)
    && /\.bind\(isAdmin \|\| aiRejected \? 0 : payable/.test(sub),
    '扣分与 apply_cost 都按「实付」记账，退分口径不歪');
  check(/if \(useDiscount\) await rollbackDiscountCode/.test(sub),
    '域名写入失败时回滚券');
  check(/discountInvalid: true/.test(sub) && /discountExhausted: true/.test(sub),
    '券不可用 / 用量耗尽有明确错误标志供前端提示');
  check(/Math\.min\(base\.payable, value\)/.test(lib),
    '只抵本次应付部分，不找零、不凭空增发积分');
  check(/id="discountCode"/.test(regPage) && /discountCode: dcValue\(\)/.test(reg)
    && /discountCode=' \+ encodeURIComponent/.test(reg),
    '注册页有输入框、查价带码、提交带码');
  check(/data-pay/.test(reg) && /本次实付/.test(regPage),
    '确认页能看到实付积分');
  check(/value = ''/.test(reg) && /券是消耗品/.test(reg),
    '成功后清空已消耗的码，避免「再注册一个」误用');
  check(/DC 码 · 积分/.test(read('src/app/pages/Rewards.tsx'))
    && /注册域名时/.test(rewards),
    '奖励中心说明已改成「注册域名时抵扣」');
  check(/注册域名时抵扣/.test(readme) && /discount-code-regression\.ts/.test(ci)
    && /discountCode/.test(health),
    'README / CI / 健康巡检都覆盖新口径');

  for (const m of ok) console.log('  ✓ ' + m);
  for (const m of bad) console.error('  ✗ ' + m);
  console.log(`DC 码注册抵扣回归：${ok.length} 通过，${bad.length} 失败`);
  if (bad.length) process.exit(1);
}

main().catch((e) => { console.error('回归异常:', e); process.exit(1); });
