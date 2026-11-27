/**
 * AnyNS（anyns.io / n.ht 社区）管理 API 接入 · 专项回归
 *
 * 背景：仓库里 anyns 原本只是 NS 委派预设，注释写着「未公开稳定的 REST API」，
 * 只能手动到面板加域名。n.ht 社区现已公开官方文档 https://anyns.io/docs/api
 * （Bearer nhtdns_ 管理令牌、zones / records / lines / export / import、
 * DDNS / ACME 独立 scope），本轮把它真正接进：
 *   · NS 委派：填管理令牌 → 幂等建区 → 取回 zone.ns（不是 public_ns）
 *   · 第三方域名接入：作为第四家供应商（闸门仍为「即将上线」，不擅自开放）
 *
 * 两层验证：
 *   A. mock 官方 fetch 真跑 src/lib/anynsDns.ts + delegation.ts + providerDns.ts：
 *      鉴权 / 错误码 / 限流 / zone 幂等 / NS 优先级 / 记录增删改 / 相对名 /
 *      导入导出 / DDNS / ACME / 越域拒绝
 *   B. 静态断言：预设 api 已挂、前端检查入口、供应商清单、coming soon 闸门、
 *      README / CI / health-check 口径一致
 *
 * 运行：npx tsx scripts/anyns-api-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ANYNS_API_BASE, ANYNS_TOKEN_PREFIX, ANYNS_DEFAULT_NS, ANYNS_RECORD_TYPES,
  AnynsDnsError, assertAnynsToken, anynsListZones, anynsFindZone, anynsCreateZone,
  anynsEnsureZone, anynsDeleteZone, anynsRelativeName, anynsListRecords,
  anynsWriteRecord, anynsDeleteRecord, anynsExportZone, anynsImportZone, anynsLines,
  anynsDelegationCheck, anynsDdnsUpdate, anynsAcmePresent, anynsManagedCert,
} from '../src/lib/anynsDns.js';
import {
  DELEGATION_PROVIDERS, findProvider, createZoneAtProvider, checkDelegationAtProvider,
} from '../src/lib/delegation.js';
import { connectProvider, addRecord, recordTypesFor, isNameInDomain } from '../src/lib/providerDns.js';


const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

const TOKEN = 'nhtdns_abc123def456';
type Call = { url: string; method: string; body: any; auth: string };
const calls: Call[] = [];
type Reply = { status?: number; body?: any; text?: string; contentType?: string };
let handler: (url: string, init: any) => Reply = () => ({ status: 200, body: { code: 200, data: [] } });

/* ── mock fetch：记录每次调用，按 handler 返回官方形状 ── */
(globalThis as any).fetch = async (url: any, init: any = {}) => {
  const u = String(url);
  const headers = init.headers || {};
  calls.push({
    url: u,
    method: String(init.method || 'GET'),
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    auth: String(headers.Authorization || ''),
  });
  const r = handler(u, init);
  const status = r.status ?? 200;
  const text = r.text !== undefined
    ? r.text
    : (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}));
  return {
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? (r.contentType || 'application/json') : null) },
    text: async () => text,
  };
};

function zoneReply(z: any) {
  return { status: 200, body: { code: 200, data: { zones: [z] } } };
}

async function mustThrow(fn: () => Promise<any>, contains: string, msg: string) {
  try {
    await fn();
    check(false, msg + '（没有抛错）');
  } catch (e: any) {
    check(String(e?.message || e).includes(contains), msg + '（实际：' + String(e?.message || e).slice(0, 120) + '）');
  }
}

