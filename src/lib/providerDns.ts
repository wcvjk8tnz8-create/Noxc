/**
 * 第三方域名接入 · 用「用户自己的供应商 API key」写 DNS 记录
 *
 * 支持两家：
 *   - Cloudflare：官方 v4 API，GET /zones?name= 找 zone，
 *     POST /zones/{id}/dns_records 写记录（Bearer Token，需 Zone Read + DNS Write）
 *   - DNSHE：沿用仓库已有 createZoneAtProvider 建区；记录端点按官方
 *     /v1/zones/{id}/records 惯例调用，若服务商路径不同会明确报错并提示到面板手动添加
 *
 * 安全边界（很重要）：
 *   - API key 只在本次请求的内存里用，不落库、不写日志、不回传前端
 *   - 写入的 name 必须等于已验证域名或其子域，防止拿本站当任意域名的写接口
 *   - 只有 TXT 所有权验证通过（verified）的记录才允许调用写接口
 *
 * 前提（UI 会明确提示）：域名 NS 必须已经指向该供应商。
 * 否则记录写进了供应商的 zone，但全球 DNS 不会向它查询，等于没生效。
 */
import { findProvider, createZoneAtProvider } from './delegation.js';

const CF = 'https://api.cloudflare.com/client/v4';
export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'] as const;

export type DnsRecordInput = {
  type: string;
  name: string;
  content: string;
  ttl?: number;
};

function normalizeName(raw: unknown, domain: string): string {
  let n = String(raw ?? '').trim().toLowerCase().replace(/\.+$/, '');
  if (!n || n === '@') n = domain;
  return n;
}

/** 只允许写本域名及其子域，别把本站变成任意 zone 的写接口 */
export function isNameInDomain(name: string, domain: string): boolean {
  const n = normalizeName(name, domain);
  const d = String(domain || '').toLowerCase();
  return n === d || n.endsWith('.' + d);
}

function validate(rec: DnsRecordInput): string {
  const t = String(rec?.type || '').toUpperCase();
  if (!(RECORD_TYPES as readonly string[]).includes(t)) return `不支持的记录类型：${t}`;
  const name = String(rec?.name || '').trim();
  const content = String(rec?.content || '').trim();
  if (!name) return '请填写记录名称（@ 表示主域名）';
  if (!content) return '请填写记录值';
  if (content.length > 2048) return '记录值过长（上限 2048 字符）';
  if (t === 'A' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(content)) return 'A 记录需要 IPv4 地址';
  return '';
}

async function cfFetch(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(CF + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

/** 连接供应商：找到 / 创建 zone，返回官方 NS 供用户去注册商修改 */
export async function connectProvider(providerKey: string, token: string, domain: string) {
  if (!token) return { ok: false, error: '请填写供应商 API key' };
  if (providerKey === 'cloudflare') {
    const r = await cfFetch(`/zones?name=${encodeURIComponent(domain)}&per_page=1`, token);
    if (r.status !== 200 || !r.json?.success) {
      const msg = r.json?.errors?.[0]?.message || `HTTP ${r.status}`;
      return { ok: false, error: `Cloudflare 校验失败：${String(msg).slice(0, 180)}。请确认 Token 有 Zone Read 权限` };
    }
    const z = r.json?.result?.[0];
    if (!z?.id) {
      return { ok: false, error: 'Cloudflare 账号里还没有这个域名的站点，请先在 dash.cloudflare.com 添加站点（Add site）后再回来连接' };
    }
    return {
      ok: true,
      provider: 'cloudflare',
      zoneId: String(z.id),
      ns: Array.isArray(z.name_servers) ? z.name_servers.map(String) : [],
      zoneStatus: String(z.status || ''),
      note: z.status === 'active'
        ? '站点已激活，可以直接添加 DNS 记录'
        : '站点尚未激活：请到域名注册商把 NS 改成上方两台，Cloudflare 显示 Active 后记录才会生效',
    };
  }
  if (providerKey === 'dnshe') {
    const r: any = await createZoneAtProvider(findProvider('dnshe'), token, domain);
    if (!r?.ok) {
      return { ok: false, error: `DNSHE 建区未成功：${String(r?.error || '未知错误').slice(0, 180)}` };
    }
    const ns = Array.isArray(r.ns) ? r.ns.map(String).filter(Boolean) : [];
    return {
      ok: true,
      provider: 'dnshe',
      zoneId: String(r.zoneId || ''),
      ns,
      zoneStatus: '',
      note: ns.length
        ? '已创建解析区域：请到域名注册商把 NS 改成上方两台，生效后记录才会被全球 DNS 查询'
        : '已创建解析区域，请到 DNSHE 面板查看分配给你的官方 NS 并修改注册商 NS',
    };
  }
  return { ok: false, error: '不支持的供应商（可选 cloudflare / dnshe）' };
}

/** 写一条 DNS 记录：必须用已验证域名 + 用户本次提供的 key */
export async function addRecord(
  providerKey: string, token: string, domain: string,
  zoneId: string, rec: DnsRecordInput
) {
  const err = validate(rec);
  if (err) return { ok: false, error: err };
  const name = normalizeName(rec.name, domain);
  if (!isNameInDomain(name, domain)) {
    return { ok: false, error: `记录名称必须属于 ${domain}（主域名或其子域）` };
  }
  if (!token) return { ok: false, error: '请填写供应商 API key（不会保存）' };
  const type = String(rec.type).toUpperCase();
  const ttl = Math.min(Math.max(Number(rec.ttl || 3600) || 3600, 60), 86400);

  if (providerKey === 'cloudflare') {
    if (!zoneId) return { ok: false, error: '缺少 Cloudflare zone id，请先点「连接供应商」' };
    const r = await cfFetch(`/zones/${encodeURIComponent(zoneId)}/dns_records`, token, {
      method: 'POST',
      body: JSON.stringify({ type, name, content: String(rec.content).trim(), ttl, proxied: false }),
    });
    if (r.status >= 400 || !r.json?.success) {
      const msg = r.json?.errors?.[0]?.message || `HTTP ${r.status}`;
      return { ok: false, error: `Cloudflare 写入失败：${String(msg).slice(0, 180)}` };
    }
    return { ok: true, id: String(r.json?.result?.id || ''), name, type, note: '已写入 Cloudflare DNS 记录' };
  }

  if (providerKey === 'dnshe') {
    /* DNSHE 记录端点沿用官方 REST 惯例 /v1/zones/{id}/records。
       该路径未在沙盒里实测（无法出网验证），失败时给明确提示，
       绝不假装写入成功。 */
    if (!zoneId) return { ok: false, error: '缺少 DNSHE zone id，请先点「连接供应商」' };
    const p: any = findProvider('dnshe');
    const url = p.api.base + `/v1/zones/${encodeURIComponent(zoneId)}/records`;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ type, name, content: String(rec.content).trim(), ttl }),
      });
      const text = await r.text();
      if (!r.ok) {
        return { ok: false, error: `DNSHE 记录接口返回 ${r.status}。请到 my.dnshe.org 面板手动添加该记录：${name} ${type} ${String(rec.content).trim()}` };
      }
      let j: any = {}; try { j = JSON.parse(text); } catch {}
      return { ok: true, id: String(j?.id || j?.record?.id || ''), name, type, note: '已向 DNSHE 提交记录，请到面板确认' };
    } catch (e: any) {
      return { ok: false, error: `调用 DNSHE 失败：${String(e?.message || e).slice(0, 160)}` };
    }
  }
  return { ok: false, error: '不支持的供应商' };
}
