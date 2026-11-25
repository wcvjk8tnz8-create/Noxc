/**
 * meoy.top 暂停解析 + AnyNS 作为「站点级 DNS 后端」· 专项回归
 *
 * 背景：meoy.top 正在迁移至 AnyNS。要求：
 *   1) 所有 meoy.top 子域名状态显示「暂停解析」，控制台 / 域名详情顶部
 *      显示「meoy.top 正在迁移至 anyns」；不改后台 UI。
 *   2) 澄清上一轮理解偏差：AnyNS 不是「用户自带 token 的 BYOS」，而是
 *      **站点后端持有 ANYNS_API_TOKEN（管理令牌）**，用它给根域名
 *      meoy.top 的 zone 添加/修改/删除 DNS 记录。
 *
 * 关键设计（回归会逐条锁住）：
 *   · 不改 subdomains.status（仍是 approved），否则公开统计 / 续期 / 配额 /
 *     用户案例展示十几处 `status='approved'` 判定会集体失效。只叠加 dnsPaused。
 *   · 配置在 settings + Worker Secret，不开后台界面；清空 dns_paused_roots
 *     即可一次性恢复，不用逐行改数据。
 *   · 普通用户暂停期不能增删改 DNS 记录；管理员豁免（迁移记录正是管理员补的）。
 *   · API 令牌只在 Worker 侧内存使用，绝不下发 /api/config。
 *
 * 两层：
 *   A. mock AnyNS 官方接口 + 内存 D1，真跑 dnsPause / anynsBackend / cf.ts /
 *      Hono records 路由（普通用户 403、管理员真写进 AnyNS zone）
 *   B. 静态断言：schema 默认配置、/api/config 字段、前端状态徽标与提示条、
 *      README / CI / health-check 口径
 *
 * 运行：npx tsx scripts/anyns-migration-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import {
  DNS_PAUSED_DEFAULT, DEFAULT_MIGRATION_NOTICE, DNS_PAUSED_LABEL,
  parsePausedRoots, matchPausedRoot, dnsPauseConfig, dnsPauseFields, dnsPauseBlockMessage,
} from '../src/lib/dnsPause.js';
import { invalidateSettings } from '../src/lib/settingsCache.js';
import {
  anynsServerConfig, anynsRootEnabled, anynsZoneId, clearAnynsZoneCache,
  toAnynsRecord, anynsToFqdn, anynsBackendCreate, anynsBackendUpdate,
  anynsBackendDelete, anynsBackendList,
} from '../src/lib/anynsBackend.js';
import {
  cfCreate, cfUpdate, cfDelete, cfList, cfSoa, backendFor, dnsProviderFor,
  clearDnsProviderCache,
} from '../src/lib/cf.js';
import recordsRoutes from '../src/routes/records.js';
import adminRoutes from '../src/routes/admin.js';
import { SENSITIVE_SETTING_KEYS } from '../src/lib/backupFormat.js';
import {
  anynsServerConfigFull, clearAnynsConfigCache, anynsTokenSource,
} from '../src/lib/anynsBackend.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

const TOKEN = 'nhtdns_migration_management_token';
const ZONE = '4821';

/* ───────── 内存 D1：记录 SQL，覆盖 settings / subdomains / dns_records ───────── */
type Row = Record<string, any>;
type Store = {
  settings: Map<string, string>;
  subs: Row[];
  recs: Row[];
  calls: string[];
  seq: number;
};
let S: Store;
function fresh(): Store {
  return {
    settings: new Map<string, string>([
      ['dns_paused_roots', DNS_PAUSED_DEFAULT],
      ['dns_migration_notice', DEFAULT_MIGRATION_NOTICE],
    ]),
    subs: [{ id: 1, label: 'demo', fqdn: 'demo.meoy.top', root_domain: 'meoy.top',
      status: 'approved', user_id: 7, reason: '' }],
    recs: [], calls: [], seq: 100,
  };
}
S = fresh();

