/**
 * TerraDomain · 系统保留子域名（单一真源）
 *
 * 以前保留名单只写在 wrangler.toml 的 RESERVED_LABELS 里，并且被
 * src/routes/subdomains.ts 复制粘贴了两份解析代码。问题有三：
 *   1) CI 的「注入配置」会用 GitHub Variable 覆盖同名字段，Variable 只填
 *      几个词时，整份基线名单会被冲掉；
 *   2) 两处解析各自为政，改一处漏一处就会出现「/check 说可注册、提交却被拒」；
 *   3) 后台没有入口，加一个保留词要改代码 + 重新部署。
 *
 * 现在：BASE_RESERVED_LABELS 是代码级基线（永远生效，
 * 不依赖环境变量是否被覆盖），env.RESERVED_LABELS 与后台
 * settings.reserved_labels 都只做「追加」，最终由 reservedLabelsOf
 * 合并去重。/check、真正提交、WHOIS 共用同一份结果。
 *
 * 语义：普通用户不可申请；管理员仍可自建（后台是「开通」而非「申请」）。
 */

/** 站点自身功能 / 基础设施占用；ai / dash / nic 为官方用途预留 */
export const BASE_RESERVED_LABELS: readonly string[] = [
  'www', 'ns1', 'ns2', 'ns3', 'ns4', 'mail', 'admin', 'api', 'cdn', 'ftp',
  'smtp', 'pop', 'imap', 'mx', 'test', 'blog', 'shop', 'app', 'dns', 'dns1',
  'dns2', 'root', 'support', 'help', 'docs', 'status', 'panel', 'cloud',
  'dev', 'git', 'ssh', 'mysql', 'db', 'web', 'forum', 'bbs', 'home',
  'search', 'whois', 'dnshe', 'anyns', 'ns', 'cdn1', 'cname', 'static',
  'assets', 'img', 'image', 'img1', 'cdn2', 'img2',
  // 官方用途：AI 服务 / 控制台 / 注册局入口
  'ai', 'dash', 'nic',
];

/** 与 validateLabel() 同口径：小写字母数字、可含中间连字符、1–63 位 */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** 逗号 / 空白 / 中文逗号分号都可分隔；非法项直接丢弃，不抛错 */
export function parseReservedList(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[\s,，;；]+/)
    .map((s) => s.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter((s) => LABEL_RE.test(s));
}

/**
 * 后台「额外保留域名」存库前的清洗：
 * 去掉基线已有项（存了也没意义）、去重、上限 200 个。
 */
export function normalizeReservedExtra(raw: unknown): string {
  const base = new Set(BASE_RESERVED_LABELS);
  const extra = new Set(parseReservedList(raw).filter((l) => !base.has(l)));
  return [...extra].slice(0, 200).join(',');
}

/**
 * 当前生效的完整保留名单。
 * 每次调用读一次 settings（D1 单行查询）；老库 / 本地 mock 读失败时
 * 静默回落到基线，绝不因为配置缺失把保留域名放出去。
 */
export async function reservedLabelsOf(env: any): Promise<Set<string>> {
  const out = new Set<string>(BASE_RESERVED_LABELS);
  for (const l of parseReservedList(env?.RESERVED_LABELS)) out.add(l);
  try {
    const row: any = await env?.DB
      ?.prepare("SELECT value FROM settings WHERE key = 'reserved_labels'")
      ?.first();
    for (const l of parseReservedList(row?.value)) out.add(l);
  } catch { /* 表不存在 / 本地 mock：基线仍生效 */ }
  return out;
}

/** 后台展示用：基线、额外、最终合并后的清单 */
export async function reservedOverview(env: any) {
  const set = await reservedLabelsOf(env);
  const base = new Set(BASE_RESERVED_LABELS);
  return {
    base: [...base],
    extra: [...set].filter((l) => !base.has(l)),
    effective: [...set],
  };
}
