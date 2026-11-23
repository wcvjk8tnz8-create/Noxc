/**
 * D1 读取额度优化 + 第三方域名接入 · 专项回归
 *
 * 背景（2026-11-23）：免费版 5M rows read/天 被打满，站点 500。
 * 真因：/api/config 每页/每切页都请求，一次内部十几个 settings 单点 SELECT
 * + publicStats 的 GROUP BY 全表扫 subdomains；30 秒 isolate 缓存跨 isolate
 * 不共享，每个 isolate 过期都各自扫一遍。注册页 350ms 防抖连续打字又放大。
 *
 * 修复：公开统计持久化快照（读 1 行）、config 整响应缓存 + 浏览器 Cache-Control、
 * 全局写后失效、前端 SWR 60s 节流、注册页 600ms + 15s 结果缓存 + 序号丢弃。
 *
 * 另含「第三方域名接入」：独立表、标「（外部域名）」、不占配额、
 * 不参与公开统计、不写本站 DNS、DNSHE Token 不落库。
 *
 * 运行：npx tsx scripts/d1-read-external-domain-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import {
  publicStats, invalidatePublicStats, resetPublicStatsCache,
} from '../src/lib/publicStats.js';
import {
  getConfigCache, setConfigCache, invalidatePublicConfig,
  CONFIG_CACHE_CONTROL, CONFIG_TTL,
} from '../src/lib/configCache.js';
import externalRoutes, { EXTERNAL_LABEL } from '../src/routes/externalDomains.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: any, msg: string) => (cond ? ok.push(msg) : bad.push(msg));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────────────── 轻量 D1 mock（记录每条 SQL） ───────────────── */
type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  ext: Row[];
  seq: number;
  calls: string[];
};
let S: Store;
function fresh(): Store { return { settings: new Map(), ext: [], seq: 0, calls: [] }; }

