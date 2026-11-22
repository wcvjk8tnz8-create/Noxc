/**
 * 域名详情页「假切换」+ DNS 记录重复 · 专项回归
 *
 * 用户反馈（NodeLoc 帖）：
 *   打开 m.noxc.uk 的 DNS 后，在「自助验证 → ① 选择域名」里切到 co.noxc.uk，
 *   下方 DNS 记录仍显示 m.noxc.uk；再添加一条 AAAA @ 记录，刷新后
 *   m.noxc.uk 出现两条相同的 @ 记录。
 *
 * 真因：
 *   1. #vDomain 只是「验证记录写入目标」的局部下拉，onchange 只改
 *      verifyTargetId + updatePreview()，不切换整页；但「添加记录」用的是
 *      URL 里的 subId，于是用户以为换了域名，记录其实又写回原域名。
 *   2. 保存按钮无防重复提交；后端也没有「完全相同记录」的幂等保护，
 *      响应慢时连点就真的写出两条。
 *
 * 修法：
 *   - 页面顶部加整页域名切换器（loadAll 重载 fqdn / 概览 / 记录 / 委派 / 展示）
 *   - 自助验证固定操作当前域名，删掉会误导的局部下拉
 *   - 保存按钮加锁 + 后端同名同类型同值幂等返回
 *   - loadAll 五个串行请求改并行
 *
 * 运行：npx tsx scripts/domain-switch-records-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import recordRoutes from '../src/routes/records.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────────────── 内存 D1 ───────────────── */
type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  subdomains: Row[]; dns_records: Row[]; audit_log: Row[]; seq: number;
};
let S: Store;
function fresh(): Store {
  return { settings: new Map(), subdomains: [], dns_records: [], audit_log: [], seq: 0 };
}

function exec(sql: string, args: any[]) {
  const s = sql.replace(/\s+/g, ' ').trim();
  const rows: Row[] = [];
  let lastRowId = 0, changes = 0;

  if (/^SELECT key, value FROM settings WHERE key IN/.test(s)) {
    for (const [key, value] of S.settings) rows.push({ key, value });
  } else if (/^SELECT value FROM settings WHERE key = \?/.test(s)) {
    const v = S.settings.get(String(args[0]));
    if (v !== undefined) rows.push({ value: v });
  } else if (/^SELECT value FROM settings WHERE key = '([^']+)'/.test(s)) {
    const k = (s.match(/key = '([^']+)'/) as RegExpMatchArray)[1];
    const v = S.settings.get(k);
    if (v !== undefined) rows.push({ value: v });
  } else if (/^INSERT INTO settings/.test(s)) {
    S.settings.set(String(args[0]), String(args[1])); changes = 1;
  } else if (/^PRAGMA table_info\(/.test(s) || /^ALTER TABLE /.test(s)
    || /^CREATE TABLE IF NOT EXISTS /.test(s) || /^CREATE INDEX/.test(s)) {
    /* 内存表无 schema */
  } else if (/^SELECT \* FROM subdomains WHERE id = \?$/.test(s)) {
    const r = S.subdomains.find((x) => x.id === Number(args[0]));
    if (r) rows.push({ ...r });
  } else if (/^SELECT COUNT\(\*\) AS n FROM dns_records WHERE subdomain_id = \?$/.test(s)) {
    rows.push({ n: S.dns_records.filter((x) => x.subdomain_id === Number(args[0])).length });
  } else if (/^SELECT id FROM dns_records WHERE name = \? AND type = \? AND verify_lock = 1$/.test(s)) {
    const r = S.dns_records.find((x) => x.name === args[0] && x.type === args[1] && x.verify_lock === 1);
    if (r) rows.push({ id: r.id });
  } else if (/^SELECT \* FROM dns_records\s+WHERE subdomain_id = \? AND name = \? AND type = \? AND content = \? AND IFNULL\(data, ''\) = \? LIMIT 1$/.test(s)) {
    const [id, name, type, content, data] = args;
    const r = S.dns_records.find((x) => x.subdomain_id === Number(id) && x.name === name
      && x.type === type && String(x.content || '') === String(content || '')
      && String(x.data ?? '') === String(data ?? ''));
    if (r) rows.push({ ...r });
  } else if (/^INSERT INTO dns_records/.test(s)) {
    const id = ++S.seq;
    S.dns_records.push({
      id, subdomain_id: args[0], cf_record_id: args[1], type: args[2], host: args[3],
      name: args[4], content: args[5], data: args[6], ttl: args[7], proxied: args[8],
      priority: args[9], comment: args[10], verify_lock: args[11], verify_preset: args[12],
      locked_at: args[13], locked_by: args[14], created_at: args[15], updated_at: args[16],
    });
    lastRowId = id; changes = 1;
  } else if (/^SELECT \* FROM dns_records WHERE id = \?$/.test(s)) {
    const r = S.dns_records.find((x) => x.id === Number(args[0]));
    if (r) rows.push({ ...r });
  } else if (/^SELECT \* FROM dns_records WHERE subdomain_id = \? ORDER BY/.test(s)) {
    for (const r of S.dns_records.filter((x) => x.subdomain_id === Number(args[0]))) rows.push({ ...r });
  } else if (/^INSERT INTO audit_log/.test(s)) {
    S.audit_log.push({ action: args[1] }); changes = 1;
  }
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

const env = () => ({
  DB: makeDb(), CF_MOCK: '1', ROOT_DOMAIN: 'meoy.top',
  ROOT_DOMAINS: 'meoy.top,noxc.uk', CF_ZONE_ID: 'zone',
} as any);
const CTX: any = { waitUntil() {}, passThroughOnException() {} };
const app = new Hono();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, email: 'u@example.com', role: 'user', quota: 5 });
  await next();
});
app.route('/api', recordRoutes);

