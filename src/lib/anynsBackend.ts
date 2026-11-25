/**
 * AnyNS 作为「站点级 DNS 后端」——服务端持有管理令牌，给根域名 zone 写记录
 * ──────────────────────────────────────────────────────────────────────
 * 与 src/lib/anynsDns.ts 的区别（很重要）：
 *   · anynsDns.ts        = BYOS 场景，用户在页面填自己的 nhtdns_ 令牌，
 *                           只用于「NS 委派 / 第三方域名接入」，令牌不落库
 *   · anynsBackend.ts    = 站点后端场景，管理员在 Worker Secret 里配一次
 *                           ANYNS_API_TOKEN，cf.ts 把某个根域名的记录下发
 *                           切到 AnyNS 官方管理 API（用户无感、无需填 key）
 *
 * 这就是「后台的 api」的意思：我（站长）用 api key 给根域名添加记录，
 * 而不是让每个用户自带 key。配置全在环境变量 / Secret，**不改后台 UI**。
 *
 * 配置：
 *   ANYNS_API_TOKEN   必需，anyns.io 面板建的「管理令牌」nhtdns_ 开头
 *   ANYNS_ROOTS       可选，逗号分隔，默认取 ROOT_DOMAIN（meoy.top）
 *   ANYNS_ZONE_ID     可选，单个 zone id（ANYNS_ROOTS 只有一个时最省事）
 *   ANYNS_ZONE_IDS    可选，"meoy.top:4821,noxc.uk:4822" 形式的多根映射
 * 没配 zone id 时按域名调 GET /api/dns/v1/zones 查一次并缓存 15 秒，
 * 查不到会明确报错，绝不假装写入成功。
 *
 * 记录名：Cloudflare 侧 payload.name 是完整 FQDN；AnyNS 要相对名，
 * 根域（name === 根域名）用官方口径 `@`，子域只传前缀标签。
 */
import {
  AnynsDnsError, ANYNS_RECORD_TYPES, anynsFindZone, anynsListRecords,
  anynsWriteRecord, anynsDeleteRecord, anynsRelativeName,
} from './anynsDns.js';
import { normalizeDomain } from './roots.js';

export type AnynsServerConfig = {
  token: string;
  roots: string[];
  zoneIds: Map<string, string>;
  defaultZoneId: string;
};

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\.+$/, '');
}

function parseZoneMap(raw: unknown): Map<string, string> {
  const m = new Map<string, string>();
  for (const seg of String(raw || '').split(/[,\s]+/)) {
    const i = String(seg).search(/[:=]/);
    if (i <= 0) continue;
    const d = norm(seg.slice(0, i));
    const id = String(seg.slice(i + 1)).trim();
    if (d && /^\d+$/.test(id)) m.set(d, id);
  }
  return m;
}

/** 从 Worker env / Secret 读站点级配置；没配 token 返回 null（其它后端照常工作） */
export function anynsServerConfig(env: any): AnynsServerConfig | null {
  const token = String(env?.ANYNS_API_TOKEN || '').trim();
  if (!token) return null;
  const rootsRaw = String(env?.ANYNS_ROOTS || '').trim();
  const roots = (rootsRaw
    ? rootsRaw.split(/[,\s]+/).map(norm).filter(Boolean)
    : [norm(env?.ROOT_DOMAIN)].filter(Boolean));
  return {
    token,
    roots,
    zoneIds: parseZoneMap(env?.ANYNS_ZONE_IDS),
    defaultZoneId: /^\d+$/.test(String(env?.ANYNS_ZONE_ID || '').trim())
      ? String(env.ANYNS_ZONE_ID).trim() : '',
  };
}

/** 这个根域名是否走 AnyNS 后端 */
export function anynsRootEnabled(cfg: AnynsServerConfig | null, root: string): boolean {
  const d = norm(root);
  return !!cfg && cfg.roots.some((r) => d === r || d.endsWith('.' + r));
}

/* zone id 解析缓存：避免每次写记录都多一次 /zones 请求 */
let zoneCache: { key: string; id: string; at: number } | null = null;
const ZONE_TTL = 15_000;

/** 取根域名对应的 AnyNS zone id（显式配置 > 按域名查一次） */
export async function anynsZoneId(cfg: AnynsServerConfig, root: string): Promise<string> {
  const d = norm(root);
  const explicit = cfg.zoneIds.get(d) || (cfg.roots.length === 1 ? cfg.defaultZoneId : '');
  if (explicit) return explicit;
  const key = `${cfg.token.slice(-6)}:${d}`;
  if (zoneCache && zoneCache.key === key && Date.now() - zoneCache.at < ZONE_TTL) {
    return zoneCache.id;
  }
  const z = await anynsFindZone(cfg.token, d);
  if (!z || !z.id) {
    throw new AnynsDnsError(
      `AnyNS 里找不到根域名 ${d} 的解析区域：请先到 anyns.io 面板添加该域名，或配置 ANYNS_ZONE_ID / ANYNS_ZONE_IDS`
    );
  }
  zoneCache = { key, id: z.id, at: Date.now() };
  return z.id;
}

/** 仅供回归 / 配置变更时清空缓存 */
export function clearAnynsZoneCache() { zoneCache = null; }