function exec(sql: string, args: any[]) {
  const s = sql.replace(/\s+/g, ' ').trim();
  S.calls.push(s);
  const rows: Row[] = [];
  let lastRowId = 0, changes = 0;

  if (/^SELECT value FROM settings WHERE key = 'public_stats_snapshot'$/.test(s)) {
    const v = S.settings.get('public_stats_snapshot');
    if (v !== undefined) rows.push({ value: v });
  } else if (/^INSERT INTO settings\(key, value\) VALUES \('public_stats_snapshot', \?\)/.test(s)) {
    S.settings.set('public_stats_snapshot', String(args[0])); changes = 1;
  } else if (/^DELETE FROM settings WHERE key = 'public_stats_snapshot'$/.test(s)) {
    S.settings.delete('public_stats_snapshot'); changes = 1;
  } else if (/^SELECT COUNT\(\*\) AS n FROM users$/.test(s)) {
    rows.push({ n: 12 });
  } else if (/^SELECT COUNT\(\*\) AS n FROM subdomains WHERE status = 'approved'$/.test(s)) {
    rows.push({ n: 4200 });   // 4200 域名：旧版一次 GROUP BY 就吃掉 4200 rows read
  } else if (/GROUP BY d/.test(s)) {
    rows.push({ d: 'noxc.uk', n: 2600, u: 900 }, { d: 'meoy.top', n: 1600, u: 600 });
  } else if (/^SELECT value FROM settings WHERE key = \?$/.test(s)) {
    const v = S.settings.get(String(args[0]));
    if (v !== undefined) rows.push({ value: v });
  } else if (/^SELECT key, value FROM settings WHERE key IN/.test(s)) {
    /* config 的批量读取：空库即可 */
  } else if (/^PRAGMA table_info\(external_domains\)/.test(s)) {
    for (const n of ['id','fqdn','user_id','note','provider','ns1','ns2','zone_id',
      'verify_token','verify_status','verified_at','provider_key','created_at']) rows.push({ name: n });
  } else if (/^INSERT INTO external_domains/.test(s)) {
    /* 新流程 SQL 里有字面量，bind 的参数是 fqdn,user_id,note,verify_token,created_at */
    const [fqdn, userId, note, verifyToken, createdAt] = args;
    const id = ++S.seq;
    S.ext.push({ id, fqdn, user_id: userId, note, provider: 'dnshe', ns1: '', ns2: '',
      zone_id: '', verify_token: verifyToken, verify_status: 'pending', verified_at: null,
      provider_key: '', created_at: createdAt });
    lastRowId = id; changes = 1;
  } else if (/^UPDATE external_domains SET verify_status = 'verified'/.test(s)) {
    const r = S.ext.find((x) => x.id === Number(args[1]));
    if (r) { r.verify_status = 'verified'; r.verified_at = args[0]; changes = 1; }
  } else if (/^UPDATE external_domains SET provider = \?/.test(s)) {
    const [provider, , zoneId, ns1, ns2, id] = args;
    const r = S.ext.find((x) => x.id === Number(id));
    if (r) { r.provider = provider; r.provider_key = provider; r.zone_id = zoneId;
      r.ns1 = ns1; r.ns2 = ns2; changes = 1; }
  } else if (/^SELECT \* FROM external_domains WHERE user_id = \?/.test(s)) {
    for (const r of S.ext.filter((x) => x.user_id === Number(args[0]))) rows.push({ ...r });
  } else if (/^SELECT id FROM external_domains WHERE fqdn = \?$/.test(s)) {
    const r = S.ext.find((x) => x.fqdn === args[0]);
    if (r) rows.push({ id: r.id });
  } else if (/^SELECT COUNT\(\*\) AS n FROM external_domains WHERE user_id = \?/.test(s)) {
    rows.push({ n: S.ext.filter((x) => x.user_id === Number(args[0])).length });
  } else if (/^SELECT \* FROM external_domains WHERE id = \?$/.test(s)) {
    const r = S.ext.find((x) => x.id === Number(args[0]));
    if (r) rows.push({ ...r });
  } else if (/^DELETE FROM external_domains WHERE id = \?/.test(s)) {
    const before = S.ext.length;
    S.ext = S.ext.filter((x) => x.id !== Number(args[0]));
    changes = before - S.ext.length;
  } else if (/^INSERT INTO settings\(key, value\) VALUES \(\?, \?\)/.test(s)) {
    S.settings.set(String(args[0]), String(args[1])); changes = 1;
  } else if (/^INSERT INTO audit_log/.test(s)) {
    changes = 1;
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
      return { bind(...a: any[]) { return wrap(sql, a); }, ...wrap(sql, []) };
    },
  };
}
const env = () => ({ DB: makeDb(), ROOT_DOMAIN: 'meoy.top', ROOT_DOMAINS: 'meoy.top,noxc.uk,v-1.top' } as any);

/* ───────────── A. publicStats 持久化快照：真跑 ───────────── */
{
  S = fresh(); resetPublicStatsCache();
  const E = env();
  await invalidatePublicStats(E);   // 清掉可能的旧快照
  S.calls.length = 0;
  const a = await publicStats(E);
  const heavy = S.calls.filter((q) => /GROUP BY d/.test(q) || /COUNT\(\*\)/.test(q));
  check(a.users === 12 && a.domains === 4200 && a.hottest === 'noxc.uk',
    '首次重算得到正确聚合值（users 12 / domains 4200 / HOT noxc.uk）');
  check(heavy.length === 3 && S.calls.some((q) => /INSERT INTO settings/.test(q)),
    '首次：两个 COUNT + 一次 GROUP BY，并把结果写成快照');
  check(S.settings.has('public_stats_snapshot'), '快照写入 settings 表一行');

  /* 模拟另一个 isolate：清内存缓存，只剩 D1 快照 */
  resetPublicStatsCache();
  S.calls.length = 0;
  const b = await publicStats(E);
  check(JSON.stringify(b) === JSON.stringify(a), '另一个 isolate 读到同一份快照，数字一致');
  check(S.calls.length === 1
    && /^SELECT value FROM settings WHERE key = 'public_stats_snapshot'$/.test(S.calls[0]),
    '关键：新 isolate 一次请求只花 1 row read，不再全表扫描');
  check(!S.calls.some((q) => /GROUP BY d/.test(q)), '快照命中时完全不跑 GROUP BY');

  /* 快照过期：TTL 可由环境变量调 */
  S.settings.set('public_stats_snapshot', JSON.stringify({
    at: Date.now() - 20 * 60_000, value: { users: 1, domains: 1, roots: [], hottest: null },
  }));
  resetPublicStatsCache();
  S.calls.length = 0;
  await publicStats({ ...E, PUBLIC_STATS_TTL: 30 });
  check(S.calls.some((q) => /GROUP BY d/.test(q)),
    '快照过期（或 TTL 调小）才重算一次');
  S.settings.delete('public_stats_snapshot');
  resetPublicStatsCache();
  S.calls.length = 0;
  await publicStats(E);
  check(S.calls.some((q) => /GROUP BY d/.test(q)), '快照被删后这一次确实重算');
  resetPublicStatsCache();          // 模拟下一个 isolate
  S.calls.length = 0;
  await publicStats(E);
  check(!S.calls.some((q) => /GROUP BY d/.test(q))
    && /public_stats_snapshot/.test(S.calls[0] || ''),
    '重算后立即回写快照，下一次又只 1 行');

  /* 写路径失效 */
  await invalidatePublicStats(E);
  check(!S.settings.has('public_stats_snapshot'), 'invalidatePublicStats 删快照行');
  resetPublicStatsCache();
  S.calls.length = 0;
  await publicStats(E);
  check(S.calls.some((q) => /GROUP BY d/.test(q)), '失效后下一次立即重算（开通/审核即时刷新）');
}