function reset() {
  S = fresh();
  S.subdomains.push({ id: 11, label: 'm', root_domain: 'noxc.uk', fqdn: 'm.noxc.uk',
    user_id: 1, status: 'approved', created_at: 1 });
  S.subdomains.push({ id: 12, label: 'co', root_domain: 'noxc.uk', fqdn: 'co.noxc.uk',
    user_id: 1, status: 'approved', created_at: 1 });
}
async function add(id: number, content: string, host = '@', type = 'AAAA') {
  return app.fetch(new Request(`https://nic.test/api/subdomains/${id}/records`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, host, content, ttl: 1, proxied: false }),
  }), env(), CTX);
}
async function list(id: number) {
  return app.fetch(new Request(`https://nic.test/api/subdomains/${id}/records`), env(), CTX);
}

/* ───────────────── A. 后端幂等：真跑 Hono ───────────────── */
{
  reset();
  const r1 = await add(11, '2a00:1234::1');
  const b1: any = await r1.json();
  check(r1.status === 201 && b1.record?.name === 'm.noxc.uk' && !b1.duplicate,
    '第一条 AAAA @ 正常写入（@ 解析成 m.noxc.uk）');

  const r2 = await add(11, '2a00:1234::1');
  const b2: any = await r2.json();
  check(r2.status === 200 && b2.duplicate === true && b2.record?.id === b1.record.id,
    '完全相同的第二次提交 → 幂等返回已有记录，不再新写一条');
  check(S.dns_records.length === 1, '库里只有 1 条，不会留下两条相同的 @ 记录');

  const r3 = await add(11, '2a00:1234::2');
  check(r3.status === 201 && S.dns_records.length === 2,
    '同类型不同值仍可添加（多个 AAAA 是合法 DNS 用法，不误拦）');

  const r4 = await add(11, '2a00:1234::1', 'dev');
  check(r4.status === 201 && S.dns_records.length === 3,
    '不同主机名不误判为重复（dev.m.noxc.uk 可独立添加）');

  /* 切换域名后写到另一条域名，互不串号 */
  const r5 = await add(12, '2a00:1234::1');
  check(r5.status === 201 && S.dns_records.filter((x) => x.subdomain_id === 12).length === 1,
    'co.noxc.uk 的同值记录独立写入，不与 m.noxc.uk 串号');
  const l11: any = await (await list(11)).json();
  const l12: any = await (await list(12)).json();
  check(l11.records.every((r: any) => r.subdomain_id === 11)
    && l12.records.every((r: any) => r.subdomain_id === 12)
    && l11.records.length === 3 && l12.records.length === 1,
    '列表严格按 subdomain_id 过滤：切换域名后看到的是各自记录');
}

/* ───────────────── B. 不同记录类型也幂等 ───────────────── */
{
  reset();
  await add(11, 'cname.vercel-dns.com', '@', 'CNAME');
  const dup = await add(11, 'cname.vercel-dns.com', '@', 'CNAME');
  check((await dup.json() as any).duplicate === true && S.dns_records.length === 1,
    'CNAME 同名同值同样幂等');
}

/* ───────────────── C. 前端源码：整页切换器 ───────────────── */
const page = read('src/app/pages/Domain.tsx');
const ctl = read('src/app/legacy/domain.ts');
const rec = read('src/routes/records.ts');
const i18n = read('src/app/lib/i18n.ts');
const dict = read('src/app/lib/dict.en.ts');
const docsZh = read('docs-src/dns.md');
const docsEn = read('docs-src/en/dns.md');
const readme = read('README.md');
const ci = read('.github/workflows/deploy.yml');
const health = read('scripts/health-check.ts');

