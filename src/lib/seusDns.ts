/**
 * SEUS DNS（s.eus / Nssnap Community）供应商适配 —— 官方 MCP Streamable HTTP 通道
 *
 * 为什么走 MCP 而不是裸 HTTP：
 *   SEUS 开发者文档（https://s.eus/en/docs）明确把「自动化注册子域、管理 DNS 记录」
 *   列为 Domains / DNS API 能力，但文档子页需要站内会话，外部只能读到 Introduction；
 *   社区官方教程（https://s.eus/en/post/645542358135990922）给出的自动化入口是
 *   https://s.eus/api/mcp + 账户设置里生成的 `mbt_xxx` Token + `Authorization: Bearer`。
 *   该 MCP 的 DNS 工具面（dns_zones / dns_zone_get / dns_record_create /
 *   dns_record_update / dns_record_delete / dns_records_import / dns_records_export /
 *   dns_zone_delete / dns_zone_dnssec / dns_events / dns_pricing）由官方服务器暴露，
 *   工具 schema 由第三方 MCP 目录实抓确认。这里不猜测任何未公开的 REST 路径。
 *
 * 协议：JSON-RPC 2.0 over Streamable HTTP
 *   POST initialize → 响应头 Mcp-Session-Id → POST notifications/initialized
 *   → POST tools/call。响应可能是 application/json，也可能是 text/event-stream
 *   （逐行 `data: {...}`），两条都要能解析。
 *
 * 安全：token 只在本次调用内存里用，不落库、不写日志、不回传前端。
 * 每次调用独立开会话，不缓存 token 与 session，避免跨请求串号。
 *
 * 前提：SEUS 的 DNS 托管是「把域名接入其权威 DNS」。BYOS 需要 KYC L2、
 * 剩余有效期 ≥ 2 年、NS 指向 a.ns.fs5.net / b.ns.fs5.net 并通过人工审核。
 * 本站不代替用户做 BYOS，也不自动建区：查不到托管区域就明确提示。
 */

export const SEUS_MCP_URL = 'https://s.eus/api/mcp';
export const SEUS_NS = ['a.ns.fs5.net', 'b.ns.fs5.net'] as const;
export const SEUS_RECORD_TYPES = [
  'A', 'AAAA', 'CNAME', 'ALIAS', 'MX', 'TXT', 'SRV', 'CAA', 'NS',
  'PTR', 'SVCB', 'HTTPS', 'TLSA', 'DNAME',
] as const;

const PROTOCOL_VERSION = '2025-06-18';
const TIMEOUT_MS = 10_000;

export class SeusDnsError extends Error {}

type RpcMessage = { result?: any; error?: any; id?: number };

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\.+$/, '');
}

/** SSE 与纯 JSON 两种 Streamable HTTP 响应都要吃得下 */
function parseRpcBody(text: string, contentType: string): RpcMessage | null {
  const isSse = /text\/event-stream/i.test(contentType) || /^\s*(event:|data:)/i.test(text);
  if (isSse) {
    const lines = text.split(/\r?\n/).filter((l) => l.startsWith('data:'));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(lines[i].slice(5).trim());
        if (j && (j.result !== undefined || j.error !== undefined)) return j;
      } catch { /* 跳过非 JSON 的 data 行（如 keep-alive） */ }
    }
    return null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

let rpcId = 0;

