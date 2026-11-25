/**
 * AnyNS（anyns.io / n.ht 技术社区）官方管理 API 适配
 * ──────────────────────────────────────────────────────────────────────
 * 官方文档：https://anyns.io/docs/api （n.ht 社区出品，NodeLoc 入驻）
 *
 * 认证：面板创建的 `nhtdns_` 前缀令牌，Authorization: Bearer（或 Basic 密码位）。
 * 令牌分三种 scope，端点只认对应类型，互不通用：
 *   · 管理令牌 → /api/dns/v1/zones + /records + /lines + /export /import
 *   · DDNS 令牌 → /nic/update（只认绑定的那一个主机名）
 *   · ACME 令牌 → /api/dns/acme/present、/api/dns/certs/current
 *
 * 端点（照官方文档逐字落地，不猜未公开路径）：
 *   GET    /api/dns/v1/zones                       列出 zone（含 id / ns / public_ns / brand_ns）
 *   POST   /api/dns/v1/zones                       body {zone_name, brand_ns?}
 *   DELETE /api/dns/v1/zones/:id                   body {confirm_dnssec?, confirm_brand_ns?}
 *   GET    /api/dns/v1/zones/:id/records           记录列表
 *   POST   /api/dns/v1/zones/:id/records           新建（id 缺省/0）或修改（id>0）
 *   DELETE /api/dns/v1/zones/:id/records/:rid      删除
 *   GET    /api/dns/v1/zones/:id/export            BIND zone file（text/plain）
 *   POST   /api/dns/v1/zones/:id/import            body {text}
 *   GET    /api/dns/v1/lines                      可用线路 code
 *   POST   /api/dns/v1/lines                      body {name, cidrs}
 *
 * 错误统一 {"error":"...","message":"..."}；限流每令牌 60 次/分、1000 次/时，
 * 导入导出另限 3 次/分、30 次/时。
 *
 * 铁律：
 *   · token 只在本次请求内存里用，不落库、不写日志、不回传前端
 *   · 记录名只允许落在该 zone 内，根域用官方口径 `@`
 *   · 官方没有独立的「委派检查」端点，不假装能验证注册商 NS，
 *     只能查 zone 是否存在、返回它分配/记录的 NS，提示以 dig NS 为准
 *   · 响应解析兼容多种包装形状，但拿不到 id/ns 时明确报错，绝不假装成功
 */
export const ANYNS_API_BASE = 'https://anyns.io';
export const ANYNS_TOKEN_PREFIX = 'nhtdns_';
export const ANYNS_DEFAULT_NS = ['ns1.anyns.io', 'ns2.anyns.io'] as const;
export const ANYNS_RECORD_TYPES = [
  'A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA',
] as const;

const TIMEOUT_MS = 10_000;

export class AnynsDnsError extends Error {
  code: string;
  constructor(message: string, code = '') {
    super(message);
    this.name = 'AnynsDnsError';
    this.code = code;
  }
}

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\.+$/, '');
}

function isHost(v: unknown): boolean {
  const s = norm(v);
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s);
}

/** 令牌形状校验：三种 scope 都是 nhtdns_ 开头，具体权限交给服务端判 */
export function assertAnynsToken(token: string): void {
  const t = String(token || '').trim();
  if (!t) throw new AnynsDnsError('请填写 anyns.io 面板创建的 API 令牌');
  if (!t.startsWith(ANYNS_TOKEN_PREFIX)) {
    throw new AnynsDnsError(
      `令牌格式不对：anyns.io 使用 ${ANYNS_TOKEN_PREFIX} 开头的令牌。请到面板创建「管理令牌」（DDNS / ACME 令牌不能用于管理接口）`
    );
  }
}

/** 把服务端 error code 翻成能直接给人看的中文 */
const ERROR_HINTS: Record<string, string> = {
  unauthorized: '鉴权失败：令牌无效或已过期，请到 anyns.io 面板重新生成',
  token_scope_mismatch: '令牌类型不匹配：管理接口必须用「管理令牌」，DDNS / ACME 令牌不能通用',
  invalid_body: '请求体不合法，请检查记录名称、类型与取值',
  invalid_id: 'zone / 记录 ID 不合法，请重新连接供应商获取',
  record_duplicate: '同类型同名称的记录已存在（AnyNS 不允许重复）',
  record_cname_conflict: '与已有 CNAME 冲突：同名称下不能再放其它记录',
  record_quota_exceeded: '已达到该域名的记录配额',
  zone_suspended: '该域名在 AnyNS 已被停用，请先到面板恢复',
  zone_not_found: 'AnyNS 里找不到这个解析区域，请重新连接供应商',
  record_not_found: '记录不存在或已被删除',
  service_error: 'AnyNS 服务端错误，请稍后重试',
};