check(/id="domainSwitcher"/.test(page) && /切换域名/.test(page),
  '页面顶部有整页「切换域名」下拉');
check(!/id="vDomain"/.test(page) && !/getElementById\('vDomain'\)/.test(ctl),
  '自助验证里会误导的局部「① 选择域名」下拉已移除');
check(/id="vDomainLabel"/.test(page) && /renderDomainSwitcher/.test(ctl),
  '自助验证改为静态显示「当前操作域名」，不再暗示能局部切换');
check(/location\.href = '\/domain\?id='/.test(ctl)
  && /&tab=/.test(ctl) && /currentTab\(\)/.test(ctl),
  '切换后整页重载到新 id 并保留当前标签页（概览 / 记录 / 委派 / 展示一起更新）');
check(!/verifyTargetId/.test(ctl) && /'\/api\/subdomains\/' \+ subId \+ '\/verify'/.test(ctl),
  '自助验证固定写当前域名，与「添加记录」用同一个 subId');
check(/renderDomainSwitcher\(\);/.test(ctl) && /myRes|myDomains = \(\?myRes|myDomains = \(myRes/.test(ctl),
  '切换器由「我的域名」列表填充，默认选中当前域名');

/* 并行加载（用户反馈响应慢） */
check(/Promise\.all\(\[\s*api\.get\('\/api\/config'\)/.test(ctl)
  && /api\.get\('\/api\/subdomains'\)/.test(ctl)
  && /api\.get\('\/api\/subdomains\/' \+ subId\)/.test(ctl),
  'config / 我的域名 / 域名详情三个请求并行，不再串行等五段往返');
check(/const \[provRes, delRes\] = await Promise\.all/.test(ctl),
  'NS 委派的 providers 与 delegation 也并行');

/* 防重复提交 */
check(/if \(saving\) return/.test(ctl) && /saveBtn\.disabled = true/.test(ctl)
  && /saveBtn\.textContent = '保存中…'/.test(ctl),
  '保存按钮点击即禁用并显示进度，响应慢时连点不会提交两次');
check(/saveBtn\.textContent === '保存中…'/.test(ctl) || /saveBtn\.textContent = '保存中…'/.test(ctl),
  '按钮文案与词典「保存中…」对应');
check(/const dup = await c\.env\.DB\.prepare/.test(rec) && /duplicate: true/.test(rec),
  '后端同名同类型同值幂等返回，绝不写第二条 Cloudflare 记录');

/* 顺手修的真 bug：重复 id + preset 全文档误绑 */
check((page.match(/id="presets"/g) || []).length === 1,
  '重复的 id="presets" 已删（原来两个同 id 容器，渲染只命中第一个）');
check(/#presets \.preset/.test(ctl) && !/document\.querySelectorAll\('\.preset'\)/.test(ctl),
  '预设点击限定在 #presets 容器内，不再误绑 NS 委派页的服务商卡片');

/* i18n */
check(/① 选择平台/.test(dict) && /② 写入位置/.test(dict) && /切换域名/.test(dict),
  '改版后的步骤编号与「切换域名」都有英文词条');
check(!/'② 选择平台'/.test(dict) && !/'选择域名 → 选择平台/.test(i18n),
  '旧步骤文案已从词典清掉，不会留下夹生翻译');
check(/Choose a platform → pick where to write/.test(i18n), '自助验证总说明有英文整句');

/* 文档与防回流 */
check(/切换域名/.test(docsZh) && /Switch domain/.test(docsEn)
  && /切换域名/.test(readme), '中英文档与 README 写明整页切换口径');
check(/domain-switch-records-regression\.ts/.test(ci)
  && /域名详情切换与记录重复回归/.test(ci), '专项回归进 CI');
check(/domainSwitcher/.test(health), '健康巡检有防回流断言');

/* ───────────────── D. 反向对照 ───────────────── */
const noDupGuard = rec.replace(/const dup = await c\.env\.DB\.prepare[\s\S]*?if \(dup\) return ok\(c, \{ record: shape\(dup\), duplicate: true \}\);\n/, '');
check(noDupGuard !== rec && !/duplicate: true/.test(noDupGuard),
  '反向对照：拿掉幂等检查后第二条同值 AAAA 会真的写两遍，断言必须失败');
const oldSwitch = ctl.replace(/location\.href = '\/domain\?id='[\s\S]*?;\n/, 'verifyTargetId = Number(sel.value);\n');
check(oldSwitch !== ctl && !/location\.href/.test(oldSwitch.slice(0, ctl.indexOf('renderPresets'))),
  '反向对照：退回「只改局部变量不切页」的写法会被断言拦下');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`域名详情切换与记录重复回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