function exec(sql: string, args: any[] = []) {
  const s = sql.replace(/\s+/g, ' ').trim();
  S.calls.push(s);
  const rows: Row[] = [];
  let lastRowId = 0, changes = 0;
  if (/^SELECT key, value FROM settings/.test(s)) {
    for (const [key, value] of S.settings) rows.push({ key, value: String(value) });
  } else if (/^SELECT value FROM settings WHERE key = \?$/.test(s)) {
    const v = S.settings.get(String(args[0]));
    if (v !== undefined) rows.push({ value: v });
  } else if (/^INSERT INTO settings\(key, value\)/.test(s)) {
    S.settings.set(String(args[0]), String(args[1])); changes = 1;
  } else if (/^SELECT \* FROM subdomains WHERE id = \?$/.test(s)) {
    const r = S.subs.find((x) => Number(x.id) === Number(args[0]));
    if (r) rows.push({ ...r });
  } else if (/^SELECT \* FROM dns_records WHERE id = \?$/.test(s)) {
    const r = S.recs.find((x) => Number(x.id) === Number(args[0]));
    if (r) rows.push({ ...r });
  } else if (/^SELECT \* FROM dns_records WHERE subdomain_id = \?/.test(s)) {
    rows.push(...S.recs.filter((x) => Number(x.subdomain_id) === Number(args[0])));
  } else if (/^SELECT id FROM dns_records WHERE name = \? AND type = \? AND verify_lock = 1$/.test(s)) {
    /* 无锁定记录 */
  } else if (/^SELECT \* FROM dns_records\s+WHERE subdomain_id = \? AND name = \?/.test(s)) {
    /* 幂等检查：无重复 */
  } else if (/^SELECT COUNT\(\*\) AS n FROM dns_records WHERE subdomain_id = \?$/.test(s)) {
    rows.push({ n: 0 });
  } else if (/^INSERT INTO dns_records/.test(s)) {
    lastRowId = ++S.seq; changes = 1;
    S.recs.push({ id: lastRowId, subdomain_id: args[0], cf_record_id: args[1],
      type: args[2], host: args[3], name: args[4], content: args[5], data: args[6],
      ttl: args[7], proxied: args[8], priority: args[9], comment: args[10],
      verify_lock: args[11], verify_preset: args[12], locked_at: args[13],
      locked_by: args[14], created_at: args[15], updated_at: args[16] });
  } else if (/^DELETE FROM dns_records WHERE id = \?/.test(s)) {
    S.recs = S.recs.filter((x) => Number(x.id) !== Number(args[0])); changes = 1;
  } else if (/^UPDATE dns_records/.test(s)) {
    changes = 1;
  } else {
    /* 其它 SQL 放行，返回空结果（回归只覆盖闸门与写入链路） */
  }
  return { rows, results: rows, lastRowId, changes, meta: { last_row_id: lastRowId } };
}

function makeDb() {
  return {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            all: async () => exec(sql, args),
            first: async () => exec(sql, args).rows[0] ?? null,
            run: async () => exec(sql, args),
          };
        },
        all: async () => exec(sql, []),
        first: async () => exec(sql, []).rows[0] ?? null,
        run: async () => exec(sql, []),
      };
    },
  } as any;
}

function env(extra: Record<string, any> = {}) {
  return {
    DB: makeDb(),
    ROOT_DOMAIN: 'meoy.top',
    CF_ZONE_ID: 'cf-zone-should-not-be-used',
    CF_API_TOKEN: 'cf-token-should-not-be-used',
    ANYNS_API_TOKEN: TOKEN,
    ANYNS_ZONE_ID: ZONE,
    ...extra,
  } as any;
}

/* ───────── mock AnyNS 官方管理 API ───────── */
type Call = { url: string; method: string; body: any; auth: string };
const calls: Call[] = [];
let anynsReply: (url: string, init: any) => { status: number; body: any } = () =>
  ({ status: 200, body: { code: 200, data: {} } });
let anynsCallsEnabled = false;

const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (url: any, init: any = {}) => {
  const u = String(url);
  if (!anynsCallsEnabled || !u.startsWith('https://anyns.io/')) {
    throw new Error(`回归里出现了非预期的外部请求：${u}`);
  }
  const headers = init.headers || {};
  calls.push({
    url: u, method: String(init.method || 'GET'),
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    auth: String(headers.Authorization || ''),
  });
  const r = anynsReply(u, init);
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    headers: { get: () => 'application/json' },
    json: async () => r.body,
    text: async () => JSON.stringify(r.body),
  };
};

