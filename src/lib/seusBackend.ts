/**
 * 站点级 SEUS DNS 后端 —— 服务端持有 MCP Token，给第三方接入域名写记录
 * ──────────────────────────────────────────────────────────────────────
 * 与 providerDns.ts 的 BYOS 区别：
 *   · providerDns.ts = 用户在页面填自己的 mbt_ Token（旧流程，已不再是主链路）
 *   · seusBackend.ts = 站长在「站点设置 → 第三方域名接入」填一次 MCP Token，
 *     用户提交申请后由站点后端统一连接 / 写记录，用户全程不用、也拿不到凭据。
 *     留空也能用：用户可在连接时临时填自己的 Token（仅本次请求，不落库）。
 *
 * 令牌只有一个来源（不碰环境变量 / Worker Secret / 重新部署）：
 *   settings.seus_api_token       → 后台一个输入框，保存即生效，只回掩码
 *   settings.seus_zone_ids        → "xxx.com:1234" 多根 zone 映射（可选，
 *                                   留空时按域名自动查 dns_zones 并缓存 15 秒）
 *
 * 安全：令牌只在服务端内存使用，不进 /api/config、不进后台 GET 明文、
 * 不写日志；公开接口只拿到「是否已配置」布尔值。
 *
 * 记录名：cf.ts 传进来的 payload.name 是完整 FQDN，SEUS 要相对名
 * （根域用 @，子域只传前缀），由 seusRelativeName 转换。
 *
 * 官方 MCP 工具面：dns_zones / dns_record_create / dns_record_update /
 * dns_record_delete / dns_records_export。参数名按官方服务器暴露的 schema，
 * 未公开的部分不猜 REST 路径，也不假装写入成功。
 */
import { allSettings, invalidateSettings } from './settingsCache.js';
import { normalizeDomain } from './roots.js';
import {
  SeusDnsError, SEUS_NS, SEUS_RECORD_TYPES,
  seusCallTool, seusConnect, seusRelativeName,
} from './seusDns.js';

const ZONE_KEY = 'seus_zone_ids';
const TOKEN_KEY = 'seus_api_token';
let zoneCache: { at: number; map: Map<string, string> } | null = null;
const ZONE_TTL = 15_000;

/** 站点级令牌：只认后台「站点设置」那一个框，不读任何环境变量 / Secret */
export async function seusServerToken(env: any): Promise<string> {
  try {
    const s = await allSettings(env);
    return String(s.get(TOKEN_KEY) || '').trim();
  } catch { return ''; }
}

function parseZoneMap(raw: unknown): Map<string, string> {
  const m = new Map<string, string>();
  for (const seg of String(raw || '').split(/[,\s]+/)) {
    const i = String(seg).search(/[:=]/);
    if (i <= 0) continue;
    const d = normalizeDomain(seg.slice(0, i));
    const id = String(seg.slice(i + 1)).trim();
    if (d && /^[A-Za-z0-9_-]{1,64}$/.test(id)) m.set(d, id);
  }
  return m;
}

export function clearSeusBackendCache(): void {
  zoneCache = null;
  invalidateSettings();
}

/** 取该根域名在 SEUS 的 zone id：先读映射，再按 dns_zones 查一次并缓存 15 秒 */
export async function seusZoneIdFor(env: any, domain: string): Promise<string> {
  const d = normalizeDomain(domain);
  if (!d) return '';
  let map: Map<string, string>;
  if (zoneCache && Date.now() - zoneCache.at < ZONE_TTL) {
    map = zoneCache.map;
  } else {
    let raw = '';
    try { raw = String((await allSettings(env)).get(ZONE_KEY) || ''); } catch { /* 忽略 */ }
    map = parseZoneMap(raw);
    zoneCache = { at: Date.now(), map };
  }
  const hit = map.get(d);
  if (hit) return hit;

  const token = await seusServerToken(env);
  if (!token) return '';
  const r: any = await seusConnect(token, d);
  if (!r?.ok || !r.zoneId) return '';
  map.set(d, String(r.zoneId));
  return String(r.zoneId);
}

function normalizeErr(e: unknown): string {
  const msg = e instanceof SeusDnsError ? e.message : String((e as any)?.message || e || 'SEUS 接口调用失败');
  if (/鉴权|401|403|token/i.test(msg)) return 'SEUS 鉴权失败：请到「站点设置 → 第三方域名接入」检查 mbt_ MCP Token（需 dns:read / dns:write 权限）';
  if (/未找到|没有找到|不存在/.test(msg)) return 'SEUS 账号里没有该域名的托管区域。请先在 s.eus 完成 BYOS 接入（NS 指向 ' + SEUS_NS.join(' / ') + '）并等待人工审核';
  return `SEUS 接口错误：${msg.slice(0, 220)}`;
}