function friendly(code: string, message: string, status: number): string {
  if (status === 429) return 'AnyNS 触发限流（管理接口 60 次/分、1000 次/时；导入导出 3 次/分），请稍后重试';
  if (status === 409) return `AnyNS 需要二次确认：${String(message || '请到面板确认 DNSSEC / 品牌 NS 影响后重试').slice(0, 180)}`;
  const hint = ERROR_HINTS[String(code || '')];
  if (hint) return hint + (message ? `（${String(message).slice(0, 140)}）` : '');
  return `AnyNS 返回 ${status}${code ? ` [${code}]` : ''}${message ? `：${String(message).slice(0, 180)}` : ''}`;
}

type ReqOptions = {
  method?: string;
  body?: any;
  /** text/plain 端点（export / DDNS）不走 JSON 解析 */
  text?: boolean;
  query?: Record<string, string | number | undefined>;
};

async function anynsRequest<T = any>(token: string, path: string, opt: ReqOptions = {}): Promise<T> {
  assertAnynsToken(token);
  let url = ANYNS_API_BASE + path;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(opt.query || {})) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  if (q.toString()) url += (url.includes('?') ? '&' : '?') + q.toString();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opt.method || 'GET',
      headers: {
        Authorization: `Bearer ${String(token).trim()}`,
        'Content-Type': 'application/json',
        Accept: opt.text ? 'text/plain, application/json' : 'application/json',
      },
      body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    throw new AnynsDnsError(`连接 AnyNS 失败：${String(e?.message || e).slice(0, 160)}。请稍后重试`);
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text().catch(() => '');
  let j: any = null;
  try { j = JSON.parse(raw); } catch { /* text/plain 端点 */ }

  if (res.status >= 400 || (j && typeof j.error === 'string')) {
    const code = String(j?.error || '').trim();
    const msg = String(j?.message || (typeof j?.error === 'object' ? j?.error?.message : '') || '').trim();
    throw new AnynsDnsError(friendly(code, msg || raw.slice(0, 180), res.status), code);
  }
  if (opt.text) return raw as unknown as T;

  if (!j) {
    throw new AnynsDnsError(`AnyNS 返回内容无法解析（HTTP ${res.status}）：${raw.slice(0, 160)}`);
  }
  /* 成功响应形如 {"code":200,"data":...}，也兼容直接返回 data / 数组 */
  const payload = j?.data !== undefined ? j.data : j;
  return payload as T;
}

