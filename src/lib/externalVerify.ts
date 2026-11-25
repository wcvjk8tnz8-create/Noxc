/**
 * 第三方域名接入 · TXT 所有权验证
 *
 * 用户要接入自己的域名，必须先在**当前的 DNS 服务商**加一条 TXT：
 *   _noxc-verify.<domain>  TXT  noxc-verify=<随机 token>
 * 后端用 DNS-over-HTTPS 的 JSON 接口查询（Workers 里没有 UDP DNS，
 * 但 fetch 到公共 DoH 是允许的），命中即证明用户控制该域名的解析。
 * Cloudflare 1.1.1.1 优先，Google DoH 兜底，避免单点解析缓存差异。
 *
 * 注意：TXT 只证明所有权，**不会让本站写的记录生效**。
 * 记录要真正生效，域名 NS 必须指向提供 API key 的那家供应商
 * （Cloudflare / DNSHE / SEUS DNS / anyns.io），这一步在 UI 里明确提示，不能省。
 */
export const VERIFY_PREFIX = '_noxc-verify';
export const VERIFY_VALUE_PREFIX = 'noxc-verify=';

/** 生成一次性验证 token（32 hex） */
export function newVerifyToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function verifyHost(domain: string): string {
  return `${VERIFY_PREFIX}.${domain}`;
}

export function verifyValue(token: string): string {
  return `${VERIFY_VALUE_PREFIX}${token}`;
}

/** DoH 返回的 TXT 数据常带引号，长 TXT 还会被拆成 "a" "b" 两段 */
function cleanTxt(raw: unknown): string {
  return String(raw ?? '')
    .replace(/^"|"$/g, '')
    .replace(/"\s+"/g, '')
    .trim();
}

async function queryTxt(name: string, url: (n: string) => string, headers: Record<string, string>): Promise<string[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url(name), { headers, signal: ctl.signal });
    if (!r.ok) return [];
    const j: any = await r.json();
    return (j?.Answer || [])
      .filter((a: any) => Number(a?.type) === 16)
      .map((a: any) => cleanTxt(a?.data));
  } catch { return []; }
  finally { clearTimeout(timer); }
}

/**
 * 查 _noxc-verify.<domain> 的 TXT，判断是否有期望的 token。
 * 两家 DoH 都查不到才判失败（DNS 传播期给明确提示，不算错误）。
 */
export async function checkOwnership(domain: string, token: string): Promise<{ ok: boolean; detail: string }> {
  const host = verifyHost(domain);
  const want = verifyValue(token);
  const cf = await queryTxt(host,
    (n) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(n)}&type=TXT`,
    { accept: 'application/dns-json' });
  let all = cf;
  if (!cf.includes(want)) {
    const gg = await queryTxt(host,
      (n) => `https://dns.google/resolve?name=${encodeURIComponent(n)}&type=TXT`,
      {});
    all = [...cf, ...gg];
  }
  if (all.includes(want)) return { ok: true, detail: 'TXT 验证通过' };
  if (!all.length) {
    return { ok: false, detail: `还没查到 ${host} 的 TXT 记录。请确认已在域名当前的 DNS 服务商添加，DNS 生效通常需要几分钟到几小时。` };
  }
  return { ok: false, detail: `查到 TXT，但值不匹配。期望：${want}` };
}