async function rpc(
  token: string,
  method: string,
  params: any,
  sessionId: string
): Promise<{ result: any; sessionId: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const body: any = { jsonrpc: '2.0', method, params };
  if (method !== 'notifications/initialized') body.id = ++rpcId;

  let res: Response;
  try {
    res = await fetch(SEUS_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    throw new SeusDnsError(
      `连接 SEUS DNS 失败：${String(e?.message || e).slice(0, 160)}。请稍后重试或到 s.eus 控制台确认服务状态`
    );
  } finally {
    clearTimeout(timer);
  }

  const sid = res.headers.get('Mcp-Session-Id') || sessionId || '';
  if (method === 'notifications/initialized') {
    // 通知没有响应体，读掉即可（避免连接被提前释放）
    try { await res.text(); } catch { /* 忽略 */ }
    return { result: null, sessionId: sid };
  }

  const text = await res.text().catch(() => '');
  if (res.status === 401 || res.status === 403) {
    throw new SeusDnsError(
      'SEUS 鉴权失败：请确认填的是账户设置里生成的 mbt_ 开头的 MCP Token，且具备 dns:read / dns:write 权限'
    );
  }
  if (res.status >= 400) {
    throw new SeusDnsError(`SEUS 接口返回 HTTP ${res.status}。${String(text).slice(0, 160)}`);
  }

  const msg = parseRpcBody(text, res.headers.get('content-type') || '');
  if (!msg) {
    throw new SeusDnsError('SEUS 返回内容无法解析（既不是 JSON 也不是 SSE）。请确认 /api/mcp 是 Streamable HTTP 端点');
  }
  if (msg.error) {
    const d = msg.error?.message || msg.error?.data || JSON.stringify(msg.error);
    throw new SeusDnsError(`SEUS 接口错误：${String(d).slice(0, 220)}`);
  }
  return { result: msg.result ?? msg, sessionId: sid };
}

/** 一次调用开一条会话：initialize → initialized → tools/call */
async function toolCall(token: string, name: string, args: any): Promise<any> {
  if (!token) throw new SeusDnsError('请填写 SEUS MCP Token（账户设置里生成的 mbt_ 开头）');
  const init = await rpc(token, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'noxc', version: '1.0.0' },
  }, '');
  await rpc(token, 'notifications/initialized', {}, init.sessionId);
  const { result } = await rpc(token, 'tools/call', { name, arguments: args }, init.sessionId);

  const parts = Array.isArray(result?.content) ? result.content : [];
  const text = parts
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  if (result?.isError || /^\s*error[:\s]/i.test(text)) {
    throw new SeusDnsError(`SEUS 工具 ${name} 执行失败：${String(text || '未知错误').slice(0, 220)}`);
  }
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 纯文本结果也允许上层处理 */ }
  return data;
}

function asArray(data: any, depth = 0): any[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object' || depth > 3) return [];
  for (const k of ['zones', 'items', 'records', 'data', 'result', 'list']) {
    const v = data[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const nested = asArray(v, depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}

/**
 * 连接：只查找该域名在 SEUS 的 DNS 托管区域，不自动创建。
 * 找不到就明确提示先到 s.eus 控制台 / BYOS 完成接入，绝不假装已托管。
 */
export async function seusConnect(token: string, domain: string) {
  const d = norm(domain);
  const data = await toolCall(token, 'dns_zones', {});
  const zones = asArray(data);
  const hit = zones.find((z: any) => {
    const n = norm(z?.name ?? z?.domain ?? z?.zone ?? z?.fqdn ?? z?.zoneName);
    return n === d;
  });
  const zoneId = String(hit?.id ?? hit?.zoneId ?? hit?.zone_id ?? '');
  if (!zoneId) {
    return {
      ok: false as const,
      error: `SEUS 账号里没有找到 ${d} 的 DNS 托管区域。请先到 s.eus 控制台创建解析区域（BYOS 需 KYC L2、域名剩余有效期 ≥ 2 年、NS 指向 ${SEUS_NS.join(' / ')} 并通过人工审核），再回来连接`,
      ns: [...SEUS_NS],
    };
  }
  return {
    ok: true as const,
    provider: 'seus',
    zoneId,
    ns: [...SEUS_NS],
    zoneStatus: String(hit?.status ?? hit?.state ?? ''),
    note: `已找到 SEUS DNS 托管区域。请确认注册商 NS 已指向 ${SEUS_NS.join(' / ')}；NS 生效前写入的记录不会被全球 DNS 查询`,
  };
}

/** 写一条记录。name 必须是相对名称（@ 表示区顶点），由上层先做越域校验。 */
export async function seusCreateRecord(
  token: string,
  zoneId: string,
  rec: { type: string; name: string; content: string; ttl: number }
) {
  if (!zoneId) throw new SeusDnsError('缺少 SEUS zone id，请先点「连接供应商」');
  const data = await toolCall(token, 'dns_record_create', {
    zoneId,
    type: String(rec.type).toUpperCase(),
    name: rec.name,
    content: rec.content,
    ttl: rec.ttl,
  });
  const id = String(
    data?.id ?? data?.record?.id ?? data?.recordId ?? data?.data?.id ?? data?.result?.id ?? ''
  );
  return { id, name: rec.name, type: String(rec.type).toUpperCase() };
}

/** 完整 FQDN → SEUS 的相对名称；@ 表示区顶点 */
export function seusRelativeName(name: string, domain: string): string {
  const n = norm(name);
  const d = norm(domain);
  if (!n || n === '@' || n === d) return '@';
  if (n.endsWith('.' + d)) return n.slice(0, -(d.length + 1));
  return n;
}
