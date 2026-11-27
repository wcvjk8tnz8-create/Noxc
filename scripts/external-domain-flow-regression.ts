/**
 * 第三方域名接入 · 站长定版流程 · 专项回归
 *
 * 真跑：准入策略 → 提交申请 → TXT 所有权验证 → 改 NS → SEUS API 连接 →
 *       站长审批 → 根域名锁定 → cf.ts 把记录写进 SEUS
 *       （mock SEUS MCP / TXT+NS DoH + 内存 D1 + Hono）
 *
 * 流程口径：
 *   · 只允许 gTLD 二级域（xxx.com ✓ / xxx.example.com ✗ / xxx.cn ✗）
 *   · 固定 SEUS DNS，不提供供应商选择
 *   · **先 TXT 验证、后改 NS**：未验证时 connect / check-ns / 批准全被后端拒绝
 *   · 站点级 SEUS MCP Token 优先；用户临时 Token 仅本次连接、不落库
 *   · 站长在「站点设置 → 第三方域名接入」批准后才生效
 *   · 批准后根域名 DNS 后端锁死 seus，下拉与切换接口都不可改
 *
 * 运行：npx tsx scripts/external-domain-flow-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import {
  validateExternalDomain, normalizeExternalDomain, isGtldRegistrable,
  EXTERNAL_DNS_PROVIDER, EXTERNAL_NS, GTLD_SET, EXTERNAL_FLOW_HINT,
} from '../src/lib/externalDomainPolicy.js';
import { invalidateSettings } from '../src/lib/settingsCache.js';
import { clearDnsProviderCache, backendFor, cfCreate } from '../src/lib/cf.js';
import { clearSeusBackendCache } from '../src/lib/seusBackend.js';
import { setDnsBackend, getBackendMap, externalLockedRoots } from '../src/lib/rootStore.js';
import externalRoutes, { EXTERNAL_LABEL, markLegacyExternalVerified, LEGACY_VERIFY_TOKEN } from '../src/routes/externalDomains.js';
import adminRoutes from '../src/routes/admin.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────── 内存 D1（记录 SQL，覆盖 settings / external_domains / audit） ───────── */
type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  ext: Row[];
  users: Row[];
  seq: number;
  calls: string[];
};
let S: Store;
function fresh(): Store {
  return {
    settings: new Map<string, string>([
      ['root_domains_extra', ''], ['root_dns_backends', ''],
      ['root_domains_disabled', ''], ['cf_zone_ids_extra', ''],
      ['anyns_zone_ids', ''], ['external_root_lock', ''],
      ['seus_zone_ids', ''], ['seus_api_token', 'mbt_site_token'],
    ]),
    ext: [],
    users: [{ id: 7, email: 'user@example.com' }],
    seq: 0,
    calls: [],
  };
}
S = fresh();

const EXTERNAL_COLS = [
  'id', 'fqdn', 'user_id', 'note', 'provider', 'ns1', 'ns2', 'zone_id',
  'verify_token', 'verify_status', 'verified_at', 'provider_key',
  'status', 'reviewed_at', 'reviewed_by', 'review_note',
  'connected_at', 'ns_delegated', 'api_source', 'created_at',
];

function normSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}
function exec(sql: string, args: any[]) {
  const s = normSql(sql);
  S.calls.push(s);
  const rows: Row[] = [];
  let lastRowId = 0, changes = 0;

  if (/^PRAGMA table_info\(external_domains\)/.test(s)) {
    for (const n of EXTERNAL_COLS) rows.push({ name: n });
  } else if (/^SELECT key, value FROM settings$/.test(s)) {
    for (const [key, value] of S.settings) rows.push({ key, value: String(value) });
  } else if (/^SELECT key, value FROM settings WHERE key IN/.test(s)) {
    for (const [key, value] of S.settings) rows.push({ key, value: String(value) });
  } else if (/^SELECT value FROM settings WHERE key = \?$/.test(s)) {
    const v = S.settings.get(String(args[0]));
    if (v !== undefined) rows.push({ value: v });
  } else if (/^INSERT INTO settings\(key, value\)/.test(s)) {
    S.settings.set(String(args[0]), String(args[1])); changes = 1;
  } else if (/^INSERT INTO audit_log/.test(s)) {
    changes = 1;
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
  } else if (/^SELECT e\.\*, u\.email AS user_email/.test(s)) {
    for (const r of S.ext) {
      const u = S.users.find((x) => x.id === r.user_id);
      rows.push({ ...r, user_email: u?.email || '' });
    }
  } else if (/^INSERT INTO external_domains/.test(s)) {
    /* 列顺序（字面量列已省略）：fqdn,user_id,note,ns1,ns2,verify_token,created_at */
    const [fqdn, userId, note, ns1, ns2, verifyToken, createdAt] = args;
    const id = ++S.seq;
    S.ext.push({
      id, fqdn, user_id: userId, note, provider: 'seus',
      ns1, ns2, zone_id: '', verify_token: verifyToken || '',
      verify_status: 'pending', verified_at: null,
      status: 'pending', connected_at: 0,
      ns_delegated: 0, api_source: '', created_at: createdAt,
      reviewed_at: null, reviewed_by: '', review_note: '',
    });
    lastRowId = id; changes = 1;
  } else if (/^UPDATE external_domains SET verify_status = 'verified', verified_at = \?, verify_token = \?/.test(s)) {
    /* 存量迁移：只命中 verify_token 为空且已连上 zone 的旧行，幂等 */
    for (const r of S.ext) {
      if (r.verify_token === '' && r.zone_id !== '' && r.verify_status === 'pending') {
        r.verify_token = args[1];
        r.verify_status = 'verified';
        r.verified_at = args[0];
        changes++;
      }
    }
  } else if (/^UPDATE external_domains/.test(s)) {
    const id = Number(/AND status = \?/.test(s) ? args[args.length - 2] : args[args.length - 1]);
    const r = S.ext.find((x) => x.id === id);
    if (r) {
      if (/SET verify_status = 'verified', verified_at = \? WHERE id = \?/.test(s)) {
        r.verify_status = 'verified';
        r.verified_at = args[0];
      } else if (/SET provider = 'seus', zone_id = \?/.test(s)) {
        /* bind: zoneId, ns1, ns2, connected_at, ns_delegated, api_source, id */
        [r.zone_id, r.ns1, r.ns2, r.connected_at, r.ns_delegated, r.api_source] = args;
      } else if (/SET ns_delegated = \?/.test(s)) {
        r.ns_delegated = args[0];
      } else if (/SET status = 'approved'/.test(s)) {
        [r.reviewed_at, r.reviewed_by, r.review_note] = args;
        r.status = 'approved';
      } else if (/SET status = 'rejected'/.test(s)) {
        [r.reviewed_at, r.reviewed_by, r.review_note] = args;
        r.status = 'rejected';
      }
      changes = 1;
    }
  } else if (/^DELETE FROM external_domains WHERE id = \?/.test(s)) {
    const before = S.ext.length;
    S.ext = S.ext.filter((x) => x.id !== Number(args[0]));
    changes = before - S.ext.length;
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
const env = (extra: Record<string, any> = {}) => ({
  DB: makeDb(),
  ROOT_DOMAIN: 'meoy.top',
  ROOT_DOMAINS: 'meoy.top,noxc.uk,v-1.top',
  ...extra,
} as any);

/* ───────── mock fetch：SEUS MCP + DoH NS ───────── */
let seusCalls: Array<{ method: string; name?: string; args?: any }> = [];
let nsDelegated = true;
let txtValue = '';   // 当前 DNS 服务商上「实际存在」的 TXT 值，用来控制验证结果
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url || '');
  if (url.includes('cloudflare-dns.com/dns-query') || url.includes('dns.google/resolve')) {
    /* TXT 所有权查询（type=16）与 NS 委派查询走同一个 DoH mock */
    const answer = url.includes('type=TXT')
      ? (txtValue ? [{ type: 16, data: `"${txtValue}"` }] : [])
      : (nsDelegated
        ? [{ type: 2, data: 'a.ns.fs5.net.' }, { type: 2, data: 'b.ns.fs5.net.' }]
        : [{ type: 2, data: 'ns1.other-dns.com.' }]);
    return new Response(JSON.stringify({ Answer: answer }),
      { status: 200, headers: { 'content-type': 'application/dns-json' } });
  }
  if (url.includes('s.eus/api/mcp')) {
    const body = JSON.parse(String(init.body || '{}'));
    seusCalls.push({ method: body.method, name: body.params?.name, args: body.params?.arguments });
    const headers: Record<string, string> = {
      'content-type': 'application/json', 'Mcp-Session-Id': 'sess-1',
    };
    if (body.method === 'notifications/initialized') return new Response('', { status: 202, headers });
    let data: any = {};
    if (body.method === 'initialize') data = { protocolVersion: '2025-06-18' };
    else if (body.params?.name === 'dns_zones') data = { zones: [{ id: '4821', name: 'xxx.com', status: 'active' }] };
    else if (body.params?.name === 'dns_record_create') data = { id: '9100', ...body.params.arguments };
    else if (body.params?.name === 'dns_records_export') data = { records: [] };
    return new Response(JSON.stringify({
      jsonrpc: '2.0', id: body.id ?? 1,
      result: { content: [{ type: 'text', text: JSON.stringify(data) }] },
    }), { status: 200, headers });
  }
  throw new Error('unexpected fetch: ' + url);
}) as any;

