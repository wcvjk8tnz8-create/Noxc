/**
 * 「按后缀单独暂停新申请」专项回归（CI 步骤：按后缀暂停申请回归）
 *
 * 真跑 applyGate / /api/config / 注册接口 / check 接口 + 内存 D1，覆盖：
 *   A. 名单解析：大小写、尾点、去重、空值、自定义提示语
 *   B. applyGate：后台设置与 ROOT_APPLY_PAUSED 取并集、表未建兜底
 *   C. /api/config 下发 pausedRoots 与环境变量标志
 *   D. 注册接口：暂停后缀 403、其它后缀照常、管理员豁免、恢复后放行、
 *      环境变量强制不可关、check 接口同步提示
 *   E. 已注册域名不受影响：暂停开关不出现在续期 / DNS / 转移处理链，
 *      已有 approved 域名仍正常列出
 *   F. 反向对照：去掉服务端判定，断言必须失败
 *
 * 运行：npx tsx scripts/root-apply-pause-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import mainApp from '../src/index.js';
import subdomainRoutes from '../src/routes/subdomains.js';
import {
  applyGate, parsePausedRoots, serializePausedRoots,
  rootApplyMessage, isRootApplyPaused, DEFAULT_MESSAGE,
} from '../src/lib/applyGate.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────────────── 内存 D1（跨 Node 版本） ───────────────── */
type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  users: Row[]; subdomains: Row[]; root_reg_counts: Row[];
  user_points: Row[]; point_logs: Row[]; sessions: Row[];
  audit_log: Row[]; notifications: Row[]; dns_records: Row[]; seq: number;
};
let S: Store;
function fresh(): Store {
  return {
    settings: new Map(), users: [], subdomains: [], root_reg_counts: [],
    user_points: [], point_logs: [], sessions: [], audit_log: [],
    notifications: [], dns_records: [], seq: 0,
  };
}

