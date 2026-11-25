/**
 * 「暂停解析」与迁移提示（站点级配置，不做后台 UI）
 * ──────────────────────────────────────────────────────────────────────
 * 背景：meoy.top 正在迁移至 AnyNS。迁移期间该后缀下**所有**子域名的状态
 * 显示为「暂停解析」，控制台 / 域名详情顶部显示「meoy.top 正在迁移至 anyns」，
 * 普通用户暂时不能增删改 DNS 记录；管理员豁免，以便用 AnyNS 管理令牌
 * 给根域名 zone 补记录完成迁移。
 *
 * 为什么用「配置判定」而不是把 status 从 approved 改成新值：
 *   status 被公开统计、续期、配额、用户案例展示、域名详情加载等十几处
 *   用 `status === 'approved'` 判定，硬改会让 371 个域名从统计里凭空消失、
 *   续期被拒、展示失效。这里保留 status 不变，只在接口下发 dnsPaused，
 *   前端把「状态」渲染成「暂停解析」；写入闸门单独拦 DNS 编辑。
 *
 * 配置（都在 settings 表 / 环境变量，无需后台界面）：
 *   dns_paused_roots     逗号分隔的根域名，默认 'meoy.top'
 *   dns_migration_notice 提示文案，默认见 DEFAULT_MIGRATION_NOTICE
 * 迁移完成把 dns_paused_roots 清空即可一次性全部恢复，不用逐行改回。
 *
 * 读取走 settingsCache 的统一缓存，不新增逐 key 的 D1 查询。
 */
import { allSettings } from './settingsCache.js';

export const DNS_PAUSED_DEFAULT = 'meoy.top';
export const DEFAULT_MIGRATION_NOTICE = 'meoy.top 正在迁移至 anyns，期间该后缀下的域名暂停解析';
export const DNS_PAUSED_LABEL = '暂停解析';

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\.+$/, '');
}

/** 解析逗号 / 空白分隔的根域名列表 */
export function parsePausedRoots(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[,\s]+/)
    .map(norm)
    .filter(Boolean)
    .filter((d, i, a) => a.indexOf(d) === i);
}

/** 最长后缀匹配：a.b.meoy.top 在 meoy.top 与 b.meoy.top 同时配置时取后者 */
export function matchPausedRoot(fqdnOrRoot: string, roots: string[]): string {
  const d = norm(fqdnOrRoot);
  if (!d) return '';
  let best = '';
  for (const r of roots) {
    if (d === r || d.endsWith('.' + r)) {
      if (r.length > best.length) best = r;
    }
  }
  return best;
}

export type DnsPauseConfig = { roots: string[]; notice: string };

/** 一次读出配置（走统一 settings 缓存），列表页复用，零额外 D1 读取 */
export async function dnsPauseConfig(env: any): Promise<DnsPauseConfig> {
  let s: Map<string, string>;
  try { s = await allSettings(env); }
  catch { s = new Map(); }
  const raw = s.get('dns_paused_roots');
  const roots = parsePausedRoots(raw === undefined ? DNS_PAUSED_DEFAULT : raw);
  const notice = String(s.get('dns_migration_notice') || '').trim() || DEFAULT_MIGRATION_NOTICE;
  return { roots, notice };
}

/** 某条子域名当前是否暂停解析 */
export function dnsPausedFor(fqdnOrRoot: string, cfg: DnsPauseConfig): boolean {
  return !!matchPausedRoot(fqdnOrRoot, cfg.roots);
}

/** 给接口下发的字段（列表 shape / 详情 shape 复用） */
export function dnsPauseFields(fqdnOrRoot: string, cfg: DnsPauseConfig) {
  const paused = dnsPausedFor(fqdnOrRoot, cfg);
  return {
    dnsPaused: paused,
    dnsPausedRoot: paused ? matchPausedRoot(fqdnOrRoot, cfg.roots) : '',
    dnsPausedLabel: paused ? DNS_PAUSED_LABEL : '',
    statusLabel: paused ? DNS_PAUSED_LABEL : '',
  };
}

/** 写记录闸门：暂停解析期间普通用户禁止增删改，管理员豁免 */
export function dnsPauseBlockMessage(
  fqdnOrRoot: string,
  cfg: DnsPauseConfig,
  isAdmin: boolean
): string {
  if (isAdmin) return '';
  const root = matchPausedRoot(fqdnOrRoot, cfg.roots);
  if (!root) return '';
  return `${root} 正在迁移至 anyns，暂停解析期间暂不能修改 DNS 记录。${cfg.notice}`;
}