async function main() {
  /* ═════════ A. 准入策略 ═════════ */
  check(EXTERNAL_DNS_PROVIDER === 'seus' && EXTERNAL_NS.join(',') === 'a.ns.fs5.net,b.ns.fs5.net',
    '固定使用 SEUS DNS，权威服务器 a/b.ns.fs5.net');
  check(validateExternalDomain('https://xxx.com').ok
    && validateExternalDomain('XXX.COM').domain === 'xxx.com',
    'xxx.com 通过，URL 前缀 / 大小写 / 尾点归一化');
  check(!validateExternalDomain('https://xxx.example.com').ok
    && /不接受子域名/.test(validateExternalDomain('xxx.example.com').reason),
    'xxx.example.com 被拒：只允许注册局级别的二级域');
  check(!validateExternalDomain('a.b.com').ok && !validateExternalDomain('sub.xxx.top').ok,
    '三级 / 多级子域一律拒绝');
  for (const d of ['xxx.cn', 'xxx.uk', 'xxx.cc', 'xxx.io', 'xxx.ai', 'xxx.tv', 'xxx.co', 'xxx.hk', 'xxx.co.uk']) {
    check(!validateExternalDomain(d).ok, `${d} 被拒（ccTLD / 公共后缀不在 gTLD 白名单）`);
  }
  check(!validateExternalDomain('example.com').ok && !validateExternalDomain('test.com').ok,
    '文档示例 / 保留域名被拒');
  check(!validateExternalDomain('v-1.top', true).ok && /本站后缀/.test(validateExternalDomain('v-1.top', true).reason),
    '本站已生效后缀不能冒充外部域名（用白名单内的 .top 测，排除 ccTLD 先被拒的干扰）');
  check(isGtldRegistrable('xxx.xyz') && isGtldRegistrable('xxx.top')
    && isGtldRegistrable('xxx.online') && GTLD_SET.size > 50,
    '常见新通用顶级域 .xyz / .top / .online 放行，白名单可维护');
  check(!validateExternalDomain('').ok && !validateExternalDomain('bad_label_.com').ok
    && !validateExternalDomain('-x.com').ok,
    '空值 / 下划线 / 连字符开头等非法格式被拒');
  check(/SEUS|gTLD|站长/.test(EXTERNAL_FLOW_HINT)
    && EXTERNAL_FLOW_HINT.indexOf('验证 TXT') < EXTERNAL_FLOW_HINT.indexOf('才到注册商把 NS'),
    '接入说明顺序正确：先 TXT 验证、后改 NS，再 SEUS API / 站长批准');

  /* ═════════ B. 提交申请（Hono 真跑） ═════════ */
  invalidateSettings();
  S = fresh();
  let role = 'user';
  const userApp = new Hono();
  userApp.use('*', async (c, next) => {
    c.set('user', { id: 7, email: 'user@example.com', role });
    await next();
  });
  userApp.route('/api/external-domains', externalRoutes);
  const CTX: any = { waitUntil() {}, passThroughOnException() {} };
  const callUser = (method: string, suffix = '', body?: any, e2: any = env()) =>
    userApp.fetch(new Request('https://nic.test/api/external-domains' + suffix, {
      method, headers: { 'content-type': 'application/json', 'X-Lang': 'zh' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), e2, CTX);

  const rejectedSub = await callUser('POST', '', { domain: 'xxx.example.com' });
  check(rejectedSub.status === 400 && /不接受子域名/.test(String((await rejectedSub.json() as any).message)),
    '提交子域名 → 400，理由明确');
  const rejectedCc = await callUser('POST', '', { domain: 'xxx.cn' });
  check(rejectedCc.status === 400 && /gTLD/.test(String((await rejectedCc.json() as any).message)),
    '提交 ccTLD → 400，理由明确');

  const added = await callUser('POST', '', { domain: 'https://xxx.com', note: '我的站' });
  const addedJson: any = await added.json();
  check(added.status === 201 && addedJson.success === true
    && addedJson.item.fqdn === 'xxx.com' && addedJson.item.status === 'pending'
    && addedJson.item.provider === 'seus',
    '提交 xxx.com → 201，状态「待站长批准」，provider 固定 seus');
  check(addedJson.ns.join(',') === EXTERNAL_NS.join(','), '响应回 SEUS NS 供用户去注册商修改');
  check(S.ext.length === 1 && S.ext[0].status === 'pending' && S.ext[0].zone_id === ''
    && S.ext[0].verify_status === 'pending' && /^[0-9a-f]{32}$/.test(S.ext[0].verify_token || ''),
    '申请只落一行 pending，未连接、未写任何 DNS，生成 32 位验证 token');
  check(addedJson.item.verified === false
    && addedJson.item.verifyHost === '_noxc-verify.xxx.com'
    && /^noxc-verify=[0-9a-f]{32}$/.test(addedJson.item.verifyValue || '')
    && /验证通过前不要改 NS/.test(String(addedJson.next)),
    '提交即回专属 TXT 记录名/值，并明确「验证通过前不要改 NS」');
  check(addedJson.item.verify_token === undefined && addedJson.token === undefined
    && /^noxc-verify=[0-9a-f]{32}$/.test(addedJson.item.verifyValue || ''),
    '响应只回拼好的 TXT 值，不额外回裸 token 字段');
  const dup = await callUser('POST', '', { domain: 'xxx.com' });
  check(dup.status === 400 && /已被登记/.test(String((await dup.json() as any).message)),
    '重复域名（含待审核）不允许再提交');

  const list = await callUser('GET');
  const listJson: any = await list.json();
  check(list.status === 200 && listJson.items.length === 1
    && listJson.provider === 'seus' && listJson.siteTokenReady === true,
    '列表返回我的申请 + 固定 provider + 站点级令牌已就绪布尔');
  check(!/mbt_site_token/.test(JSON.stringify(listJson)), '公开列表绝不回显 SEUS 令牌');

  /* ═════════ C0. TXT 所有权验证（顺序硬锁） ═════════ */
  /* 未验证：connect / check-ns 都被后端挡住，绕过前端也跳不过 */
  const earlyConn = await callUser('POST', '/1/connect', {});
  check(earlyConn.status === 400 && /TXT 记录并完成所有权验证/.test(String((await earlyConn.json() as any).message)),
    '未验证 TXT 就点「用 API 连接」→ 400，明确要求先验证');
  const earlyNs = await callUser('POST', '/1/check-ns', {});
  check(earlyNs.status === 400 && /TXT 记录并完成所有权验证/.test(String((await earlyNs.json() as any).message)),
    '未验证 TXT 就「重新检查 NS」→ 400（不该先改 NS）');
  check(!seusCalls.some((c) => c.name === 'dns_zones'),
    '未验证时连 SEUS API 都没调，不会提前产生托管区域');

  /* TXT 还没加：验证失败但提示明确，不算错误 */
  txtValue = '';
  const verifyMiss = await callUser('POST', '/1/verify', {});
  check(verifyMiss.status === 400 && /还没查到 _noxc-verify\.xxx\.com 的 TXT/.test(String((await verifyMiss.json() as any).message)),
    '原 DNS 上没加 TXT → 明确提示记录名，不算内部错误');
  check(S.ext[0].verify_status === 'pending', '验证失败不落 verified 状态');

  /* TXT 加上后：验证通过并持久化 */
  txtValue = String(addedJson.item.verifyValue || '');
  const verified = await callUser('POST', '/1/verify', {});
  const verifiedJson: any = await verified.json();
  check(verified.status === 200 && verifiedJson.item.verified === true
    && S.ext[0].verify_status === 'verified' && S.ext[0].verified_at,
    'TXT 验证通过，verify_status / verified_at 落库');
  check(/现在才去注册商把 NS/.test(String(verifiedJson.next))
    && String(verifiedJson.next).indexOf('TXT 验证通过') < String(verifiedJson.next).indexOf('NS 改为'),
    '验证通过的下一步才提示改 NS，顺序不倒');
  const again = await callUser('POST', '/1/verify', {});
  check(again.status === 200 && (await again.json() as any).already === true,
    '重复点验证幂等返回 already，不重复写库');
  /* 验证通过后即使把 TXT 从原 DNS 删掉，也仍可继续（状态已持久化） */
  txtValue = '';

  /* 存量迁移：上一版没生成 token 但已连上 zone 的旧申请一次性放行 */
  S.settings.delete('external_verify_legacy_v1');   // 模拟全新库首次跑迁移
  S.ext.push({ ...S.ext[0], id: 99, verify_token: '', verify_status: 'pending',
    verified_at: null, zone_id: '4821' });
  const migrated = await markLegacyExternalVerified(env());
  check(migrated >= 1 && S.ext.find((x) => x.id === 99)?.verify_status === 'verified'
    && S.ext.find((x) => x.id === 99)?.verify_token === LEGACY_VERIFY_TOKEN
    && S.ext[0].verify_status === 'verified',
    '存量旧申请一次性迁移放行，不动新申请');
  const migratedTwice = await markLegacyExternalVerified(env());
  check(migratedTwice === 0, '迁移 UPDATE 幂等，连跑两次不重复放行');
  S.ext = S.ext.filter((x) => x.id !== 99);

  /* ═════════ C. SEUS API 连接 ═════════ */
  seusCalls.length = 0;
  const conn = await callUser('POST', '/1/connect', {});
  const connJson: any = await conn.json();
  check(conn.status === 200 && connJson.success === true && connJson.zoneId === '4821',
    '用 SEUS API 连接成功，查到托管区域 #4821');
  check(S.ext[0].zone_id === '4821' && S.ext[0].api_source === 'site'
    && S.ext[0].ns_delegated === 1,
    '连接只落 zone id / 令牌来源 / NS 委派状态，不落任何凭据');
  check(!JSON.stringify(connJson).includes('mbt_site_token'),
    '连接响应不回显站点级令牌');
  check(seusCalls.some((c) => c.name === 'dns_zones'),
    '确实调了 SEUS 官方 dns_zones 工具（不是假装连接成功）');
  check(connJson.item.connected === true && connJson.nsDelegated === true,
    'shape 标记已连接 / NS 已生效');
  /* 后台那个框留空时，允许用户临时填自己的 mbt_ Token 完成连接。
     令牌来源只有 settings.seus_api_token，没有环境变量 / Worker Secret 分支。 */
  S.settings.set('seus_api_token', '');
  invalidateSettings();
  const conn2 = await callUser('POST', '/1/connect', { apiToken: 'mbt_user_token' });
  check(conn2.status === 200 && S.ext[0].api_source === 'user',
    '后台框留空时允许用户临时填 mbt_ Token 完成连接');
  check(!S.calls.some((q) => /mbt_user_token/.test(q)) && !JSON.stringify(S.ext).includes('mbt_user_token'),
    '用户临时 Token 不落库、不进 SQL');
  const noToken = await callUser('POST', '/1/connect', {});
  const noTokenJson: any = await noToken.json();
  check(noToken.status === 400 && /留空也能用/.test(String(noTokenJson.message)),
    '后台留空且用户不填 → 明确提示可临时自带，不假装连接成功');
  /* 恢复后台令牌（E 段 cfCreate 站点级后端要用） */
  S.settings.set('seus_api_token', 'mbt_site_token');
  invalidateSettings();
  clearSeusBackendCache();

  /* ═════════ D. 站长审批（Hono 真跑 admin 路由） ═════════ */
  invalidateSettings();
  S.ext[0].api_source = 'site';
  const adminApp = new Hono();
  adminApp.use('*', async (c, next) => {
    c.set('user', { id: 1, email: 'admin@example.com', role: 'admin' });
    await next();
  });
  adminApp.route('/api/admin', adminRoutes);
  const callAdmin = (method: string, suffix: string, body?: any) =>
    adminApp.fetch(new Request('https://nic.test/api/admin' + suffix, {
      method, headers: { 'content-type': 'application/json', 'X-Lang': 'zh' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env(), CTX);

  const reqList = await callAdmin('GET', '/external-domains');
  const reqJson: any = await reqList.json();
  check(reqList.status === 200 && reqJson.items.length === 1
    && reqJson.items[0].fqdn === 'xxx.com' && reqJson.items[0].connected === true
    && reqJson.items[0].userEmail === 'user@example.com',
    '站长在站点设置能看到申请：域名 / 申请人 / SEUS 连接状态');
  check(!/mbt_/.test(JSON.stringify(reqJson)), '审批列表不回显任何令牌');

  /* 未通过 TXT 验证不能批准（后端兜底，绕过前端也拦得住） */
  S.ext[0].verify_status = 'pending';
  const noVerifyApprove = await callAdmin('POST', '/external-domains/1/approve', {});
  check(noVerifyApprove.status === 400 && /TXT 所有权验证/.test(String((await noVerifyApprove.json() as any).message)),
    '站长也不能批准未做 TXT 验证的申请');
  S.ext[0].verify_status = 'verified';

  /* 未连接不能批准 */
  S.ext[0].zone_id = '';
  const early = await callAdmin('POST', '/external-domains/1/approve', {});
  check(early.status === 400 && /还没用 SEUS API 连接成功/.test(String((await early.json() as any).message)),
    '没连上 SEUS 的申请不允许批准');
  S.ext[0].zone_id = '4821';

  invalidateSettings();
  clearSeusBackendCache();
  const approved = await callAdmin('POST', '/external-domains/1/approve', { note: '已核对 NS' });
  const approvedJson: any = await approved.json();
  check(approved.status === 200 && approvedJson.fqdn === 'xxx.com'
    && approvedJson.provider === 'seus',
    '站长批准成功，返回固定 SEUS DNS');
  check(S.ext[0].status === 'approved' && S.ext[0].review_note === '已核对 NS',
    '申请状态与站长备注落库');
  check(String(S.settings.get('root_domains_extra') || '').includes('xxx.com'),
    '批准后域名成为根域名，用户可在该后缀下申请子域');
  check(String(S.settings.get('root_dns_backends') || '').includes('xxx.com:seus'),
    '根域名 DNS 后端显式写为 seus');
  check(String(S.settings.get('external_root_lock') || '').includes('xxx.com'),
    'external_root_lock 锁定该域名，切换接口与下拉都不可改');
  invalidateSettings();
  const locked = await externalLockedRoots(env());
  check(locked.includes('xxx.com'), 'externalLockedRoots 能读出锁定名单');
  const deny = await setDnsBackend(env(), 'xxx.com', 'cloudflare');
  check(deny.ok === false && /固定使用 SEUS DNS/.test(String(deny.reason)),
    '管理员尝试把第三方域名切到 Cloudflare → 被明确拒绝');
  const idem = await setDnsBackend(env(), 'xxx.com', 'seus');
  check(idem.ok === true, '下拉 disabled 时传 seus 本身是幂等的，不误报失败');
  invalidateSettings();
  const bm = await getBackendMap(env());
  check(bm['xxx.com'] === 'seus', 'getBackendMap 认得 seus 后端值');

  /* ═════════ E. cf.ts 真把记录写进 SEUS ═════════ */
  seusCalls.length = 0;
  clearDnsProviderCache();
  invalidateSettings();
  const p = { backends: { 'xxx.com': 'seus' }, dynamicRoots: ['xxx.com'], extraZones: {}, anyns: null, custom: false };
  check(backendFor(env(), p as any, 'xxx.com') === 'seus',
    'backendFor 对第三方接入域名返回 seus（不被自动推断覆盖）');
  const created = await cfCreate(env(), { type: 'A', name: 'www.xxx.com', content: '192.0.2.10', ttl: 1 }, 'xxx.com');
  check(created.ok === true && (created as any).result?.id === '9100',
    'cfCreate 真跑：走 SEUS 后端写入记录，不落到 Cloudflare');
  check(seusCalls.some((c) => c.name === 'dns_record_create'
    && c.args?.name === 'www' && c.args?.type === 'A' && c.args?.ttl === 300),
    'FQDN 转 SEUS 相对名 www，ttl=1(auto) 转官方 300');
  check(seusCalls.some((c) => c.name === 'dns_record_create' && c.args?.zoneId === '4821'),
    '写入用的是连接时查到的 zone #4821，不重复查 zones');
  const badType = await cfCreate(env(), { type: 'NAPTR', name: 'www.xxx.com', content: 'x' }, 'xxx.com');
  check(badType.ok === false && /不支持的记录类型/.test(String((badType as any).message)),
    'SEUS 不支持的记录类型明确报错');

  /* ═════════ F. 静态防回流 ═════════ */
  const route = read('src/routes/externalDomains.ts');
  const policy = read('src/lib/externalDomainPolicy.ts');
  const rootStore = read('src/lib/rootStore.ts');
  const cf = read('src/lib/cf.ts');
  const adm = read('src/routes/admin.ts');
  const admUi = read('src/app/legacy/admin.ts');
  const dash = read('src/app/pages/Dashboard.tsx');
  const page = read('src/app/pages/ExternalDomains.tsx');
  const reg = read('src/app/pages/Register.tsx');
  const schema = read('schema.sql');
  const idx = read('src/index.ts');
  const backup = read('src/lib/backupFormat.ts');
  const deploy = read('.github/workflows/deploy.yml');
  const readme = read('README.md');

  check(!/EXTERNAL_DOMAINS_COMING_SOON|comingSoon/.test(route),
    '「即将上线」闸门已撤，新流程真的可用');
  check(!/PROVIDERS|cloudflare.*dnshe.*anyns/i.test(route),
    '路由不再提供多家供应商选择，固定 SEUS');
  check(/validateExternalDomain/.test(route) && /seusConnect/.test(route)
    && /'pending'/.test(route) && /statusLabel/.test(route) && /approved/.test(route),
    '提交校验 / SEUS API 连接 / 审批状态都在路由里');
  check(/labels\.length !== 2/.test(policy) && /GTLD_SET/.test(policy)
    && /RESERVED_REGISTRABLE/.test(policy),
    '策略层：两段标签 + gTLD 白名单 + 保留域');
  check(/const BACKENDS = \['spaceship', 'cloudflare', 'anyns', 'seus'\]/.test(rootStore)
    && /lockedBackend/.test(rootStore) && /lockExternalRoot/.test(rootStore),
    'rootStore 认 seus、锁定名单与拒绝切换都在');
  check(/explicit === 'seus'/.test(cf) && /seusBackendCreate/.test(cf)
    && /seusBackendUpdate/.test(cf) && /seusBackendDelete/.test(cf)
    && /seusBackendList/.test(cf),
    'cf.ts 四个写入口都分发到 SEUS 站点级后端');
  check(/app\.get\('\/external-domains'/.test(adm)
    && /app\.post\('\/external-domains\/:id\/approve'/.test(adm)
    && /app\.post\('\/external-domains\/:id\/reject'/.test(adm),
    '后台审批三接口齐备');
  check(/'seus_api_token'/.test(adm) && /'seus_api_token'/.test(backup)
    && /seus_api_token/.test(schema),
    'SEUS 令牌在后台 GET / 脱敏备份 / schema 都被保护');
  const seusBk = read('src/lib/seusBackend.ts');
  const docsZh = read('docs-src/settings.md');
  const docsEn = read('docs-src/en/settings.md');
  check(/externalDomainProvider: 'seus'/.test(idx) && /seusBackendEnabled/.test(idx)
    && !/SEUS_API_TOKEN/.test(idx),
    '公开 config 只给常量与布尔，不下发令牌');
  check(!/SEUS_API_TOKEN|seusTokenSource/.test(seusBk)
    && !/SEUS_API_TOKEN/.test(adm) && !/SEUS_API_TOKEN/.test(idx)
    && !/SEUS_API_TOKEN/.test(schema),
    'SEUS 令牌只有一个来源：后台 settings，源码不读任何环境变量 / Worker Secret');
  check(/id="sSeusToken"/.test(admUi) && !/sSeusZoneIds/.test(admUi)
    && !/SEUS_API_TOKEN/.test(admUi) && !/fromEnv/.test(admUi.slice(
      admUi.indexOf('id="externalSettingsCard"'), admUi.indexOf('id="externalReqBox"'))),
    '站点设置收成唯一一个 Token 输入框，没有 env 只读分支 / zone 映射框');
  check(!/SEUS_API_TOKEN/.test(readme) && !/SEUS_API_TOKEN/.test(docsZh)
    && !/SEUS_API_TOKEN/.test(docsEn)
    && /唯一输入框/.test(readme) && /single input/i.test(docsEn),
    'README 与中英文档都写明「后台唯一输入框」，不再提环境变量配置');
  check(/id="externalCard"/.test(page) && /api\.post\('\/api\/external-domains/.test(page)
    && /用 API 连接/.test(page) && /href="\/external-domains"/.test(page),
    '接入卡片是真表单：提交 + 连接按钮 + 独立页入口');
  check(!/即将上线/.test(page) && !/即将上线/.test(dash) && !/即将上线/.test(reg),
    '前端不再标「即将上线」');
  check(/externalReqBox/.test(admUi) && /data-exact="approve"/.test(admUi)
    && /lockedBackend === 'seus'/.test(admUi) && /disabled title="第三方接入域名固定使用 SEUS DNS/.test(admUi),
    '站点设置里有审批列表；根域名管理里第三方行下拉禁用且标固定 SEUS');
  check(/status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'pending'/.test(schema)
    && /external_root_lock/.test(schema) && /seus_api_token/.test(schema),
    'schema 新库直接带审批字段与 SEUS 配置');
  /* TXT 先行：四处后端守卫 + 前端硬锁 + 文档顺序，缺一处就要回流 */
  check(/app\.post\('\/:id\/verify'/.test(route)
    && /checkOwnership/.test(route) && /verifyGate/.test(route)
    && (route.match(/verifyGate\(row\)/g) || []).length >= 2
    && /SET verify_status = 'verified'/.test(route)
    && /newVerifyToken/.test(route),
    '后端有 TXT 验证接口、DoH 校验与 connect/check-ns 两处顺序守卫');
  check(/verify_status \|\| 'pending'\) !== 'verified'/.test(adm)
    && /TXT 所有权验证/.test(adm),
    '站长批准接口也复核 verify_status');
  check(/验证 TXT/.test(page) && /disabled=\{busy \|\| !it\.verified\}/.test(page)
    && /verifyHost/.test(page) && /验证通过前不要改 NS/.test(page)
    && /!x\.verified \? '需先完成 TXT 所有权验证'/.test(admUi)
    && /TXT 已验证/.test(admUi),
    '前端：验证卡片 + 连接按钮硬锁 + 后台审批列表显示 TXT 状态并禁用批准');
  check(/先做 TXT 所有权验证，再改 NS/.test(read('docs-src/external-domains.md'))
    && /验证通过前不要改 NS/.test(read('docs-src/external-domains.md'))
    && /Verify TXT/i.test(read('docs-src/en/external-domains.md'))
    && /BEFORE the NS change/i.test(read('docs-src/en/external-domains.md')),
    '中英文档都写明「先 TXT 验证、后改 NS」及原因');
  check(/verify_token/.test(schema) && /verify_status/.test(schema),
    'schema 直接带 TXT 验证三列，老库由幂等 ALTER 补齐');
  check(/external-domain-flow-regression\.ts/.test(deploy), '专项回归挂进 CI');
  check(/### 22\./.test(readme) && /### Z\.14/.test(readme),
    'README 第 22 节写流程、文末 Z.14 记错误');
  check(EXTERNAL_LABEL === '（外部域名）', '统一标签未变');
  /* 独立页面与文档站：和 /docs 一样可直达 */
  const app = read('src/app/App.tsx');
  const spa = read('src/lib/spaRoutes.ts');
  const shell = read('src/app/lib/runtime.ts');
  const vp = read('docs-src/.vitepress/config.mts');
  const guideZh = read('docs-src/external-domains.md');
  const guideEn = read('docs-src/en/external-domains.md');
  check(/'\/external-domains': ExternalDomainsPage/.test(app)
    && /'\/external-domains\.html': ExternalDomainsPage/.test(app)
    && /'external-domains'/.test(spa)
    && /key: 'external-domains'/.test(shell),
    '独立页 /external-domains 注册进前后端两份清单与侧栏，直达刷新不白屏');
  check(/export default function ExternalDomainsPage/.test(page)
    && /ed-toc/.test(page) && /id="ed-overview"/.test(page)
    && /id="ed-rules"/.test(page) && /id="ed-steps"/.test(page)
    && /id="ed-apply"/.test(page) && /id="ed-faq"/.test(page)
    && /mountShell\('external-domains'/.test(page)
    && /ExternalDomainsCard \/>/.test(dash),
    '独立页是文档式五节结构，控制台仍在「注册域名」下保留同一卡片');
  check(/external-domains\.html/.test(vp) && /\/en\/external-domains\.html/.test(vp)
    && /gTLD/.test(guideZh) && /gTLD/.test(guideEn)
    && /\/external-domains/.test(guideZh) && /\/external-domains/.test(guideEn),
    'VitePress 中英各一页、侧栏可点，文档链回独立页');
  check(/href="\/external-domains"/.test(reg) && !/dashboard#externalCard/.test(reg),
    '注册页入口改指独立页面，不再只跳控制台锚点');

  globalThis.fetch = realFetch;
  console.log(`第三方域名接入流程回归：${ok.length} 通过，${bad.length} 失败`);
  for (const m of ok) console.log('  ✓ ' + m);
  for (const m of bad) console.error('  ✗ ' + m);
  if (bad.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
