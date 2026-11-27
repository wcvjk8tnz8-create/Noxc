/**
 * 第三方域名接入 · 准入策略（唯一来源）
 * ──────────────────────────────────────────────────────────────────────
 * 站长定的流程：
 *   ① 用户填自己拥有的完整域名（如 xxx.com）
 *   ② 不允许子域名（xxx.example.com 不行），只允许注册局级别的二级域
 *   ③ 只允许 gTLD（通用顶级域），ccTLD / 国家地区后缀一律不受理
 *   ④ 固定托管到 SEUS DNS，NS 必须是 a.ns.fs5.net / b.ns.fs5.net
 *   ⑤ 用 SEUS 的 API（站点级 MCP Token）连接、查到托管区域
 *   ⑥ 站长在「站点设置 → 第三方域名接入」看到申请，批准后才生效
 *
 * 为什么用「标签数 === 2」而不是完整 PSL：
 *   co.uk / com.cn 这类公共后缀会让「二级域」判断变复杂，而本策略本来就
 *   只放行 gTLD，这些 ccTLD 委派后缀全部在禁止之列，两段标签是最干净、
 *   也最好向用户解释的口径。要放行新的 gTLD，只需往 GTLD_ALLOWLIST 加一项。
 *
 * 不做 TXT 所有权验证：站长人工批准 + 「SEUS 账号里必须真的存在该托管
 * 区域」+ 「注册商 NS 指向 SEUS」三道关已经构成权属链，不再让用户多填记录。
 */
import { SEUS_NS } from './seusDns.js';

/** 第三方接入固定使用 SEUS DNS，不提供供应商选择 */
export const EXTERNAL_DNS_PROVIDER = 'seus';
export const EXTERNAL_DNS_LABEL = 'SEUS DNS';
export const EXTERNAL_NS: readonly string[] = [...SEUS_NS];
export const EXTERNAL_MAX_PER_USER = 5;

/**
 * 允许的 gTLD（ICANN 通用顶级域，含新通用顶级域）。
 * ccTLD（.cn/.uk/.cc/.io/.ai/.tv/.me/.co/.hk/.tw/.jp/.de ...）一律不在表内。
 * 注意 .io/.ai/.tv/.me/.co 常被当通用域卖，但 IANA 归类仍是 ccTLD，按站长
 * 「只允许 gtld」的要求排除；需要放行时在这里显式加，并同步改回归。
 */
export const GTLD_ALLOWLIST: readonly string[] = [
  // 经典通用顶级域
  'com', 'net', 'org', 'info', 'biz', 'name', 'pro', 'aero', 'coop', 'museum',
  'jobs', 'mobi', 'tel', 'travel', 'asia', 'cat', 'post', 'xxx', 'edu',
  // 常见新通用顶级域
  'xyz', 'top', 'online', 'site', 'tech', 'store', 'shop', 'cloud', 'app', 'dev',
  'blog', 'news', 'wiki', 'web', 'website', 'space', 'fun', 'live', 'video', 'movie',
  'music', 'art', 'design', 'photo', 'photography', 'studio', 'agency', 'company',
  'solutions', 'services', 'systems', 'network', 'digital', 'global', 'world', 'life',
  'club', 'group', 'team', 'community', 'social', 'chat', 'email', 'mail', 'link',
  'click', 'tips', 'guide', 'review', 'reviews', 'best', 'plus', 'expert',
];
/* 只读集合：经典段与新通用段有重叠（pro 等），去重后判定与计数都准确 */
export const GTLD_SET: ReadonlySet<string> = new Set(GTLD_ALLOWLIST);

/** 文档示例 / 保留域，不允许当成「自己的域名」提交 */
export const RESERVED_REGISTRABLE: readonly string[] = [
  'example.com', 'example.net', 'example.org', 'example.edu',
  'localhost.com', 'test.com', 'invalid.com',
];

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_SHAPE_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** 归一化：去协议 / 路径 / 端口 / 尾点 / 大小写 */
export function normalizeExternalDomain(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '');
}

/** 两段标签且 TLD 在 gTLD 白名单内 */
export function isGtldRegistrable(domain: string): boolean {
  const labels = String(domain || '').split('.');
  return labels.length === 2
    && labels.every((l) => LABEL_RE.test(l))
    && GTLD_SET.has(labels[1]);
}

export type ExternalDomainVerdict = {
  ok: boolean;
  domain: string;
  reason: string;
};

/**
 * 完整准入校验。
 * @param isOwnRoot 该域名是否属于本站已生效后缀（由调用方用 matchRoot 判断）
 */
export function validateExternalDomain(raw: unknown, isOwnRoot = false): ExternalDomainVerdict {
  const domain = normalizeExternalDomain(raw);
  const bad = (reason: string): ExternalDomainVerdict => ({ ok: false, domain, reason });

  if (!domain) return bad('请填写你要接入的完整域名（如 xxx.com）');
  if (!DOMAIN_SHAPE_RE.test(domain)) return bad('域名格式不正确，请填写如 xxx.com 的完整域名');
  if (domain.includes('_')) return bad('域名不能包含下划线');

  const labels = domain.split('.');
  if (labels.length !== 2) {
    return bad('只允许注册局级别的完整域名（如 xxx.com），不接受子域名（如 xxx.example.com）');
  }
  if (!GTLD_SET.has(labels[1])) {
    return bad(`只允许通用顶级域（gTLD，如 .com / .net / .xyz / .top）；.${labels[1]} 不在受理范围（ccTLD 与其它后缀不受理）`);
  }
  if (RESERVED_REGISTRABLE.includes(domain)) {
    return bad('这是文档示例 / 保留域名，请填写你自己拥有的域名');
  }
  if (isOwnRoot) {
    return bad(`这是本站后缀 ${domain}，请到注册页申请子域名`);
  }
  return { ok: true, domain, reason: '' };
}

/** 给前端展示的接入说明（纯文案，不含密钥） */
export const EXTERNAL_FLOW_HINT = [
  '① 填写你自己的完整域名（只允许 gTLD 二级域，如 xxx.com；不接受 xxx.example.com 这类子域名）',
  `② 到域名注册商把 NS 改为 ${EXTERNAL_NS.join(' / ')}，并先在 s.eus 完成该域名的 DNS 托管`,
  '③ 点「用 API 连接」，站点会用 SEUS API 查到托管区域',
  '④ 站长在「站点设置 → 第三方域名接入」看到申请并批准后生效',
].join('\n');