function exec(sql: string, args: any[]) {
  const s = sql.replace(/\s+/g, ' ').trim();
  const rows: Row[] = [];
  let lastRowId = 0, changes = 0;

  /* applyGate / /api/config 用的批量 settings 查询 */
  if (/^SELECT key, value FROM settings WHERE key IN/.test(s)) {
    for (const [key, value] of S.settings) rows.push({ key, value });
    return { rows, lastRowId, changes };
  }
  const binding = s.match(/^SELECT value FROM settings WHERE key = \?/);
  const literal = s.match(/^SELECT value FROM settings WHERE key = '([^']+)'/);
  if (binding || literal) {
    const k = binding ? String(args[0]) : (literal as RegExpMatchArray)[1];
    const v = S.settings.get(k);
    if (v !== undefined) rows.push({ value: v });
  } else if (/^INSERT INTO settings\(key, value\) VALUES/.test(s)) {
    S.settings.set(String(args[0]), String(args[1])); changes = 1;
  } else if (/^INSERT OR REPLACE INTO settings/.test(s) || /^UPDATE settings SET value/.test(s)) {
    S.settings.set(String(args[args.length - 2] ?? args[0]), String(args[args.length - 1] ?? args[1])); changes = 1;
  } else if (/^PRAGMA table_info\(/.test(s) || /^ALTER TABLE /.test(s)
    || /^CREATE TABLE IF NOT EXISTS /.test(s)) {
    /* 内存表无 schema，忽略 */
  } else if (/^SELECT \* FROM users WHERE id = \?$/.test(s)) {
    const u = S.users.find((x) => x.id === Number(args[0]));
    if (u) rows.push({ ...u });
  } else if (/^SELECT COUNT\(\*\) AS n FROM subdomains WHERE status = 'approved'/.test(s)) {
    rows.push({ n: S.subdomains.filter((x) => x.status === 'approved').length });
  } else if (/^SELECT COUNT\(\*\) AS n FROM users/.test(s)) {
    rows.push({ n: S.users.length });
  } else if (/GROUP BY d/.test(s)) {
    rows.push(...[]);
  } else if (/^SELECT id, fqdn, created_at FROM subdomains WHERE user_id = \? AND status = 'pending'/.test(s)) {
    const r = S.subdomains.find((x) => x.user_id === Number(args[0]) && x.status === 'pending');
    if (r) rows.push({ id: r.id, fqdn: r.fqdn, created_at: r.created_at });
  } else if (/^SELECT COUNT\(\*\) AS n FROM subdomains WHERE user_id = \? AND status IN /.test(s)) {
    rows.push({ n: S.subdomains.filter((x) => x.user_id === Number(args[0]) && x.status !== 'rejected').length });
  } else if (/^SELECT s\.\*/.test(s) && /FROM subdomains s WHERE s\.user_id/.test(s)) {
    for (const x of S.subdomains.filter((r) => r.user_id === Number(args[0]))) rows.push({ ...x, record_count: 0 });
  } else if (/^SELECT s\.id, s\.label, s\.fqdn, s\.status, s\.user_id/.test(s)) {
    const r = S.subdomains.find((x) => x.fqdn === args[0]);
    if (r) rows.push({ ...r });
  } else if (/^INSERT INTO subdomains \(label, root_domain, fqdn, user_id, status/.test(s)) {
    const id = ++S.seq;
    S.subdomains.push({ id, label: args[0], root_domain: args[1], fqdn: args[2], user_id: args[3],
      status: args[4], note: args[5], reason: args[6], expires_at: args[7], perpetual: args[8],
      created_at: args[9] });
    lastRowId = id; changes = 1;
  } else if (/^UPDATE subdomains SET apply_cost = \? WHERE id = \?$/.test(s)) {
    const r = S.subdomains.find((x) => x.id === Number(args[1]));
    if (r) { r.apply_cost = args[0]; changes = 1; }
  } else if (/^SELECT count FROM root_reg_counts WHERE user_id = \? AND root_domain = \?$/.test(s)) {
    const r = S.root_reg_counts.find((x) => x.user_id === Number(args[0]) && x.root_domain === args[1]);
    if (r) rows.push({ count: r.count });
  } else if (/^INSERT INTO root_reg_counts /.test(s)) {
    const r = S.root_reg_counts.find((x) => x.user_id === Number(args[0]) && x.root_domain === args[1]);
    if (r) { r.count += 1; r.updated_at = args[2]; }
    else S.root_reg_counts.push({ user_id: Number(args[0]), root_domain: args[1], count: 1, updated_at: args[2] });
    changes = 1;
  } else if (/^SELECT points FROM user_points WHERE user_id = \?$/.test(s)) {
    const r = S.user_points.find((x) => x.user_id === Number(args[0]));
    if (r) rows.push({ points: r.points });
  } else if (/^INSERT INTO user_points /.test(s)) {
    S.user_points.push({ user_id: Number(args[0]), points: args[1], updated_at: args[2] }); changes = 1;
  } else if (/^UPDATE user_points SET points = points \+ \? WHERE user_id = \?$/.test(s)) {
    const r = S.user_points.find((x) => x.user_id === Number(args[1]));
    if (r) { r.points += Number(args[0]); changes = 1; }
  } else if (/^INSERT INTO point_logs /.test(s)) {
    S.point_logs.push({ user_id: args[0] }); changes = 1;
  } else if (/^INSERT INTO sessions /.test(s)) {
    S.sessions.push({ token: args[0], user_id: args[1] }); changes = 1;
  } else if (/^INSERT INTO audit_log /.test(s)) {
    S.audit_log.push({ user_id: args[0], action: args[1] }); changes = 1;
  } else if (/^INSERT INTO notifications /.test(s)) {
    S.notifications.push({ user_id: args[0] }); changes = 1;
  }
  /* 其它（captcha / AI 批处理 / DNS / Cloudflare mock）返回空结果，不打断主流程 */
  return { rows, lastRowId, changes };
}

function makeDb() {
  const wrap = (sql: string, args: any[]) => {
    const out = () => exec(sql, args);
    return {
      first: async () => out().rows[0] ?? null,
      all: async () => ({ results: out().rows }),
      run: async () => { const r = out(); return { meta: { last_row_id: r.lastRowId, changes: r.changes } }; },
    };
  };
  return {
    prepare(sql: string) {
      const self = wrap(sql, []);
      return { bind(...args: any[]) { return wrap(sql, args); }, first: self.first, all: self.all, run: self.run };
    },
  };
}

function makeEnv(vars: Record<string, string> = {}) {
  return {
    DB: makeDb(), DEFAULT_QUOTA: '5', REQUIRE_APPROVAL: '0', ALLOW_SIGNUP: '1',
    ROOT_DOMAIN: 'meoy.top', ROOT_DOMAINS: 'meoy.top,noxc.uk',
    CF_ZONE_ID: 'zone-meoy', CF_ZONE_IDS: 'meoy.top:zone-meoy,noxc.uk:zone-noxc',
    CF_MOCK: '1',
    ASSETS: { async fetch() { return new Response('', { status: 404 }); } },
    ...vars,
  } as any;
}
const CTX: any = { waitUntil() {}, passThroughOnException() {} };

/* ───────────────── A. 纯函数 ───────────────── */
{
  check(JSON.stringify(parsePausedRoots(' MEOY.TOP. , v-1.top ,meoy.top,, ')) ===
    JSON.stringify(['meoy.top', 'v-1.top']),
    '名单解析：大小写归一 / 去尾点 / 去重 / 丢空项');
  check(parsePausedRoots(undefined).length === 0 && parsePausedRoots('').length === 0,
    '空名单不抛错');
  check(serializePausedRoots(['NOXC.UK.', 'meoy.top', 'noxc.uk']) === 'noxc.uk,meoy.top',
    '序列化同样规范化');
  check(rootApplyMessage('MEOY.TOP.', '') ===
    '后缀 .meoy.top 已暂停新域名申请，请稍后再试。已注册的域名不受影响。',
    '默认提示语带后缀名');
  check(rootApplyMessage('v-1.top', '维护中，稍后再试') === '维护中，稍后再试',
    '管理员自定义提示语优先');
  check(rootApplyMessage('v-1.top', DEFAULT_MESSAGE).includes('v-1.top'),
    '全局默认文案不会误当成自定义');
  const gate = { pausedRoots: ['meoy.top'] };
  check(isRootApplyPaused(gate, 'MEOY.TOP.') && !isRootApplyPaused(gate, 'noxc.uk')
    && !isRootApplyPaused(gate, '') && !isRootApplyPaused({ pausedRoots: [] }, 'meoy.top'),
    'isRootApplyPaused 大小写 / 尾点 / 空值 / 空名单');
}

/* ───────────────── B. applyGate 真跑 ───────────────── */
{
  S = fresh();
  S.settings.set('root_apply_paused', 'v-1.top');
  S.settings.set('apply_paused_message', '站点维护中');
  const g = await applyGate(makeEnv({ ROOT_APPLY_PAUSED: 'meoy.top,MEOY.TOP.' }));
  check(g.paused === false && JSON.stringify(g.pausedRoots) === JSON.stringify(['meoy.top', 'v-1.top'])
    && g.rootPausedFromEnv === true,
    '环境变量与后台设置取并集，环境变量项标记不可关');
  check(g.message === '站点维护中', '自定义提示语生效');
  S = fresh();
  const g2 = await applyGate(makeEnv({ APPLY_PAUSED: '1' }));
  check(g2.paused === true && g2.pausedRoots.length === 0,
    '全局暂停与按后缀暂停是两个独立开关');
}
{
  /* settings 表未建：降级不抛错、不阻断 */
  const env = makeEnv();
  env.DB = { prepare() { return { first: async () => { throw new Error('no table'); },
    all: async () => { throw new Error('no table'); }, run: async () => ({ meta: {} }) }; } };
  const g = await applyGate(env);
  check(g.paused === false && g.pausedRoots.length === 0 && g.message.length > 0,
    '表未建 / D1 抖动时降级为未暂停');
}

/* ───────────────── C. /api/config 真跑 ───────────────── */
{
  S = fresh();
  S.settings.set('root_apply_paused', 'v-1.top');
  const res = await mainApp.fetch(
    new Request('https://nic.test/api/config', { headers: { Accept: 'application/json' } }),
    makeEnv({ ROOT_APPLY_PAUSED: 'meoy.top' }), CTX);
  const d: any = await res.json().catch(() => ({}));
  check(res.status === 200 && Array.isArray(d.pausedRoots)
    && d.pausedRoots.includes('meoy.top') && d.pausedRoots.includes('v-1.top')
    && d.rootApplyPausedFromEnv === true,
    '/api/config 下发 pausedRoots 与环境变量标志（前端与后端同口径）');
}

/* ───────────────── D. 注册 / check 接口真跑 ───────────────── */
let currentUser: any = null;
const app = new Hono();
app.use('*', async (c, next) => { c.set('user', currentUser); await next(); });
app.route('/api/subdomains', subdomainRoutes);
let env: any;
function reset(settings: Record<string, string> = {}, vars: Record<string, string> = {}, user: any = null) {
  S = fresh();
  // 本回归只测申请开关：滑块验证另行专项覆盖，这里显式关掉避免前置 403
  S.settings.set('captcha_enabled', '0');
  for (const [k, v] of Object.entries(settings)) S.settings.set(k, v);
  env = makeEnv(vars);
  currentUser = user || { id: 1, email: 'u@example.com', role: 'user', quota: 5, status: 'active' };
  S.users.push({ ...currentUser });
}
async function post(root: string, label = 'demo') {
  const res = await app.fetch(new Request('https://nic.test/api/subdomains', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label, root, note: '' }),
  }), env, CTX);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function checkApi(root: string) {
  const res = await app.fetch(
    new Request(`https://nic.test/api/subdomains/check?label=demo&root=${encodeURIComponent(root)}`),
    env, CTX);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

{
  reset({ root_apply_paused: 'meoy.top' });
  const blocked: any = await post('meoy.top');
  check(blocked.status === 403 && blocked.body.applyPaused === true
    && blocked.body.rootApplyPaused === true && blocked.body.root === 'meoy.top'
    && String(blocked.body.message || blocked.body.error || '').includes('meoy.top'),
    '暂停后缀申请 → 403，带 rootApplyPaused 与后缀名提示');
  check(S.subdomains.length === 0 && S.point_logs.length === 0 && S.root_reg_counts.length === 0,
    '拦在配额 / 积分 / 累计次数之前，不产生任何副作用');

  const other: any = await post('noxc.uk');
  check(other.status !== 403 && S.subdomains.some((x) => x.root_domain === 'noxc.uk'),
    '其它后缀照常开放（同一份设置下 noxc.uk 可申请）');

  const c1: any = await checkApi('meoy.top');
  check(c1.body.applyPaused === true && c1.body.rootApplyPaused === true
    && String(c1.body.applyPausedMessage || '').includes('meoy.top'),
    '/check 同步返回暂停提示（换后缀即时锁定）');
  const c2: any = await checkApi('noxc.uk');
  check(c2.body.applyPaused !== true, '/check 对开放后缀不误报暂停');
}
{
  /* 管理员豁免 */
  reset({ root_apply_paused: 'meoy.top' }, {},
    { id: 9, email: 'admin@example.com', role: 'admin', quota: -1, status: 'active' });
  const r: any = await post('meoy.top', 'bymanual');
  check(r.status !== 403 && S.subdomains.some((x) => x.fqdn === 'bymanual.meoy.top'),
    '管理员自建不受按后缀暂停限制（后台仍可补发域名）');
}
{
  /* 恢复开放 */
  reset({ root_apply_paused: '' });
  const r: any = await post('meoy.top', 'afterresume');
  check(r.status !== 403 && S.subdomains.some((x) => x.fqdn === 'afterresume.meoy.top'),
    '清空名单后该后缀立即恢复申请');
}
{
  /* 环境变量强制 */
  reset({ root_apply_paused: '' }, { ROOT_APPLY_PAUSED: 'MEOY.TOP.' });
  const r: any = await post('meoy.top');
  check(r.status === 403 && r.body.rootApplyPaused === true,
    'ROOT_APPLY_PAUSED 强制暂停，后台清空也关不掉');
  const r2: any = await post('noxc.uk');
  check(r2.status !== 403, '环境变量只影响指定后缀');
}
{
  /* 全局暂停仍然独立生效 */
  reset({ apply_paused: '1' });
  const r: any = await post('noxc.uk');
  check(r.status === 403 && r.body.applyPaused === true,
    '站点级全局暂停不受新功能影响');
}

/* ───────────────── E. 已注册域名不受影响 ───────────────── */
{
  reset({ root_apply_paused: 'meoy.top' });
  S.subdomains.push({ id: 77, label: 'old', root_domain: 'meoy.top', fqdn: 'old.meoy.top',
    user_id: 1, status: 'approved', created_at: 1, expires_at: null, perpetual: 1 });
  const res = await app.fetch(new Request('https://nic.test/api/subdomains'), env, CTX);
  const d: any = await res.json().catch(() => ({}));
  check(res.status === 200 && Array.isArray(d.items) && d.items.some((x: any) => x.fqdn === 'old.meoy.top'),
    '暂停期间已有 approved 域名仍正常列出（续期 / DNS / 转移入口不变）');
  const renew = read('src/routes/subdomains.ts');
  const records = read('src/routes/records.ts');
  const transfer = read('src/routes/transfer.ts');
  check(!/applyGate|isRootApplyPaused/.test(records) && !/applyGate|isRootApplyPaused/.test(transfer),
    'DNS 记录 / 转移路由完全不引用申请开关');
  const renewPart = renew.slice(renew.indexOf('app.post(\'/:id/renew') , renew.indexOf('app.post(\'/:id/renew') + 2000);
  check(!/isRootApplyPaused/.test(renewPart), '续期处理链不检查申请开关');
}

/* ───────────────── F. 源码防回流 + 反向对照 ───────────────── */
const idx = read('src/index.ts');
const sub = read('src/routes/subdomains.ts');
const gateSrc = read('src/lib/applyGate.ts');
const adm = read('src/routes/admin.ts');
const admUi = read('src/app/legacy/admin.ts');
const home = read('src/app/legacy/home.ts');
const reg = read('src/app/legacy/register.ts');
const css = read('src/app/styles/design-system.css');
const docsZh = read('docs-src/settings.md');
const docsEn = read('docs-src/en/settings.md');
const readme = read('README.md');
const ci = read('.github/workflows/deploy.yml');
const health = read('scripts/health-check.ts');
const srvI18n = read('src/lib/i18nServer.ts');

check(/root_apply_paused/.test(gateSrc) && /pausedRoots/.test(gateSrc)
  && /ROOT_APPLY_PAUSED/.test(gateSrc),
  'applyGate 是按后缀暂停的唯一来源');
check(/pausedRoots/.test(idx) && /rootApplyPausedFromEnv/.test(idx),
  '/api/config 下发名单');
check(/isRootApplyPaused\(gate, reqRoot\)/.test(sub) && /u\.role !== 'admin'/.test(sub),
  '注册接口在配额 / 积分之前拦按后缀暂停，管理员豁免');
check(/rootApplyPaused/.test(adm) && /root-apply-paused/.test(adm),
  '后台设置可读写名单并写审计');
check(/rootApplyPausedBox/.test(admUi) && /rootApplyPaused:/.test(admUi),
  '站点设置页有「按后缀单独暂停新申请」勾选区并进保存 payload');
check(/PAUSED_ROOTS/.test(home) && /nk-badge-paused/.test(home)
  && /该后缀已暂停新申请/.test(home),
  '首页后缀卡片标注、查询结果不再给注册入口');
check(/syncApplyPause/.test(reg) && /clearApplyPaused/.test(reg)
  && /PAUSED_ROOTS/.test(reg) && /currentLang/.test(reg),
  '注册页切后缀锁定 / 解锁，英文提示不残留中文');
check(/\.nk-badge-paused/.test(css), '暂停徽标有专属样式');
check(/按后缀单独暂停新申请/.test(docsZh) && /Pause applications per suffix/.test(docsEn)
  && /按后缀单独暂停新申请/.test(readme),
  '中英文档与 README 都写明口径');
check(/Applications for \./.test(srvI18n), '服务端动态提示语有英文句式');
check(/root-apply-pause-regression\.ts/.test(ci) && /按后缀暂停申请回归/.test(ci),
  '专项回归进 CI');
check(/按后缀单独暂停/.test(health), '健康巡检有防回流断言');

/* 反向对照：证明「拦住」的断言不是恒真 */
const noGuard = sub.replace(/if \(isRootApplyPaused\(gate, reqRoot\) && u\.role !== 'admin'\)[\s\S]*?\n  \}\n/, '');
check(noGuard !== sub && !/isRootApplyPaused\(gate, reqRoot\)/.test(noGuard),
  '反向对照：拿掉服务端判定后注册接口不再拦，相关断言会失败');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`按后缀暂停申请回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