function bad(message: string) {
  return { ok: false, errors: [{ message }], message };
}

/** 只放行 SEUS 支持的记录类型，避免用户选了写不进去的类型 */
function checkType(type: unknown): string {
  const t = String(type || '').toUpperCase();
  if (!SEUS_RECORD_TYPES.includes(t as any)) return `SEUS DNS 不支持的记录类型：${t || '（空）'}`;
  return '';
}

async function requireZone(env: any, root: string) {
  const token = await seusServerToken(env);
  if (!token) return { error: bad('站点尚未配置 SEUS MCP Token：请站长到「站点设置 → 第三方域名接入」的唯一输入框填写（保存即生效，不用重新部署）') };
  const zoneId = await seusZoneIdFor(env, root);
  if (!zoneId) return { error: bad(`SEUS 账号里找不到 ${root} 的托管区域，请先在 s.eus 完成 DNS 托管`) };
  return { token, zoneId };
}

export async function seusBackendCreate(env: any, payload: any, root: string) {
  const t = checkType(payload?.type);
  if (t) return bad(t);
  const z = await requireZone(env, root);
  if (z.error) return z.error;
  try {
    const name = seusRelativeName(String(payload?.name || root), root);
    const r: any = await seusCallTool(z.token, 'dns_record_create', {
      zoneId: z.zoneId,
      type: String(payload.type).toUpperCase(),
      name,
      content: String(payload?.content || ''),
      ttl: Number(payload?.ttl || 1) === 1 ? 300 : Number(payload?.ttl || 300),
    });
    const id = String(r?.id ?? r?.record?.id ?? r?.recordId ?? '');
    if (!id) return bad('SEUS 返回中缺少记录 id，写入状态无法确认，请到 s.eus 面板核对');
    return { ok: true, result: { id, name, type: String(payload.type).toUpperCase() } };
  } catch (e) { return bad(normalizeErr(e)); }
}

export async function seusBackendUpdate(env: any, id: string, payload: any, root: string) {
  const t = checkType(payload?.type);
  if (t) return bad(t);
  const z = await requireZone(env, root);
  if (z.error) return z.error;
  try {
    const name = seusRelativeName(String(payload?.name || root), root);
    const r: any = await seusCallTool(z.token, 'dns_record_update', {
      zoneId: z.zoneId,
      recordId: String(id),
      type: String(payload.type).toUpperCase(),
      name,
      content: String(payload?.content || ''),
      ttl: Number(payload?.ttl || 1) === 1 ? 300 : Number(payload?.ttl || 300),
    });
    return { ok: true, result: { id: String(id), name, ...(r && typeof r === 'object' ? r : {}) } };
  } catch (e) { return bad(normalizeErr(e)); }
}

export async function seusBackendDelete(env: any, id: string, root: string) {
  const z = await requireZone(env, root);
  if (z.error) return z.error;
  try {
    await seusCallTool(z.token, 'dns_record_delete', { zoneId: z.zoneId, recordId: String(id) });
    return { ok: true, result: { id: String(id) } };
  } catch (e) { return bad(normalizeErr(e)); }
}

export async function seusBackendList(env: any, params: any, root: string) {
  const z = await requireZone(env, root);
  if (z.error) return z.error;
  try {
    const data: any = await seusCallTool(z.token, 'dns_records_export', { zoneId: z.zoneId });
    const rows: any[] = Array.isArray(data) ? data
      : Array.isArray(data?.records) ? data.records
        : Array.isArray(data?.data) ? data.data : [];
    let arr = rows.map((r: any) => ({
      id: String(r?.id ?? r?.recordId ?? ''),
      type: String(r?.type || '').toUpperCase(),
      name: String(r?.name || '@') === '@' ? root : `${String(r?.name || '')}.${root}`,
      content: String(r?.content ?? r?.value ?? ''),
      ttl: Number(r?.ttl || 300),
    }));
    if (params?.type) arr = arr.filter((x) => x.type === String(params.type).toUpperCase());
    if (params?.name) arr = arr.filter((x) => x.name === normalizeDomain(params.name));
    return { ok: true, result: arr };
  } catch (e) { return bad(normalizeErr(e)); }
}