/** Cloudflare payload → AnyNS 的 {name, type, value, ttl} */
export function toAnynsRecord(payload: any, root: string): {
  ok: boolean; record?: { name: string; type: string; value: string; ttl: number };
  error?: string;
} {
  const type = String(payload?.type || '').toUpperCase();
  if (!ANYNS_RECORD_TYPES.includes(type as any)) {
    return { ok: false, error: `AnyNS 后端暂不支持 ${type} 记录（支持 ${ANYNS_RECORD_TYPES.join(' / ')}）` };
  }
  const fqdn = norm(payload?.name);
  const r = norm(root);
  if (!fqdn || !r) return { ok: false, error: '缺少记录名称或根域名' };
  let name: string;
  try { name = anynsRelativeName(fqdn, r); }
  catch (e: any) {
    return { ok: false, error: `记录名称 ${fqdn} 不属于 ${r}：${String(e?.message || e)}` };
  }

  const content = String(payload?.content ?? '').trim();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : null;
  let value = content;
  if (type === 'MX') {
    value = `${Number(payload?.priority ?? 10) || 10} ${content}`;
  } else if (type === 'SRV' && data) {
    value = `${data.priority ?? 1} ${data.weight ?? 5} ${data.port ?? 0} ${data.target || content}`.trim();
  } else if (type === 'CAA' && data) {
    value = `${data.flags ?? 0} ${data.tag || 'issue'} "${String(data.value ?? content)}"`;
  }
  if (!value) return { ok: false, error: '记录值不能为空' };

  /* Cloudflare 的 ttl=1 是 automatic；AnyNS 用官方示例的 300 */
  const rawTtl = Number(payload?.ttl ?? 300);
  const ttl = rawTtl === 1 ? 300 : Math.min(Math.max(rawTtl || 300, 60), 86400);
  return { ok: true, record: { name, type, value, ttl } };
}

/** AnyNS 相对名 → 完整 FQDN（cfList 要按 name 精确匹配 NS 记录） */
export function anynsToFqdn(name: string, root: string): string {
  const n = norm(name);
  const r = norm(root);
  if (!n || n === '@') return r;
  return `${n}.${r}`;
}

function listShape(r: any, root: string) {
  return {
    id: String(r?.id ?? ''),
    type: String(r?.type || '').toUpperCase(),
    name: anynsToFqdn(String(r?.name ?? '@'), root),
    content: String(r?.value ?? r?.content ?? ''),
    ttl: Number(r?.ttl ?? 300),
    priority: null,
    proxied: false,
  };
}

function asCfError(e: any) {
  const msg = e instanceof AnynsDnsError
    ? e.message
    : `AnyNS 后端调用失败：${String(e?.message || e).slice(0, 200)}`;
  return { ok: false, errors: [{ message: msg }], message: msg };
}

/** 统一取 zone id + 根域名，失败转成 cf.ts 的 {ok:false, errors} 形状 */
async function ctx(env: any, root: string) {
  const cfg = anynsServerConfig(env);
  if (!cfg) throw new AnynsDnsError('未配置 ANYNS_API_TOKEN：请先在 Worker Secret 里填入 anyns.io 面板创建的管理令牌');
  const r = norm(root);
  const zoneId = await anynsZoneId(cfg, r);
  return { cfg, root: r, zoneId };
}

export async function anynsBackendCreate(env: any, payload: any, root: string) {
  try {
    const { cfg, root: r, zoneId } = await ctx(env, root);
    const conv = toAnynsRecord(payload, r);
    if (!conv.ok) return { ok: false, errors: [{ message: conv.error }], message: conv.error };
    const out = await anynsWriteRecord(cfg.token, zoneId, conv.record!);
    return { ok: true, result: { id: out.id } };
  } catch (e) { return asCfError(e); }
}

export async function anynsBackendUpdate(env: any, id: string, payload: any, root: string) {
  try {
    const { cfg, root: r, zoneId } = await ctx(env, root);
    const conv = toAnynsRecord(payload, r);
    if (!conv.ok) return { ok: false, errors: [{ message: conv.error }], message: conv.error };
    if (!/^\d+$/.test(String(id || ''))) {
      return {
        ok: false,
        errors: [{ message: '这条记录是迁移前由旧 DNS 后端创建的，无法在 AnyNS 直接修改；请删除后重新添加' }],
        message: '这条记录是迁移前由旧 DNS 后端创建的，无法在 AnyNS 直接修改；请删除后重新添加',
      };
    }
    const out = await anynsWriteRecord(cfg.token, zoneId, {
      ...conv.record!, id: Number(id),
    });
    return { ok: true, result: { id: out.id } };
  } catch (e) { return asCfError(e); }
}

export async function anynsBackendDelete(env: any, id: string, root: string) {
  try {
    const { cfg, root: r, zoneId } = await ctx(env, root);
    if (!/^\d+$/.test(String(id || ''))) {
      /* 旧后端留下的 id：不谎报远端删除，但也不阻断本地记录清理 */
      return {
        ok: true, result: { id },
        warning: '该记录原由旧 DNS 后端创建，AnyNS 侧可能仍有残留，请到面板确认',
      };
    }
    await anynsDeleteRecord(cfg.token, zoneId, String(id));
    return { ok: true, result: { id } };
  } catch (e) { return asCfError(e); }
}

export async function anynsBackendList(env: any, params: any, root: string) {
  try {
    const { cfg, root: r, zoneId } = await ctx(env, root);
    const rows = await anynsListRecords(cfg.token, zoneId);
    let arr = rows.map((x) => listShape(x, r));
    if (params?.type) arr = arr.filter((x) => x.type === String(params.type).toUpperCase());
    if (params?.name) arr = arr.filter((x) => x.name === normalizeDomain(params.name));
    return { ok: true, result: arr };
  } catch (e) { return asCfError(e); }
}
