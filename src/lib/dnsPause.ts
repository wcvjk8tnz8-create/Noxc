/**
 * 「暂停解析」与迁移提示（站点级配置；「站点设置 → AnyNS」同一张卡片可管理）
 * ──────────────────────────────────────────────────────────────────────
 * 背景：meoy.top 曾迁移至 AnyNS，期间该后缀下所有子域名显示「暂停解析」、
 * 普通用户暂时不能改 DNS 记录（管理员豁免以便补迁移记录）。
 * **迁移已完成**：默认不再暂停任何根域名，也不再显示迁移提示。
 * 这套机制保留为通用维护开关 —— 以后要临时冻结某个后缀，在
 * 「站点设置 → AnyNS」填 dns_paused_roots 即可，清空即一次性恢复。
 *
 * 为什么用「配置判定」而不是把 status 从 approved 改成新值：
 *   status 被公开统计、续期、配额、用户案例展示、域名详情加载等十几处
 *   用 `status === 'approved'` 判定，硬改会让 371 个域名从统计里凭空消失、
 *   续期被拒、展示失效。这里保留 status 不变，只在接口下发 dnsPaused，
 *   前端把「状态」渲染成「暂停解析」；写入闸门单独拦 DNS 编辑。
 *
 * 配置（都在 settings 表 / 环境变量，后台「站点设置 → AnyNS」也能改）：
 *   dns_paused_roots     逗号分隔的根域名，**默认空**（迁移完成，解析正常）
 *   dns_migration_notice 提示文案，**默认空**；只有名单非空时前端才显示
 * 把 dns_paused_roots 清空即可一次性全部恢复，不用逐行改回。
 *
 * 读取走 settingsCache 的统一缓存，不新增逐 key 的 D1 查询。
 */
import { allSettings } from './settingsCache.js';

/* 迁移已完成：两个默认值都为空，避免新部署 / 老库没跑迁移时又默认冻结解析。
   旧备份里的迁移期文案仍可被管理员手动填回，但代码不再主动下发。 */
export const DNS_PAUSED_DEFAULT = '';
export const DEFAULT_MIGRATION_NOTICE = '';
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
  // 不再 fallback 到迁移期默认文案：名单为空时提示条本来就不渲染，
  // 名单非空但没填文案时也老实留空，不把过期的「正在迁移」硬塞给用户。
  const notice = String(s.get('dns_migration_notice') || '').trim();
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
  return `${root} 暂停解析期间暂不能修改 DNS 记录。${cfg.notice}`.trim();
}