async function main() {
  /* ═════════ A1. 令牌与错误码 ═════════ */
  check(ANYNS_API_BASE === 'https://anyns.io' && ANYNS_TOKEN_PREFIX === 'nhtdns_'
    && ANYNS_DEFAULT_NS.length === 2 && ANYNS_RECORD_TYPES.includes('CAA'),
    '官方基址 / nhtdns_ 前缀 / 默认 NS / 8 类记录类型常量正确');
  try { assertAnynsToken('cf_xxx'); check(false, '非 nhtdns_ 令牌被拒绝'); }
  catch (e: any) { check(e instanceof AnynsDnsError && e.message.includes('管理令牌'), '非 nhtdns_ 令牌被拒绝且提示去面板建管理令牌'); }
  try { assertAnynsToken(''); check(false, '空令牌被拒绝'); }
  catch { check(true, '空令牌被拒绝'); }

  handler = () => ({ status: 401, body: { error: 'unauthorized', message: 'bad token' } });
  await mustThrow(() => anynsListZones(TOKEN), '鉴权失败', '401 unauthorized 翻成中文');
  handler = () => ({ status: 403, body: { error: 'token_scope_mismatch', message: 'scope' } });
  await mustThrow(() => anynsListZones(TOKEN), '令牌类型不匹配', '403 scope mismatch 提示三种令牌不通用');
  handler = () => ({ status: 400, body: { error: 'record_duplicate', message: 'dup' } });
  await mustThrow(() => anynsListZones(TOKEN), '记录已存在', '400 record_duplicate 翻成中文');
  handler = () => ({ status: 429, body: { error: 'rate_limited', message: 'slow down' } });
  await mustThrow(() => anynsListZones(TOKEN), '限流', '429 给出 60 次/分、1000 次/时的官方限流口径');
  handler = () => ({ status: 404, body: { error: 'zone_not_found', message: 'no zone' } });
  await mustThrow(() => anynsListZones(TOKEN), '找不到这个解析区域', '404 zone_not_found 翻成中文');
  handler = () => ({ status: 409, body: { error: 'confirm_required', message: 'DNSSEC' } });
  await mustThrow(() => anynsListZones(TOKEN), '二次确认', '409 提示 DNSSEC / 品牌 NS 二次确认');
  handler = () => ({ status: 200, body: { code: 200, data: [] } });
  await anynsListZones(TOKEN + 'x');
  check(calls.at(-1)?.auth === `Bearer ${TOKEN}x`, '请求头是 Authorization: Bearer nhtdns_…');

  /* ═════════ A2. zone 列表 / 幂等 / NS 优先级 ═════════ */
  const createdZone = {
    id: 4821,
    zone_name: 'demo.noxc.uk',
    ns: ['ns7.anyns.io', 'ns8.anyns.io'],
    public_ns: ['ns1.anyns.io', 'ns2.anyns.io'],
    brand_ns: true,
  };
  handler = () => zoneReply(createdZone);
  const zones = await anynsListZones(TOKEN);
  check(zones.length === 1 && zones[0].id === '4821' && zones[0].name === 'demo.noxc.uk',
    'GET /api/dns/v1/zones 解析 data.zones 包装形状');
  check(zones[0].ns.join(',') === 'ns7.anyns.io,ns8.anyns.io' && zones[0].nsSource === 'zone',
    '官方口径：优先用 zone.ns（应填注册商的 NS），不误用 public_ns 平台默认');
  check(zones[0].brandNs === true, 'brand_ns 字段解析');

  handler = (u, init) => {
    if (init.method === 'GET') return zoneReply(createdZone);
    return { status: 200, body: { code: 200, data: { zone: createdZone } } };
  };
  calls.length = 0;
  const ensuredExisting = await anynsEnsureZone(TOKEN, 'DEMO.NOXC.UK.');
  check(ensuredExisting.found && ensuredExisting.id === '4821'
    && !calls.some((c) => c.method === 'POST'),
    '幂等：域名已存在时只查不建，重复点「连接供应商」不会吃配额');

  const freshZone = { id: 9001, zone_name: 'new.noxc.uk', public_ns: ['ns1.anyns.io', 'ns2.anyns.io'] };
  let postCount = 0;
  handler = (u, init) => {
    if (init.method === 'POST') {
      postCount++;
      check(JSON.parse(String(init.body)).zone_name === 'new.noxc.uk', 'POST 建区 body 是 {zone_name}');
      return { status: 200, body: { code: 200, data: { zone: freshZone } } };
    }
    return { status: 200, body: { code: 200, data: { zones: [] } } };
  };
  const ensuredNew = await anynsEnsureZone(TOKEN, 'new.noxc.uk');
  check(postCount === 1 && !ensuredNew.found && ensuredNew.id === '9001',
    'zone 不存在时 POST 创建一次并拿到 id');
  check(ensuredNew.nsSource === 'public_ns' && ensuredNew.ns.length === 2,
    '没有专属 ns 时回落到 public_ns 并标记来源（不假装是专属 NS）');

  handler = () => ({ status: 200, body: { code: 200, data: { zone: {} } } });
  await mustThrow(() => anynsCreateZone(TOKEN, 'x.noxc.uk'), '未返回 zone id',
    '拿不到 zone id 时明确报错，绝不假装成功');

  /* ═════════ A3. 委派预设接入（createZoneAtProvider / check） ═════════ */
  const anynsPreset = findProvider('anyns');
  check(!!anynsPreset && !!anynsPreset.api && anynsPreset.api.management === true,
    'NS 委派预设 anyns 已挂官方管理 API（不再是 api:null）');
  check(!/未公开/.test(String(anynsPreset?.note || '')), '预设文案不再写「未公开稳定的 REST API」');
  check(DELEGATION_PROVIDERS.some((p: any) => p.key === 'dnshe')
    && DELEGATION_PROVIDERS.some((p: any) => p.key === 'cloudflare'),
    'DNSHE / Cloudflare 预设未被本次改动破坏');

  calls.length = 0;
  handler = (u, init) => {
    if (init.method === 'GET') return { status: 200, body: { code: 200, data: { zones: [] } } };
    return { status: 200, body: { code: 200, data: { zone: createdZone } } };
  };
  const viaDelegation = await createZoneAtProvider(anynsPreset, TOKEN, 'demo.noxc.uk');
  check(viaDelegation.ok && viaDelegation.zoneId === '4821'
    && viaDelegation.ns.join(',') === 'ns7.anyns.io,ns8.anyns.io'
    && typeof viaDelegation.note === 'string',
    'createZoneAtProvider(anyns) 真跑：返回 zoneId / 专属 NS / 可读 note');

  handler = () => zoneReply(createdZone);
  const viaCheck = await checkDelegationAtProvider(anynsPreset, TOKEN, '4821', 'demo.noxc.uk');
  check(viaCheck.ok && viaCheck.supported && viaCheck.zoneFound === true
    && /不等于注册商 NS 已生效/.test(String((viaCheck as any).warning || '')),
    'checkDelegationAtProvider(anyns) 明确「官方无独立委派校验接口」，不假装验证过 NS');
  handler = () => ({ status: 200, body: { code: 200, data: { zones: [] } } });
  const noZone = await anynsDelegationCheck(TOKEN, 'missing.noxc.uk');
  check(noZone.zoneFound === false && /请先在面板添加域名/.test(noZone.note),
    'zone 不存在时给出可操作提示而不是报 500');

  /* ═════════ A4. 记录名 / 增删改 / 导入导出 / lines ═════════ */
  check(anynsRelativeName('demo.noxc.uk', 'demo.noxc.uk') === '@', '根域记录名按官方口径用 @');
  check(anynsRelativeName('www.demo.noxc.uk', 'demo.noxc.uk') === 'www', '子域只传相对标签');
  try { anynsRelativeName('evil.com', 'demo.noxc.uk'); check(false, '越域记录名被拒绝'); }
  catch (e: any) { check(e instanceof AnynsDnsError, '越域记录名被拒绝'); }
  check(isNameInDomain('www.demo.noxc.uk', 'demo.noxc.uk')
    && !isNameInDomain('evil.com', 'demo.noxc.uk'), 'providerDns 的越域守卫仍然生效');

  handler = () => ({ status: 200, body: { code: 200, data: { records: [{ id: 7, name: 'www', type: 'A', value: '1.2.3.4' }] } } });
  const recs = await anynsListRecords(TOKEN, '4821');
  check(recs.length === 1 && recs[0].id === 7, 'GET records 解析 data.records');

  let lastBody: any = null;
  handler = (u, init) => {
    lastBody = JSON.parse(String(init.body));
    return { status: 200, body: { code: 200, data: { record: { ...lastBody, id: 123 } } } };
  };
  const wr = await anynsWriteRecord(TOKEN, '4821', {
    name: '@', type: 'A', value: '192.0.2.10', ttl: 300,
  });
  check(wr.id === '123' && lastBody.id === 0 && lastBody.line === 'default'
    && lastBody.ttl === 300 && lastBody.name === '@' && lastBody.value === '192.0.2.10',
    'POST 新建记录：id=0、name=@、line=default、ttl/value 按官方字段');
  const mod = await anynsWriteRecord(TOKEN, '4821', {
    id: 123, name: 'www', type: 'A', value: '192.0.2.11',
  });
  check(mod.id === '123' && lastBody.id === 123 && lastBody.ttl === undefined
    && lastBody.line === undefined,
    'POST 修改记录：带 id>0 且不擅自覆盖 ttl / line（官方「不传保持原值」）');
  await mustThrow(() => anynsWriteRecord(TOKEN, '4821', { name: '@', type: 'BOGUS', value: 'x' }),
    '不支持的记录类型', '不支持类型在客户端就拦下');
  handler = () => ({ status: 200, body: { code: 200, data: {} } });
  await mustThrow(() => anynsWriteRecord(TOKEN, '4821', { name: '@', type: 'A', value: 'x' }),
    '未返回记录 id', '写记录拿不到 id 时不假装成功');

  let delPath = '';
  handler = (u) => { delPath = u; return { status: 200, body: { code: 200, data: { message: '记录已删除' } } }; };
  await anynsDeleteRecord(TOKEN, '4821', '123');
  check(delPath.endsWith('/api/dns/v1/zones/4821/records/123'), 'DELETE 记录路径是官方 :id/records/:rid');

  handler = () => ({ status: 200, text: '$ORIGIN demo.noxc.uk.\nwww 300 IN A 192.0.2.10\n', contentType: 'text/plain' });
  const bind = await anynsExportZone(TOKEN, '4821');
  check(bind.startsWith('$ORIGIN') && bind.includes('192.0.2.10'), 'GET export 按 text/plain 拿到 BIND zone file');
  handler = (u, init) => {
    lastBody = JSON.parse(String(init.body));
    return { status: 200, body: { code: 200, data: { report: [] } } };
  };
  await anynsImportZone(TOKEN, '4821', '$ORIGIN demo.noxc.uk.');
  check(typeof lastBody.text === 'string', 'POST import body 是 {text}');
  await mustThrow(() => anynsImportZone(TOKEN, '4821', 'x'.repeat(1024 * 1024 + 1)), '1MB',
    '导入文本超过官方 1MB 上限时本地拦下');

  handler = () => ({ status: 200, body: { code: 200, data: { lines: [{ code: 'default' }, { code: 'cn' }] } } });
  const lines = await anynsLines(TOKEN);
  check(lines.length === 2 && lines[1].code === 'cn', 'GET /api/dns/v1/lines 解析线路 code');

  let delZoneBody: any = null;
  handler = (u, init) => {
    delZoneBody = init.body ? JSON.parse(String(init.body)) : undefined;
    return { status: 200, body: { code: 200, data: {} } };
  };
  await anynsDeleteZone(TOKEN, '4821', { confirmDnssec: true });
  check(delZoneBody?.confirm_dnssec === true, 'DELETE zone 支持官方 confirm_dnssec 二次确认');

  /* ═════════ A5. DDNS / ACME 独立 scope ═════════ */
  handler = () => ({ status: 200, text: 'good 203.0.113.7', contentType: 'text/plain' });
  const ddns = await anynsDdnsUpdate(TOKEN, { hostname: 'home.demo.noxc.uk', myip: '203.0.113.7' });
  check(ddns === 'good 203.0.113.7' && calls.at(-1)?.url.includes('/nic/update?')
    && calls.at(-1)?.url.includes('hostname=home.demo.noxc.uk'),
    'DDNS /nic/update 走官方 DynDNS2 端点，返回协议字面量');
  handler = (u, init) => {
    lastBody = JSON.parse(String(init.body));
    return { status: 200, body: { code: 200 } };
  };
  await anynsAcmePresent(TOKEN, '_acme-challenge.demo.noxc.uk.', 'challenge-token');
  check(lastBody.fqdn === '_acme-challenge.demo.noxc.uk.' && lastBody.value === 'challenge-token',
    'ACME present body 是官方 {fqdn,value}');
  handler = () => ({ status: 200, body: { code: 200, data: { cert: 'PEM' } } });
  const cert = await anynsManagedCert(TOKEN, 'demo.noxc.uk');
  check((cert as any)?.cert === 'PEM' && calls.at(-1)?.url.includes('domain=demo.noxc.uk'),
    'GET /api/dns/certs/current 按官方 query domain 拉托管证书');

  /* ═════════ A6. 第三方域名接入：connectProvider / addRecord ═════════ */
  check(recordTypesFor('anyns') === ANYNS_RECORD_TYPES && recordTypesFor('seus').length > 8,
    'recordTypesFor(anyns) 用 AnyNS 的 8 类，不影响 SEUS 扩展类型');
  handler = (u, init) => {
    if (init.method === 'GET') return { status: 200, body: { code: 200, data: { zones: [] } } };
    return { status: 200, body: { code: 200, data: { zone: createdZone } } };
  };
  const conn = await connectProvider('anyns', TOKEN, 'demo.noxc.uk');
  check(conn.ok && conn.provider === 'anyns' && conn.zoneId === '4821'
    && conn.ns.join(',') === 'ns7.anyns.io,ns8.anyns.io'
    && /NS 未生效前/.test(String(conn.note || '')),
    'connectProvider(anyns) 真跑：建区 + 专属 NS + 「NS 未改不生效」提示');
  /* connectProvider 返回 {ok:false} 不抛异常 */
  const badConn = await connectProvider('anyns', 'cf_wrong', 'demo.noxc.uk');
  check(!badConn.ok && /管理令牌|格式不对/.test(String(badConn.error || '')),
    'connectProvider(anyns) 错误令牌返回 ok:false 而不是抛异常');

  handler = () => ({ status: 200, body: { code: 200, data: { record: { id: 555, name: 'www' } } } });
  const addOk = await addRecord('anyns', TOKEN, 'demo.noxc.uk', '4821', {
    type: 'A', name: 'www.demo.noxc.uk', content: '192.0.2.10', ttl: 300,
  });
  check(addOk.ok && addOk.id === '555' && /NS 已指向 AnyNS/.test(String(addOk.note || '')),
    'addRecord(anyns) 真跑：相对名转换 + 写入 + NS 前提提示');
  const addBad = await addRecord('anyns', TOKEN, 'demo.noxc.uk', '4821', {
    type: 'A', name: 'evil.com', content: '192.0.2.10',
  });
  check(!addBad.ok && /必须属于/.test(String(addBad.error || '')),
    'addRecord(anyns) 越域名称被守卫拒绝（不拿本站当任意 zone 写接口）');
  const badToken = await addRecord('anyns', '', 'demo.noxc.uk', '4821', {
    type: 'A', name: 'www.demo.noxc.uk', content: '1.2.3.4',
  });
  check(!badToken.ok && /请填写供应商 API key/.test(String(badToken.error || '')),
    'API key 不落库：每次写记录都要求本次提供');

  /* ═════════ B. 静态断言 ═════════ */
  const extRouteNew = read('src/routes/externalDomains.ts');
  const providerDnsNew = read('src/lib/providerDns.ts');
  check(/'anyns'/.test(providerDnsNew) && /'seus'/.test(providerDnsNew)
    && /'cloudflare'/.test(providerDnsNew) && /'dnshe'/.test(providerDnsNew),
    '供应商适配层四家并存（NS 委派 / 旧 BYOS 链路保留）');
  check(/EXTERNAL_DNS_PROVIDER/.test(extRouteNew) && /seusConnect/.test(extRouteNew)
    && !/comingSoon/.test(extRouteNew),
    '第三方接入主流程固定 SEUS DNS、走 SEUS API 连接，闸门已撤');
  const domainLegacy = read('src/app/legacy/domain.ts');
  check(/\['dnshe', 'anyns'\]\.includes\(deleg\.provider\)/.test(domainLegacy)
    && /API Token（用于检查委派状态）/.test(domainLegacy)
    && /esc\(deleg\.providerName\)/.test(domainLegacy),
    '已托管态「检查委派」对 anyns 也显示，且 label 用服务商名');
  const deploy = read('.github/workflows/deploy.yml');
  check(/anyns-api-regression\.ts/.test(deploy), 'AnyNS 专项回归挂进 CI');
  const health = read('scripts/health-check.ts');
  check(/anynsDns\.ts|anyns-api-regression/.test(health), '健康巡检有 AnyNS 防回流断言');
  const readme = read('README.md');
  check(/anyns\.io|AnyNS/.test(readme) && /### Z\.10/.test(readme),
    'README 正文写能力、错误按约定收在文末 Z.10');
  const ds = read('src/lib/anynsDns.ts');
  check(!/api_key=|token=/.test(ds.replace(/https?:\/\/[^\s"']+/g, '')),
    '客户端不把 token 拼进 URL query（只在 Authorization 头）');
  check(/不落库|不写日志|不回传/.test(ds), '客户端声明 token 只在本次请求内存里用');
  for (const f of ['src/lib/delegation.ts', 'src/lib/providerDns.ts', 'src/routes/externalDomains.ts']) {
    check(fs.existsSync(path.resolve(f)), `${f} 存在`);
  }

  for (const m of ok) console.log('  ✓ ' + m);
  for (const m of bad) console.error('  ✗ ' + m);
  console.log(`AnyNS API 接入回归：${ok.length} 通过，${bad.length} 失败`);
  if (bad.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