async function main() {
  /* ═════════ A1. 「暂停解析」判定 ═════════ */
  check(DNS_PAUSED_DEFAULT === 'meoy.top' && DNS_PAUSED_LABEL === '暂停解析'
    && /迁移至 anyns/.test(DEFAULT_MIGRATION_NOTICE),
    '默认暂停根域名 meoy.top / 状态文案「暂停解析」/ 迁移提示含 anyns');
  check(parsePausedRoots(' MEOY.TOP, noxc.uk ').join(',') === 'meoy.top,noxc.uk',
    '配置解析：大小写 / 空白 / 去重');
  check(parsePausedRoots(' , ').length === 0, '清空配置即全部恢复');
  check(matchPausedRoot('a.b.meoy.top', ['meoy.top', 'b.meoy.top']) === 'b.meoy.top',
    '最长后缀匹配（多级子域不会漏判）');
  check(matchPausedRoot('x.noxc.uk', ['meoy.top']) === '',
    '其它后缀不受影响（noxc.uk 正常解析）');
  check(matchPausedRoot('meoy.top', ['meoy.top']) === 'meoy.top',
    '根域名本身（apex）也命中，可给根域名加记录');

  invalidateSettings();
  const cfg = await dnsPauseConfig(env());
  check(cfg.roots.join(',') === 'meoy.top' && cfg.notice === DEFAULT_MIGRATION_NOTICE,
    'dnsPauseConfig 从统一 settings 缓存读配置（零额外 D1 单点查询）');
  const fields = dnsPauseFields('demo.meoy.top', cfg);
  check(fields.dnsPaused === true && fields.statusLabel === '暂停解析'
    && fields.dnsPausedRoot === 'meoy.top',
    'meoy.top 子域名 shape：status 保持 approved，另叠加 statusLabel=暂停解析');
  check(dnsPauseFields('x.noxc.uk', cfg).dnsPaused === false,
    'noxc.uk 子域名不受影响');
  check(/暂停解析期间/.test(dnsPauseBlockMessage('demo.meoy.top', cfg, false))
    && /迁移至 anyns/.test(dnsPauseBlockMessage('demo.meoy.top', cfg, false)),
    '普通用户写记录被拦，提示带迁移说明');
  check(dnsPauseBlockMessage('demo.meoy.top', cfg, true) === '',
    '管理员豁免：可用站点级 API 令牌补迁移记录');
  check(dnsPauseBlockMessage('x.noxc.uk', cfg, false) === '',
    '未暂停后缀不拦普通用户');

  /* 清空配置 → 全部恢复 */
  invalidateSettings();
  S.settings.set('dns_paused_roots', '');
  const cleared = await dnsPauseConfig(env());
  check(cleared.roots.length === 0 && dnsPauseFields('demo.meoy.top', cleared).dnsPaused === false,
    '清空 dns_paused_roots 一次性恢复全部域名，不用逐行改数据');
  invalidateSettings();
  S.settings.set('dns_paused_roots', DNS_PAUSED_DEFAULT);
  /* 自定义提示覆盖默认值 */
  invalidateSettings();
  S.settings.set('dns_migration_notice', 'meoy.top 正在迁移至 anyns');
  check((await dnsPauseConfig(env())).notice === 'meoy.top 正在迁移至 anyns',
    '提示文案可由配置覆盖，前端不写死');
  invalidateSettings();
  S.settings.set('dns_migration_notice', DEFAULT_MIGRATION_NOTICE);

  /* ═════════ A2. 站点级 AnyNS 配置（Secret，不是用户自带 token） ═════════ */
  const serverCfg = anynsServerConfig(env());
  check(!!serverCfg && serverCfg.token === TOKEN && serverCfg.roots.join(',') === 'meoy.top'
    && serverCfg.defaultZoneId === ZONE,
    '站点级配置从 Worker env/Secret 读 nhtdns_ 管理令牌 + zone id');
  check(anynsServerConfig(env({ ANYNS_API_TOKEN: '' })) === null,
    '未配 ANYNS_API_TOKEN 时后端完全不启用，其它 DNS 后端照常工作');
  check(!!serverCfg && anynsRootEnabled(serverCfg, 'meoy.top')
    && anynsRootEnabled(serverCfg, 'demo.meoy.top')
    && !anynsRootEnabled(serverCfg, 'noxc.uk'),
    '只有 meoy.top 根域走 AnyNS；noxc.uk 仍走原后端');
  check(!!serverCfg && anynsRootEnabled(serverCfg, 'meoy.top')
    && !anynsRootEnabled({ ...serverCfg, roots: ['noxc.uk'] }, 'meoy.top'),
    'ANYNS_ROOTS 可改迁移范围');

  /* ═════════ A3. 记录转换（完整 FQDN → AnyNS 相对名） ═════════ */
  const apex = toAnynsRecord({ type: 'A', name: 'meoy.top', content: '192.0.2.10', ttl: 1 }, 'meoy.top');
  check(apex.ok && apex.record!.name === '@' && apex.record!.value === '192.0.2.10'
    && apex.record!.ttl === 300,
    '根域名 apex 记录 → name=@，ttl=1(auto) 转官方 300');
  const sub = toAnynsRecord({ type: 'A', name: 'demo.meoy.top', content: '192.0.2.11', ttl: 600 }, 'meoy.top');
  check(sub.ok && sub.record!.name === 'demo' && sub.record!.ttl === 600,
    '子域记录只传相对标签，TTL 原样');
  const deep = toAnynsRecord({ type: 'TXT', name: '_vercel.api.demo.meoy.top', content: 'vc-token' }, 'meoy.top');
  check(deep.ok && deep.record!.name === '_vercel.api.demo', '多级主机名保留点号前缀');
  const mx = toAnynsRecord({ type: 'MX', name: 'demo.meoy.top', content: 'mail.example.com', priority: 20 }, 'meoy.top');
  check(mx.ok && mx.record!.value === '20 mail.example.com', 'MX 优先级拼进 value');
  const srv = toAnynsRecord({
    type: 'SRV', name: '_sip.demo.meoy.top', content: 'sip.example.com',
    data: { priority: 1, weight: 5, port: 5060, target: 'sip.example.com' },
  }, 'meoy.top');
  check(srv.ok && srv.record!.value === '1 5 5060 sip.example.com', 'SRV data 展开成官方 value');
  const bogus = toAnynsRecord({ type: 'NAPTR', name: 'x.meoy.top', content: 'v' }, 'meoy.top');
  check(!bogus.ok && /暂不支持/.test(String(bogus.error)),
    'AnyNS 不支持的记录类型明确报错，不假装成功');
  const cross = toAnynsRecord({ type: 'A', name: 'evil.com', content: '1.2.3.4' }, 'meoy.top');
  check(!cross.ok && /不属于/.test(String(cross.error)),
    '越域记录名被拒（不拿本 zone 当任意域名写接口）');
  check(anynsToFqdn('@', 'meoy.top') === 'meoy.top'
    && anynsToFqdn('www', 'meoy.top') === 'www.meoy.top',
    '列表回来时相对名还原完整 FQDN（NS 委派按 name 精确匹配）');

  /* ═════════ A4. 真跑 AnyNS 官方接口（mock fetch） ═════════ */
  anynsCallsEnabled = true;
  clearAnynsZoneCache();
  clearDnsProviderCache();
  let lastBody: any = null;
  anynsReply = (u, init) => {
    if (/\/records$/.test(u) && init.method === 'POST') {
      lastBody = JSON.parse(String(init.body));
      return { status: 200, body: { code: 200, data: { record: { ...lastBody, id: 9001 } } } };
    }
    if (/\/records\/\d+$/.test(u) && init.method === 'DELETE') {
      return { status: 200, body: { code: 200, data: { message: '记录已删除' } } };
    }
    if (/\/records$/.test(u)) {
      return { status: 200, body: { code: 200, data: { records: [
        { id: 9001, name: '@', type: 'A', value: '192.0.2.10', ttl: 300, line: 'default', enabled: true },
        { id: 9002, name: 'www', type: 'CNAME', value: 'demo.meoy.top', ttl: 300 },
      ] } } };
    }
    if (/\/zones$/.test(u)) {
      return { status: 200, body: { code: 200, data: { zones: [
        { id: 4821, zone_name: 'meoy.top', ns: ['ns7.anyns.io', 'ns8.anyns.io'] },
      ] } } };
    }
    return { status: 200, body: { code: 200, data: {} } };
  };

  const e = env();
  const created = await anynsBackendCreate(e, { type: 'A', name: 'meoy.top', content: '192.0.2.10', ttl: 1 }, 'meoy.top');
  check(created.ok && created.result?.id === '9001'
    && lastBody.name === '@' && lastBody.type === 'A' && lastBody.value === '192.0.2.10',
    '站点后端用管理令牌给根域名 zone 新增记录（name=@）');
  check(calls.at(-1)?.auth === `Bearer ${TOKEN}`
    && calls.at(-1)?.url.includes('/api/dns/v1/zones/4821/records'),
    'Bearer nhtdns_ 令牌只走官方管理端点，不经过用户浏览器');
  check(!JSON.stringify(calls.at(-1)?.body || {}).includes(TOKEN),
    '令牌不写进请求体 / URL query');

  const updated = await anynsBackendUpdate(e, '9001', { type: 'A', name: 'meoy.top', content: '192.0.2.12' }, 'meoy.top');
  check(updated.ok && lastBody.id === 9001 && lastBody.value === '192.0.2.12',
    '修改记录带官方 id>0，未传 ttl/line 保持原值');
  const legacy = await anynsBackendUpdate(e, 'cf-old-id', { type: 'A', name: 'meoy.top', content: '1.2.3.4' }, 'meoy.top');
  check(!legacy.ok && /迁移前由旧 DNS 后端/.test(String(legacy.message)),
    '旧 Cloudflare 记录 id 不给改，明确提示删除重建，不误写 AnyNS');

  const deleted = await anynsBackendDelete(e, '9001', 'meoy.top');
  check(deleted.ok && calls.at(-1)?.method === 'DELETE'
    && calls.at(-1)?.url.endsWith('/records/9001'), '删除走官方 :rid 端点');
  const delLegacy = await anynsBackendDelete(e, 'cf-old-id', 'meoy.top');
  check(delLegacy.ok && /残留/.test(String((delLegacy as any).warning || '')),
    '旧 id 删除不阻断本地清理，但明确提示 AnyNS 侧可能残留');

  const list = await anynsBackendList(e, { type: 'A' }, 'meoy.top');
  check(list.ok && Array.isArray((list as any).result)
    && (list as any).result.length === 1
    && (list as any).result[0].name === 'meoy.top'
    && (list as any).result[0].content === '192.0.2.10',
    '列表映射成 Cloudflare 形状（name 还原 FQDN，供 NS 委派按名匹配）');

  /* 没配 zone id 时按域名查一次并缓存 */
  clearAnynsZoneCache();
  const cfgNoZone = anynsServerConfig(env({ ANYNS_ZONE_ID: '', ANYNS_ZONE_IDS: '' }))!;
  calls.length = 0;
  const z1 = await anynsZoneId(cfgNoZone, 'meoy.top');
  const z2 = await anynsZoneId(cfgNoZone, 'meoy.top');
  check(z1 === ZONE && z2 === ZONE
    && calls.filter((c) => /\/zones$/.test(c.url)).length === 1,
    '未配 zone id 时按域名查一次并缓存 15 秒，不每写一条都查');
  check(anynsServerConfig(env({ ANYNS_ZONE_ID: '' }))!.defaultZoneId === '',
    '空 zone id 不误当合法值');

  /* 官方错误直接透出中文 */
  anynsReply = () => ({ status: 403, body: { error: 'token_scope_mismatch', message: 'scope' } });
  const scopeErr = await anynsBackendCreate(e, { type: 'A', name: 'demo.meoy.top', content: '1.2.3.4' }, 'meoy.top');
  check(!scopeErr.ok && /令牌类型不匹配|管理令牌/.test(String(scopeErr.message)),
    'DDNS / ACME 令牌误配时给出「管理令牌」提示');

  /* ═════════ A5. cf.ts 后端选择：meoy.top → anyns，其它不变 ═════════ */
  clearDnsProviderCache();
  invalidateSettings();
  const pAny = await dnsProviderFor(env(), 'meoy.top');
  check(pAny.backend === 'anyns', 'cf.ts 把 meoy.top 的 DNS 后端切到 AnyNS');
  clearDnsProviderCache();
  const pOther = await dnsProviderFor(env(), 'noxc.uk');
  check(pOther.backend !== 'anyns', 'noxc.uk 仍走 Cloudflare / 原后端，迁移不影响其它后缀');
  clearDnsProviderCache();
  const pNoToken = await dnsProviderFor(env({ ANYNS_API_TOKEN: '' }), 'meoy.top');
  check(pNoToken.backend !== 'anyns', '没配令牌时 meoy.top 回落原后端，不误报成功');
  /* 后台显式 anyns 写法也认（虽然本轮不新增后台 UI） */
  const mapEnv = env({ ANYNS_API_TOKEN: '' });
  const fakeP = { backends: { 'meoy.top': 'anyns' }, custom: false, anyns: null };
  check(backendFor(mapEnv, fakeP as any, 'meoy.top') === 'anyns',
    'root_dns_backends 里显式写 anyns 也能命中');

  clearDnsProviderCache();
  anynsReply = (u, init) => ({
    status: 200,
    body: { code: 200, data: { record: { id: 9001, name: '@', type: 'A', value: '1.2.3.4' } } },
  });
  calls.length = 0;
  const viaCf = await cfCreate(env(), { type: 'A', name: 'meoy.top', content: '1.2.3.4', ttl: 1 }, 'meoy.top');
  check(viaCf.ok && viaCf.result?.id === '9001'
    && calls.some((c) => c.url.includes('anyns.io')),
    'cfCreate(meoy.top) 真跑：走 AnyNS 管理 API 而不是 Cloudflare');
  check(!calls.some((c) => c.url.includes('api.cloudflare.com')),
    '迁移后不再往 Cloudflare 写 meoy.top 记录');
  const soa = await cfSoa(env());
  check(soa.ok && Array.isArray((soa as any).result) && (soa as any).result.length === 0,
    'AnyNS 无 SOA 接口时返回空结果，不报错');

  /* ═════════ A6. 真跑 Hono：写闸门 + 管理员用 api key 补记录 ═════════ */
  const app = new Hono();
  let role = 'user';
  app.use('*', async (c, next) => {
    c.set('user', { id: 7, email: 'u@example.com', role });
    await next();
  });
  app.route('/api', recordsRoutes);
  const CTX: any = { waitUntil() {}, passThroughOnException() {} };
  const call = (method: string, url: string, body?: any, e2: any = env()) =>
    app.fetch(new Request('https://nic.test' + url, {
      method, headers: { 'content-type': 'application/json', 'X-Lang': 'zh' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), e2, CTX);

  role = 'user';
  invalidateSettings();
  S = fresh();
  const bodyRec = { type: 'A', host: '@', content: '192.0.2.10', ttl: 1 };
  const userAdd = await call('POST', '/api/subdomains/1/records', bodyRec);
  const userJson: any = await userAdd.json();
  check(userAdd.status === 403 && userJson.success === false
    && /暂停解析期间/.test(String(userJson.message)),
    '普通用户暂停期添加记录 → 403，且带迁移说明');
  check(!S.calls.some((s) => /^INSERT INTO dns_records/.test(s)),
    '被拦时零写入（本地表与 AnyNS 都没脏数据）');

  /* 读取不受影响 */
  const readRes = await call('GET', '/api/subdomains/1/records');
  check(readRes.status === 200, '暂停解析不影响查看已有 DNS 记录');

  /* 管理员豁免：这条记录由站点级 ANYNS_API_TOKEN 真写进根域名 zone */
  role = 'admin';
  invalidateSettings();
  clearAnynsZoneCache();
  clearDnsProviderCache();
  calls.length = 0;
  anynsReply = (u, init) => ({
    status: 200,
    body: { code: 200, data: { record: { id: 9100, name: '@', type: 'A', value: '192.0.2.10' } } },
  });
  const adminAdd = await call('POST', '/api/subdomains/1/records', bodyRec);
  const adminJson: any = await adminAdd.json();
  check([200, 201].includes(adminAdd.status) && adminJson.success === true,
    `管理员豁免：可用站点级 api key 给根域名添加记录完成迁移（status=${adminAdd.status}, body=${JSON.stringify(adminJson).slice(0, 220)}）`);
  check(calls.some((c) => c.url.includes('/api/dns/v1/zones/4821/records') && c.method === 'POST'),
    '管理员写记录确实打到 AnyNS 官方管理端点');
  check(!JSON.stringify(adminJson).includes(TOKEN),
    '接口响应绝不回显 ANYNS_API_TOKEN');

  /* 清空配置后普通用户恢复写入 */
  role = 'user';
  invalidateSettings();
  S.settings.set('dns_paused_roots', '');
  clearDnsProviderCache();
  const restored = await call('POST', '/api/subdomains/1/records', bodyRec);
  check(restored.status !== 403,
    '清空 dns_paused_roots 后普通用户恢复写记录（迁移完成即恢复）');

  /* ═════════ A7. 后台「站点设置」真跑（Hono） ═════════ */
  const adminApp = new Hono();
  adminApp.use('*', async (c, next) => {
    c.set('user', { id: 1, email: 'admin@example.com', role: 'admin' });
    await next();
  });
  adminApp.route('/api/admin', adminRoutes);
  const adminCall = (method: string, url: string, body?: any, e2: any = env({ ANYNS_API_TOKEN: '' })) =>
    adminApp.fetch(new Request('https://nic.test' + url, {
      method, headers: { 'content-type': 'application/json', 'X-Lang': 'zh' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), e2, CTX);

  /* GET：只回掩码，敏感 key 从 items 剔除，绝不回明文 */
  S = fresh();
  S.settings.set('anyns_api_token', TOKEN);
  invalidateSettings(); clearDnsProviderCache(); clearAnynsConfigCache();
  const gs = await adminCall('GET', '/api/admin/settings');
  const gj: any = await gs.json();
  check(gs.status === 200 && gj.anyns?.tokenSet === true
    && gj.anyns.tokenMasked === '••••••••' + TOKEN.slice(-4),
    '后台 GET /settings 返回 AnyNS 配置状态与掩码');
  check(!JSON.stringify(gj).includes(TOKEN),
    '后台 GET 绝不回传令牌明文');
  check(gj.items?.anyns_api_token === undefined,
    '敏感 key anyns_api_token 从 items 明文表里剔除');
  check(gj.anyns?.dnsPausedRoots !== undefined && gj.anyns?.migrationNotice !== undefined,
    '同一张卡片也回显暂停解析名单与迁移提示');

  /* POST：显式提交新值才写，留空不覆盖 */
  S = fresh();
  invalidateSettings(); clearDnsProviderCache(); clearAnynsConfigCache();
  const ps = await adminCall('POST', '/api/admin/settings', {
    anynsApiToken: 'nhtdns_from_admin',
    anynsRoots: 'MEOY.TOP, noxc.uk ',
    anynsZoneId: '4821',
    anynsZoneIds: 'meoy.top:4821,noxc.uk:4822',
    dnsPausedRoots: 'meoy.top',
    dnsMigrationNotice: 'meoy.top 正在迁移至 anyns',
  });
  check(ps.status === 200 && S.settings.get('anyns_api_token') === 'nhtdns_from_admin'
    && S.settings.get('anyns_roots') === 'meoy.top,noxc.uk'
    && S.settings.get('anyns_zone_id') === '4821'
    && S.settings.get('dns_migration_notice') === 'meoy.top 正在迁移至 anyns',
    '后台保存 AnyNS 令牌 / 根域名 / Zone / 迁移提示（域名归一化）');
  const ps2 = await adminCall('POST', '/api/admin/settings', { siteName: 'Noxc' });
  check(ps2.status === 200 && S.settings.get('anyns_api_token') === 'nhtdns_from_admin',
    '表单留空时不覆盖已保存的令牌');
  /* 非法 Zone ID 不写库 */
  await adminCall('POST', '/api/admin/settings', { anynsZoneId: 'not-a-number' });
  check(S.settings.get('anyns_zone_id') === '',
    'Zone ID 只接受数字，非法值置空而不是存进库');

  /* 完整配置：Secret 没配时从后台 settings 读到令牌 */
  S.settings.set('anyns_zone_id', '4821');
  invalidateSettings(); clearAnynsConfigCache(); clearDnsProviderCache();
  const full = await anynsServerConfigFull(env({ ANYNS_API_TOKEN: '' }));
  check(!!full && full.token === 'nhtdns_from_admin'
    && full.roots.includes('meoy.top') && full.defaultZoneId === '4821',
    'anynsServerConfigFull 从站点设置兜底读令牌（走统一 settings 缓存）');

  /* cf.ts 用「后台填的令牌」真写 AnyNS zone */
  anynsCallsEnabled = true;
  clearAnynsZoneCache(); clearDnsProviderCache();
  calls.length = 0;
  anynsReply = () => ({ status: 200, body: { code: 200, data: { record: { id: 9200, name: '@', type: 'A', value: '1.2.3.4' } } } });
  const viaSettings = await cfCreate(env({ ANYNS_API_TOKEN: '' }), {
    type: 'A', name: 'meoy.top', content: '1.2.3.4', ttl: 1,
  }, 'meoy.top');
  check(viaSettings.ok && calls.some((c) => c.auth === 'Bearer nhtdns_from_admin'
    && c.url.includes('/api/dns/v1/zones/4821/records')),
    '后台填的令牌即刻生效：cfCreate 真用 nhtdns_from_admin 写 AnyNS zone');
  check(!calls.some((c) => c.url.includes('api.cloudflare.com')),
    '后台启用后不再往 Cloudflare 写 meoy.top 记录');

  /* 清除令牌：回落原后端 */
  const pc = await adminCall('POST', '/api/admin/settings', { anynsClearToken: true });
  check(pc.status === 200 && S.settings.get('anyns_api_token') === '',
    '「清除已保存的令牌」真的清空 settings');
  invalidateSettings(); clearAnynsConfigCache(); clearDnsProviderCache();
  check((await anynsServerConfigFull(env({ ANYNS_API_TOKEN: '' }))) === null,
    '清除后站点级 AnyNS 后端停用，其它 DNS 后端照常工作');

  /* Worker Secret 优先级更高 */
  const envCfg = await anynsServerConfigFull(env({ ANYNS_API_TOKEN: TOKEN }));
  check(envCfg?.token === TOKEN
    && anynsTokenSource(env({ ANYNS_API_TOKEN: TOKEN }), 'nhtdns_from_admin') === 'env',
    'Worker Secret ANYNS_API_TOKEN 优先于后台设置，后台标 fromEnv 只读');
  check(anynsTokenSource(env({ ANYNS_API_TOKEN: '' }), '') === 'none',
    '两个来源都没配时 source=none');
  check(SENSITIVE_SETTING_KEYS.has('anyns_api_token'),
    '备份脱敏副本会把 anyns_api_token 置空（默认完整备份仍含真值）');

  /* ═════════ B. 静态断言 ═════════ */
  anynsCallsEnabled = false;
  const schema = read('schema.sql');
  check(/dns_paused_roots', 'meoy.top'/.test(schema) && /dns_migration_notice/.test(schema),
    'schema 写入默认暂停名单与提示（INSERT OR IGNORE，不覆盖管理员改动）');
  check(!/UPDATE subdomains SET status/.test(schema),
    '绝不批量改 subdomains.status（统计 / 续期 / 配额不受影响）');
  const idx = read('src/index.ts');
  check(/'dns_paused_roots','dns_migration_notice'/.test(idx)
    && /dnsPausedRoots:/.test(idx) && /migrationNotice:/.test(idx)
    && /anynsBackendEnabled/.test(idx),
    '/api/config 下发暂停名单 / 提示 / 后端启用布尔值');
  check(!/ANYNS_API_TOKEN.*migrationNotice|migrationNotice:.*ANYNS_API_TOKEN/.test(idx),
    '不下发令牌本体，只给布尔状态');
  const runtime = read('src/app/lib/runtime.ts');
  check(/export function mountMigrationNotice/.test(runtime)
    && /data-no-i18n/.test(runtime) && /textContent = msg/.test(runtime)
    && /querySelector\('\.main'\)/.test(runtime),
    '迁移提示条纯文本 / 不翻译 / 只在控制台与域名详情显示');
  check(/row\.dnsPaused/.test(runtime) && /暂停解析/.test(runtime),
    'statusBadge 叠加显示「暂停解析」');
  const ds = read('src/app/styles/design-system.css');
  check(/\.dns-migration-notice/.test(ds) && !/[\u{1F300}-\u{1FAFF}]/u.test(ds.slice(ds.indexOf('.dns-migration-notice'))),
    '提示条样式纯黑白灰、零 emoji');
  const dash = read('src/app/legacy/dashboard.ts');
  check(/statusBadge\(s\.status, s\)/.test(dash), '控制台列表把行数据传给状态徽标');
  const dom = read('src/app/legacy/domain.ts');
  check(/sub\.dnsPaused/.test(dom) && /暂停解析/.test(dom),
    '域名详情状态与顶部提示都显示暂停解析');
  const rec = read('src/routes/records.ts');
  check((rec.match(/dnsWriteBlock\(c, sub\)/g) || []).length >= 5
    && /u\?\.role === 'admin'/.test(rec)
    && /isAdmin/.test(read('src/lib/dnsPause.ts')),
    '所有写记录入口都有闸门，管理员豁免');
  const backend = read('src/lib/anynsBackend.ts');
  check(/ANYNS_API_TOKEN/.test(backend) && /Worker Secret/.test(backend)
    && !/localStorage|body\.apiKey/i.test(backend),
    '站点级令牌只来自服务端（Secret / 站点设置），不是用户自带 key 的 BYOS');
  const deploy = read('.github/workflows/deploy.yml');
  check(/anyns-migration-regression\.ts/.test(deploy), '专项回归挂进 CI');
  const readme = read('README.md');
  check(/### 21\./.test(readme) && /### Z\.12/.test(readme),
    'README 正文写能力、错误按约定收在文末 Z.12');
  const hc = read('scripts/health-check.ts');
  check(/anynsBackend|dnsPause|dns-migration/.test(hc), '健康巡检有防回流断言');
  const adm = read('src/routes/admin.ts');
  const admUi = read('src/app/legacy/admin.ts');
  check(/'anyns_api_token'/.test(adm) && /anynsApiToken/.test(adm) && /anynsClearToken/.test(adm)
    && /clearAnynsConfigCache/.test(adm) && /invalidateSettings/.test(adm),
    '后台保存/清除/缓存失效三件套齐全');
  check(/id="sAnynsToken"/.test(admUi) && /id="sDnsPausedRoots"/.test(admUi)
    && /anynsApiToken:/.test(admUi) && /d\.anyns/.test(admUi),
    '站点设置页面有 AnyNS 卡片、保存字段与掩码渲染');
  check(/SENSITIVE_SETTING_KEYS/.test(read('src/lib/backupFormat.ts'))
    && /'anyns_api_token'/.test(read('src/lib/backupFormat.ts')),
    '凭据名单纳入备份脱敏');
  check(/anynsServerConfigFull/.test(read('src/lib/cf.ts'))
    && /anynsServerConfigFull/.test(read('src/lib/anynsBackend.ts')),
    'cf.ts 用完整配置（Secret + 后台）决定后端');
  const cfgKeysLine = read('src/index.ts').match(/const CONFIG_KEYS = \[[^\]]*\]/)?.[0] || '';
  check(/anynsBackendEnabled/.test(idx) && !/'anyns_api_token'/.test(cfgKeysLine),
    '公开 config 只给布尔，密钥不进 CONFIG_KEYS');


  for (const m of ok) console.log('  ✓ ' + m);
  for (const m of bad) console.error('  ✗ ' + m);
  console.log(`meoy.top 暂停解析与站点级 AnyNS 后端回归：${ok.length} 通过，${bad.length} 失败`);
  (globalThis as any).fetch = realFetch;
  if (bad.length) process.exit(1);
}

main().catch((e) => { (globalThis as any).fetch = realFetch; console.error(e); process.exit(1); });