/** 从多种包装形状里取出 zone 数组（官方只说「zone 列表」，未给固定键名） */
function asArray(data: any, depth = 0): any[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object' || depth > 3) return [];
  for (const k of ['zones', 'items', 'list', 'records', 'lines', 'data', 'result']) {
    const v = data[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const nested = asArray(v, depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}

/** 从创建 / 查询响应里取出单个 zone 对象 */
function asZone(data: any, depth = 0): any {
  if (!data || typeof data !== 'object' || depth > 3) return null;
  if (data.id !== undefined && (data.zone_name || data.name || data.ns || data.public_ns)) return data;
  for (const k of ['zone', 'data', 'result', 'item']) {
    const v = data[k];
    if (v && typeof v === 'object') {
      const z = asZone(v, depth + 1);
      if (z) return z;
    }
  }
  return null;
}

function nsList(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : [];
  return arr.map((x) => norm(x)).filter(isHost).filter((x, i, a) => a.indexOf(x) === i);
}

export type AnynsZone = {
  id: string;
  name: string;
  ns: string[];
  nsSource: 'zone' | 'public_ns' | 'default';
  brandNs: boolean;
  raw: any;
};

/** 官方口径：zone.ns 是「应到注册商填的 NS」，public_ns 只是平台默认 */
function shapeZone(z: any): AnynsZone {
  const id = String(z?.id ?? '');
  const name = norm(z?.zone_name || z?.name || z?.domain || '');
  const assigned = nsList(z?.ns ?? z?.name_servers ?? z?.nameservers);
  const fallback = nsList(z?.public_ns ?? z?.publicNs);
  const ns = assigned.length ? assigned : fallback.length ? fallback : [...ANYNS_DEFAULT_NS];
  return {
    id,
    name,
    ns,
    nsSource: assigned.length ? 'zone' : fallback.length ? 'public_ns' : 'default',
    brandNs: !!(z?.brand_ns ?? z?.brandNs),
    raw: z,
  };
}

/** 列出全部解析区域 */
export async function anynsListZones(token: string): Promise<AnynsZone[]> {
  const data = await anynsRequest(token, '/api/dns/v1/zones');
  return asArray(data).map(shapeZone);
}

/** 按域名找 zone（大小写 / 根点归一化） */
export async function anynsFindZone(token: string, domain: string): Promise<AnynsZone | null> {
  const want = norm(domain);
  const list = await anynsListZones(token);
  return list.find((z) => norm(z.name) === want || norm(z.raw?.zone_name) === want) || null;
}

/** 新建解析区域 */
export async function anynsCreateZone(
  token: string,
  zoneName: string,
  opt: { brandNs?: boolean } = {}
): Promise<AnynsZone> {
  const d = norm(zoneName);
  if (!isHost(d)) throw new AnynsDnsError('域名格式不合法');
  const body: any = { zone_name: d };
  if (opt.brandNs) body.brand_ns = true;
  const data = await anynsRequest(token, '/api/dns/v1/zones', { method: 'POST', body });
  const z = asZone(data);
  if (!z || !String(z.id ?? '').trim()) {
    throw new AnynsDnsError('AnyNS 已受理但未返回 zone id，请到面板确认该域名是否已创建（不假装成功）');
  }
  return shapeZone(z);
}

/**
 * 幂等建区：先查后建，避免用户重复点「连接供应商」把配额吃满。
 * 返回 found 标记，UI 可据此提示「已存在，直接使用」。
 */
export async function anynsEnsureZone(
  token: string,
  zoneName: string,
  opt: { brandNs?: boolean } = {}
): Promise<AnynsZone & { found: boolean }> {
  const existing = await anynsFindZone(token, zoneName);
  if (existing) return { ...existing, found: true };
  const created = await anynsCreateZone(token, zoneName, opt);
  return { ...created, found: false };
}

export async function anynsDeleteZone(
  token: string,
  zoneId: string,
  opt: { confirmDnssec?: boolean; confirmBrandNs?: boolean } = {}
): Promise<void> {
  const id = String(zoneId || '').trim();
  if (!/^\d+$/.test(id)) throw new AnynsDnsError('缺少合法的 AnyNS zone id');
  const body: any = {};
  if (opt.confirmDnssec) body.confirm_dnssec = true;
  if (opt.confirmBrandNs) body.confirm_brand_ns = true;
  await anynsRequest(token, `/api/dns/v1/zones/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: Object.keys(body).length ? body : undefined,
  });
}

/** 相对名称：根域用官方口径 `@`，子域只取前缀标签 */
export function anynsRelativeName(fqdn: string, zone: string): string {
  const n = norm(fqdn);
  const z = norm(zone);
  if (!z || !n) throw new AnynsDnsError('缺少记录名称或域名');
  if (n === z || n === '@') return '@';
  if (!n.endsWith('.' + z)) throw new AnynsDnsError(`记录名称必须属于 ${z}`);
  return n.slice(0, -(z.length + 1));
}

export type AnynsRecordInput = {
  id?: number;
  name: string;
  type: string;
  value: string;
  ttl?: number;
  line?: string;
  enabled?: boolean;
};

export async function anynsListRecords(token: string, zoneId: string): Promise<any[]> {
  if (!/^\d+$/.test(String(zoneId || ''))) throw new AnynsDnsError('缺少合法的 AnyNS zone id');
  const data = await anynsRequest(token, `/api/dns/v1/zones/${encodeURIComponent(zoneId)}/records`);
  return asArray(data);
}

/** 新建（id 缺省 / 0）或修改（id>0，未传的 ttl/line/enabled 保持原值） */
export async function anynsWriteRecord(
  token: string,
  zoneId: string,
  rec: AnynsRecordInput
): Promise<{ id: string; raw: any }> {
  if (!/^\d+$/.test(String(zoneId || ''))) throw new AnynsDnsError('缺少合法的 AnyNS zone id');
  const type = String(rec.type || '').toUpperCase();
  if (!ANYNS_RECORD_TYPES.includes(type as any)) {
    throw new AnynsDnsError(`AnyNS 不支持的记录类型：${type}（可用 ${ANYNS_RECORD_TYPES.join(' / ')}）`);
  }
  const body: any = {
    name: rec.name,
    type,
    value: String(rec.value || '').trim(),
  };
  if (Number(rec.id) > 0) body.id = Number(rec.id);
  else {
    body.id = 0;
    body.ttl = Math.min(Math.max(Number(rec.ttl || 300) || 300, 60), 86400);
    body.line = String(rec.line || 'default');
  }
  if (rec.ttl !== undefined && Number(rec.id) > 0) body.ttl = Number(rec.ttl);
  if (rec.line !== undefined) body.line = String(rec.line);
  if (rec.enabled !== undefined) body.enabled = !!rec.enabled;

  const data = await anynsRequest(token, `/api/dns/v1/zones/${encodeURIComponent(zoneId)}/records`, {
    method: 'POST',
    body,
  });
  const r = data?.record || data?.data?.record || data;
  const id = String(r?.id ?? data?.id ?? '');
  if (!id) throw new AnynsDnsError('AnyNS 未返回记录 id，请到面板确认（不假装写入成功）');
  return { id, raw: data };
}

export async function anynsDeleteRecord(token: string, zoneId: string, recordId: string): Promise<void> {
  if (!/^\d+$/.test(String(zoneId || '')) || !/^\d+$/.test(String(recordId || ''))) {
    throw new AnynsDnsError('缺少合法的 zone / 记录 id');
  }
  await anynsRequest(
    token,
    `/api/dns/v1/zones/${encodeURIComponent(zoneId)}/records/${encodeURIComponent(recordId)}`,
    { method: 'DELETE' }
  );
}

/** BIND zone file（text/plain） */
export async function anynsExportZone(token: string, zoneId: string): Promise<string> {
  if (!/^\d+$/.test(String(zoneId || ''))) throw new AnynsDnsError('缺少合法的 AnyNS zone id');
  return anynsRequest<string>(token, `/api/dns/v1/zones/${encodeURIComponent(zoneId)}/export`, { text: true });
}

/** 导入 BIND zone file，官方上限 1MB */
export async function anynsImportZone(token: string, zoneId: string, text: string): Promise<any> {
  if (!/^\d+$/.test(String(zoneId || ''))) throw new AnynsDnsError('缺少合法的 AnyNS zone id');
  if (!text || text.length > 1024 * 1024) throw new AnynsDnsError('BIND 文本为空或超过 1MB 上限');
  return anynsRequest(token, `/api/dns/v1/zones/${encodeURIComponent(zoneId)}/import`, {
    method: 'POST',
    body: { text },
  });
}

export async function anynsLines(token: string): Promise<any[]> {
  return asArray(await anynsRequest(token, '/api/dns/v1/lines'));
}

/**
 * 委派状态（注意：官方**没有**独立委派校验接口）。
 * 这里只确认 zone 在不在、AnyNS 记录里分配的 NS 是什么；
 * 「注册商 NS 是否真的改了」必须靠 dig NS / 面板，绝不假装验证过。
 */
export async function anynsDelegationCheck(token: string, zoneName: string, zoneId = '') {
  const z = zoneId
    ? (await anynsListZones(token)).find((x) => String(x.id) === String(zoneId)) || null
    : await anynsFindZone(token, zoneName);
  if (!z) {
    return {
      ok: true,
      supported: true,
      zoneFound: false,
      ns: [],
      note: 'AnyNS 里还没有这个解析区域：请先在面板添加域名，或重新点「托管」自动创建。',
      warning: '官方没有独立的委派校验接口，注册商 NS 是否生效请用 dig NS 或面板确认。',
    };
  }
  return {
    ok: true,
    supported: true,
    zoneFound: true,
    zoneId: z.id,
    ns: z.ns,
    nsSource: z.nsSource,
    brandNs: z.brandNs,
    note: z.nsSource === 'default'
      ? 'AnyNS 未返回专属 NS，下面是平台默认 NS；请到面板确认该域名实际分配的 NS。'
      : `AnyNS 记录的 NS：${z.ns.join(' / ')}`,
    warning: '官方没有独立的委派校验接口；这里只查到 zone 状态，不等于注册商 NS 已生效，请用 dig NS 确认。',
  };
}

/* ── 独立 scope 的端点：DDNS / ACME（令牌同为 nhtdns_ 前缀，但权限不同） ── */

/** DynDNS2：返回协议字面量 good / nochg / nohost / badauth / abuse / 911 */
export async function anynsDdnsUpdate(
  token: string,
  params: { hostname?: string; myip?: string }
): Promise<string> {
  assertAnynsToken(token);
  const r = await anynsRequest<string>(token, '/nic/update', {
    text: true,
    query: { hostname: params.hostname, myip: params.myip },
  });
  return String(r).trim();
}

/** ACME DNS-01：只能用 ACME 令牌，fqdn 必须是 _acme-challenge 下的名字 */
export async function anynsAcmePresent(token: string, fqdn: string, value: string): Promise<any> {
  return anynsRequest(token, '/api/dns/acme/present', {
    method: 'POST',
    body: { fqdn, value },
  });
}

export async function anynsManagedCert(token: string, domain: string): Promise<any> {
  return anynsRequest(token, '/api/dns/certs/current', { query: { domain } });
}