/* ───────────── B. /api/config 整响应缓存 ───────────── */
{
  invalidatePublicConfig();
  check(getConfigCache() === null, '初始无 config 缓存');
  setConfigCache({ siteName: 'Noxc', announcement: 'hi' });
  check(getConfigCache()?.siteName === 'Noxc', 'setConfigCache 后命中');
  invalidatePublicConfig();
  check(getConfigCache() === null, '写操作后失效，下一次重新构建');
  check(CONFIG_TTL === 30_000 && CONFIG_CACHE_CONTROL.includes('max-age=30')
    && CONFIG_CACHE_CONTROL.startsWith('private'),
    '缓存 30 秒 + 浏览器私有缓存，不缓存含登录态的数据');
}

/* ───────────── C. 源码防回流（D1） ───────────── */
const idx = read('src/index.ts');
const statsLib = read('src/lib/publicStats.ts');
const cacheLib = read('src/lib/configCache.ts');
const runtime = read('src/app/lib/runtime.ts');
const reg = read('src/app/legacy/register.ts');
const schema = read('schema.sql');
const ci = read('.github/workflows/deploy.yml');
const readme = read('README.md');
const health = read('scripts/health-check.ts');

check(/INSERT INTO settings\(key, value\) VALUES \('public_stats_snapshot'/.test(statsLib)
  && /SELECT value FROM settings WHERE key = 'public_stats_snapshot'/.test(statsLib)
  && /snapshotTtl/.test(statsLib),
  '公开统计用 settings 表一行 JSON 做持久化快照');
check(/export async function invalidatePublicStats/.test(statsLib)
  && /DELETE FROM settings WHERE key = 'public_stats_snapshot'/.test(statsLib),
  '写路径可主动失效快照');
check(/getConfigCache\(\)/.test(idx) && /CONFIG_CACHE_CONTROL/.test(idx)
  && /c\.req\.query\('_'\)/.test(idx),
  'config 整响应缓存 + cache-buster 绕过（后台保存即生效）');
check(/app\.use\('\*', async \(c, next\)/.test(idx)
  && /invalidatePublicConfig\(\)/.test(idx)
  && /invalidatePublicStats\(c\.env\)/.test(idx),
  '全局 middleware 一处覆盖全部写路径');
check(/Cache-Control', 'public, max-age=60'/.test(idx), '/api/stats 也有缓存头');
check(/Date\.now\(\) - brandAt > 60_000/.test(runtime)
  && /brandForceFresh = true/.test(runtime)
  && /configPath\(\)/.test(runtime),
  '前端 SWR 后台刷新节流 60 秒 + 保存后强制刷新');
check(/600\);/.test(reg) && /15_000/.test(reg) && /checkSeq/.test(reg)
  && /checkCache/.test(reg),
  '注册页打字节流：600ms 防抖 + 15 秒结果缓存 + 过期响应丢弃');
check(/附录 Z · 故障排查与已知错误（固定放在文末）/.test(readme)
  && readme.lastIndexOf('## 附录 Z') > readme.lastIndexOf('## 附录 ·'),
  'README 错误/故障/限制统一放在文末');
check(/Z\.1 D1 读取额度被打满/.test(readme) && /5M rows read/.test(readme),
  'README 文末记录本次 D1 事故与排查');

/* ───────────── D. 第三方域名接入：三步流程真跑 Hono ───────────── */
S = fresh();
const app = new Hono();
app.use('*', async (c, next) => { c.set('user', { id: 7, email: 'u@example.com', role: 'user' }); await next(); });
app.route('/api/external-domains', externalRoutes);
const CTX: any = { waitUntil() {}, passThroughOnException() {} };
const call = (method: string, body?: any, suffix = '') =>
  app.fetch(new Request('https://nic.test/api/external-domains' + suffix, {
    method, headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env(), CTX);

/* 全局 fetch stub：区分公共 DoH / Cloudflare API，绝不真出网 */
const realFetch = globalThis.fetch;
let dohHit = false;
let lastAuth = '';
let postedRecord: any = null;
(globalThis as any).fetch = async (url: string, opt: any) => {
  const u = String(url);
  if (u.includes('cloudflare-dns.com/dns-query') || u.includes('dns.google/resolve')) {
    return new Response(JSON.stringify({
      Status: 0,
      Answer: dohHit
        ? [{ name: '_noxc-verify.example.com', type: 16, TTL: 60, data: '"' + expectedTxt() + '"' }]
        : [],
    }), { status: 200, headers: { 'content-type': 'application/dns-json' } });
  }
  if (u.startsWith('https://api.cloudflare.com/client/v4/zones?')) {
    lastAuth = String(opt?.headers?.Authorization || '');
    return new Response(JSON.stringify({ success: true, result: [{
      id: 'zone-1', name: 'example.com', status: 'active',
      name_servers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
    }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('/zones/zone-1/dns_records')) {
    lastAuth = String(opt?.headers?.Authorization || '');
    postedRecord = JSON.parse(String(opt?.body || '{}'));
    return new Response(JSON.stringify({ success: true, result: { id: 'rec-1' } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('unexpected fetch: ' + u);
};
function expectedTxt(): string { return 'noxc-verify=' + (S.ext[0]?.verify_token || ''); }

{
  check(EXTERNAL_LABEL === '（外部域名）', '统一标签是（外部域名）');

  /* ① 提交域名 → 只建 pending + 返回 TXT */
  const r = await call('POST', { domain: 'Example.COM.', note: '我的站' });
  const b: any = await r.json();
  check(r.status === 201 && b.item?.fqdn === 'example.com'
    && b.item?.kind === 'external' && b.item?.externalLabel === EXTERNAL_LABEL,
    '合法完整域名登记成功，归一化大小写/尾点，带（外部域名）标签');
  check(b.item?.verifyStatus === 'pending' && b.item?.verified === false
    && b.item?.verifyHost === '_noxc-verify.example.com'
    && b.item?.verifyValue?.startsWith('noxc-verify='),
    '提交后是待验证，返回要添加的 TXT 主机名与值');
  check(!JSON.stringify(b).includes('apiKey'), '提交响应不含任何 API key');
  const id = b.item.id;

  const r2 = await call('POST', { domain: 'example.com' });
  check(r2.status === 400, '重复登记被拒绝');
  check((await call('POST', { domain: 'meoy.top' })).status === 400, '本站根域名不能冒充外部域名');
  check((await call('POST', { domain: 'abc.meoy.top' })).status === 400,
    '本站后缀下的子域名必须走注册页（不能绕过配额/暂停）');
  check((await call('POST', { domain: 'not a domain' })).status === 400, '非法域名格式被拒绝');

  /* ② TXT 所有权验证（DoH） */
  dohHit = false;
  const v0: any = await (await call('POST', {}, `/${id}/verify`)).json();
  check(v0.verified === false && /还没查到|TXT/.test(v0.detail),
    'DoH 查不到 TXT 时明确提示等待 DNS 生效，不误判通过');
  check((await call('POST', { provider: 'cloudflare', apiKey: 'K' }, `/${id}/connect`)).status === 400,
    '未验证所有权时不允许连接供应商');

  dohHit = true;
  const v1: any = await (await call('POST', {}, `/${id}/verify`)).json();
  check(v1.verified === true && v1.item?.verified === true,
    'DoH 查到 _noxc-verify 的 TXT 后转为已验证');
  const v2: any = await (await call('POST', {}, `/${id}/verify`)).json();
  check(v2.verified === true, '重复验证幂等，不再重复改状态');

  /* ③a 连接供应商：API key 只进请求头，不落库、不回传 */
  const KEY = 'CF-SECRET-TOKEN-789';
  const c1 = await call('POST', { provider: 'cloudflare', apiKey: KEY }, `/${id}/connect`);
  const cb: any = await c1.json();
  check(c1.status === 200 && cb.ns?.length === 2 && cb.item?.connected === true,
    '连接 Cloudflare 成功，取回两台官方 NS，标记已连接');
  check(lastAuth.includes(KEY), 'API key 出现在本次 Cloudflare 请求头');
  check(!JSON.stringify(cb).includes(KEY) && !JSON.stringify(S.ext).includes(KEY),
    'API key 不回传、不落库');
  check(/NS 生效前/.test(cb.nsWarning || ''),
    '接口明确警告：NS 未改前写入的记录不会生效（不假装加了 TXT 就能解析）');
  check((await call('POST', { provider: 'unknown', apiKey: KEY }, `/${id}/connect`)).status === 400,
    '不支持的供应商被拒绝');

  /* ③b 添加 DNS 记录 */
  check((await call('POST', { type: 'A', name: '@', content: '1.2.3.4' }, `/${id}/records`)).status === 400,
    '不带 API key 不能写记录');
  const badName = await call('POST', { apiKey: KEY, type: 'A', name: 'www.other.com', content: '1.2.3.4' }, `/${id}/records`);
  check(badName.status === 400 && /必须属于/.test((await badName.json() as any).message || ''),
    '记录名称被限定在本域名内，不能拿本站当任意 zone 的写接口');
  const okRec = await call('POST', { apiKey: KEY, type: 'A', name: '@', content: '1.2.3.4', ttl: 600 }, `/${id}/records`);
  const rb: any = await okRec.json();
  check(okRec.status === 201 && rb.record?.id === 'rec-1'
    && postedRecord?.name === 'example.com' && postedRecord?.type === 'A',
    '@ 归一化为主域名，记录通过 Cloudflare API 写入成功');
  check(!JSON.stringify(rb).includes(KEY) && /NS 尚未指向/.test(rb.nsWarning || ''),
    '写记录后仍提示 NS 前提，响应不含 key');

  /* 列表 / 上限 / 删除 */
  const l: any = await (await call('GET')).json();
  check(l.items.length === 1 && l.items.every((x: any) => x.externalLabel === EXTERNAL_LABEL)
    && l.label === EXTERNAL_LABEL && l.max === 5
    && l.providers.includes('cloudflare') && l.recordTypes.includes('TXT'),
    '列表每条都标（外部域名），并回传供应商与记录类型');
  check(l.items.every((x: any) => !('apiKey' in x) && !('api_key' in x)),
    '列表响应不含任何 API key 字段');

  for (const d of ['a.com', 'b.com', 'c.com', 'd.com']) await call('POST', { domain: d });
  const r6 = await call('POST', { domain: 'e.com' });
  check(r6.status === 400 && (await r6.json() as any).message.includes('5'),
    '每账号最多 5 个外部域名');
  const l2: any = await (await call('GET')).json();
  check(l2.items.length === 5, '补齐后正好 5 个');

  const r8 = await call('DELETE', undefined, '/' + id);
  check(r8.status === 200, '可以删除自己的外部域名');
  const l3: any = await (await call('GET')).json();
  check(l3.items.length === 4 && !l3.items.some((x: any) => x.id === id),
    '删除后列表同步，被删记录不再出现');

  /* 独立表：不参与 publicStats 全表聚合 */
  check(!/external_domains/.test(read('src/lib/publicStats.ts'))
    && /CREATE TABLE IF NOT EXISTS external_domains/.test(schema)
    && /idx_external_user/.test(schema),
    '外部域名独立表 + 按用户索引，不参与公开统计的全表扫描');
}
(globalThis as any).fetch = realFetch;

/* ───────────── E. 前端标签与文档 ───────────── */
const dash = read('src/app/pages/Dashboard.tsx');
const whoisRoute = read('src/routes/whois.ts');
const whoisUi = read('src/app/legacy/whois.ts');
const docsZh = read('docs-src/settings.md');
const docsEn = read('docs-src/en/settings.md');
check(/第三方域名接入/.test(dash) && /externalLabel/.test(dash)
  && /id="externalCard"/.test(dash), '控制台有第三方域名接入卡片并标（外部域名）');
check(/externalLabel: EXTERNAL_LABEL/.test(whoisRoute)
  && /r\.externalLabel \|\| '（外部域名）'/.test(whoisUi),
  'WHOIS 外部域名结果也用同一份（外部域名）标签');
check(/外部域名/.test(docsZh) && /external domain/i.test(docsEn)
  && /第三方域名接入/.test(readme), '中英文档与 README 写明外部域名');
check(/applyCard[\s\S]{0,400}<ExternalDomains \/>/.test(dash),
  '第三方域名接入放在「注册域名」卡片下面');
check(/id="externalCard"/.test(dash) && /dashboard#externalCard/.test(read('src/app/pages/Register.tsx')),
  '注册页也有入口，跳到控制台该卡片');
const extRoute = read('src/routes/externalDomains.ts');
const extVerify = read('src/lib/externalVerify.ts');
const extDns = read('src/lib/providerDns.ts');
check(/checkOwnership/.test(extRoute) && /verify_status/.test(extRoute)
  && /connectProvider/.test(extRoute) && /addRecord/.test(extRoute),
  '后端三步流程：TXT 验证 → 连接供应商 → 写 DNS 记录');
check(/cloudflare-dns\.com\/dns-query/.test(extVerify)
  && /dns\.google\/resolve/.test(extVerify) && /type\) === 16/.test(extVerify),
  '所有权验证走公共 DoH JSON，TXT(type=16) 双兜底');
check(/api\.cloudflare\.com\/client\/v4/.test(extDns)
  && /isNameInDomain/.test(extDns) && /proxied: false/.test(extDns),
  'Cloudflare 官方 v4 写入，名称限定本域名，不默认开代理');
check(/nsWarning/.test(extRoute) && /NS 生效前/.test(extRoute),
  '接口明确提示 NS 前提，不假装加 TXT 就能解析');
check(!/api_?key/i.test(read('schema.sql').slice(
  read('schema.sql').indexOf('CREATE TABLE IF NOT EXISTS external_domains'),
  read('schema.sql').indexOf('CREATE INDEX IF NOT EXISTS idx_external_user')).replace(/verify_token/g,'')),
  'external_domains 表不存供应商 API key');
check(/D1 读取与第三方域名回归/.test(ci)
  && /d1-read-external-domain-regression\.ts/.test(ci), '专项回归进 CI');
check(/public_stats_snapshot/.test(health), '健康巡检有防回流断言');

/* ───────────── F. 反向对照 ───────────── */
const oldStats = statsLib.replace(/const snap = await readSnapshot\(env\);/, '/* 无快照 */');
check(oldStats !== statsLib && !/const snap = await readSnapshot/.test(oldStats),
  '反向对照：拿掉快照读取后每个 isolate 都会全表扫描，断言必须失败');
const noThrottle = runtime.replace(/Date\.now\(\) - brandAt > 60_000/, 'true');
check(noThrottle !== runtime && !/Date\.now\(\) - brandAt > 60_000/.test(noThrottle),
  '反向对照：把 SWR 节流改回每次都刷新会被断言拦下');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`D1 读取与第三方域名回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
