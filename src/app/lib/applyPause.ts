/**
 * 前端「提交注册」硬锁 · 唯一来源
 *
 * 用户要求：按后缀暂停申请后，**一定要无法点击提交注册**。
 * 以前只靠 legacy 里一个 APPLY_PAUSED 缓存变量 + btn.disabled=true，
 * 但 React 的滑块验证回调 onCapPass 会无条件 `btn.disabled = false`
 * 把按钮重新启用（弹窗模式「按钮不再被票据锁死」），暂停锁就这么被冲掉。
 * 于是用户仍能点提交、过滑块、发请求，只是最后收到后端 403。
 *
 * 这里把「当前后缀是否暂停」和「按钮能不能解锁」收敛成纯函数，
 * legacy 控制器与 React 注册页共用同一份判定，任何回调想启用按钮
 * 都必须经过 unlockApplyButton(el, allowed)，allowed=false 绝不解锁。
 */

const DEFAULT_MESSAGE = '站点已暂停新域名申请，请稍后再试。已注册的域名不受影响。';

export interface ApplyPauseConfig {
  applyPaused?: boolean;
  applyPausedMessage?: string;
  pausedRoots?: unknown;
}

let globalPaused = false;
let customMessage = '';
let pausedRoots: string[] = [];

export function normalizeRoot(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\.+$/, '');
}

function parseRoots(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  for (const p of parts) {
    const d = normalizeRoot(p);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

/** 由 /api/config 配置；名单与后端 applyGate 同源（环境变量已并入） */
export function configureApplyPause(cfg: ApplyPauseConfig): void {
  globalPaused = !!cfg?.applyPaused;
  customMessage = String(cfg?.applyPausedMessage || '').trim();
  pausedRoots = parseRoots(cfg?.pausedRoots);
}

/** 当前选中的后缀是否禁止提交注册（全局暂停 ∪ 该后缀单独暂停） */
export function isApplyPausedFor(root: unknown): boolean {
  if (globalPaused) return true;
  const d = normalizeRoot(root);
  return !!d && pausedRoots.includes(d);
}

/** 站点主推后缀：首页 i===0 标「首推」的那个（preferNoxc 的口径） */
export const PRIMARY_ROOT = 'noxc.uk';

/**
 * 可申请后缀列表（首页卡片 / 查询下拉 / 落地页 CTA）：归一化、去重、
 * **剔除被暂停申请的根域名**。不传 pausedRoots 时用 configureApplyPause
 * 里的同一份状态（前后端同口径）。这只管「去哪申请」，不代表后缀不存在。
 */
export function availableRoots(list: unknown, pausedRootsOverride?: unknown): string[] {
  const paused = new Set(
    pausedRootsOverride === undefined ? pausedRoots : parseRoots(pausedRootsOverride)
  );
  const parts = Array.isArray(list) ? list : String(list ?? '').split(',');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const d = normalizeRoot(p);
    if (!d || seen.has(d) || paused.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

/** 主推域名：优先 PRIMARY_ROOT（若仍在开放列表），否则第一个开放后缀；全暂停返回 '' */
export function preferredRoot(list: unknown, pausedRootsOverride?: unknown): string {
  const open = availableRoots(list, pausedRootsOverride);
  return open.find((d) => d === PRIMARY_ROOT) || open[0] || '';
}

/** 主推优先排序：过滤暂停项后把 PRIMARY_ROOT 放到第一位（首页「首推」徽标据此） */
export function sortPreferred(list: unknown, pausedRootsOverride?: unknown): string[] {
  const open = availableRoots(list, pausedRootsOverride);
  return [...open].sort((a, b) =>
    (b === PRIMARY_ROOT ? 1 : 0) - (a === PRIMARY_ROOT ? 1 : 0));
}

/**
 * 注册页后缀选择器专用：归一化、去重、主推优先排序，但**保留暂停项**。
 *
 * 「暂停申请」不等于「后缀不存在」——它仍是站点后缀，可能已有几百个已开通
 * 域名，首页统计展开照常列出。所以在选择器里要看得见、灰掉、点不动：
 * 渲染时给 data-paused="1" + disabled，CSS 灰度且 pointer-events:none。
 * 自动切换 / 默认值一律取 preferredRoot()（只认开放后缀），不会落到暂停项。
 */
export function rootsForPicker(list: unknown): string[] {
  const parts = Array.isArray(list) ? list : String(list ?? '').split(',');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const d = normalizeRoot(p);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out.sort((a, b) =>
    (b === PRIMARY_ROOT ? 1 : 0) - (a === PRIMARY_ROOT ? 1 : 0));
}

export function applyPausedMessageFor(root: unknown, lang: 'zh' | 'en' = 'zh'): string {
  if (!isApplyPausedFor(root)) return '';
  const d = normalizeRoot(root);
  if (globalPaused) {
    if (customMessage && customMessage !== DEFAULT_MESSAGE) return customMessage.slice(0, 200);
    return lang === 'en'
      ? 'New domain applications are paused site-wide. Please try again later; existing domains are unaffected.'
      : DEFAULT_MESSAGE;
  }
  if (customMessage && customMessage !== DEFAULT_MESSAGE) return customMessage.slice(0, 200);
  return lang === 'en'
    ? `Applications for .${d} are paused. Please try again later; existing domains are unaffected.`
    : `后缀 .${d} 已暂停新域名申请，请稍后再试。已注册的域名不受影响。`;
}

/** 按钮锁的唯一写入口：任何路径想启用按钮都必须传 allowed=true */
export function applyPauseLock(root: unknown, lang: 'zh' | 'en' = 'zh') {
  const paused = isApplyPausedFor(root);
  return { paused, message: paused ? applyPausedMessageFor(root, lang) : '' };
}

/**
 * 硬锁：disabled + aria-disabled + data 标记 + CSS class。
 * CSS 里 .is-apply-paused / [data-apply-paused="1"] 带 pointer-events:none，
 * 即使旧缓存的 JS 没把 disabled 写上也点不动。
 */
export function lockApplyButton(el: any): void {
  if (!el) return;
  el.disabled = true;
  try {
    el.setAttribute?.('aria-disabled', 'true');
    el.setAttribute?.('data-apply-paused', '1');
    el.classList?.add?.('is-apply-paused');
  } catch { /* 极简 DOM mock 也能用 */ }
}

/** allowed=false 时保持锁，绝不重新启用 —— onCapPass 也必须走这里 */
export function unlockApplyButton(el: any, allowed: boolean): void {
  if (!el || !allowed) return;
  el.disabled = false;
  try {
    el.removeAttribute?.('aria-disabled');
    el.removeAttribute?.('data-apply-paused');
    el.classList?.remove?.('is-apply-paused');
    if (el.textContent !== undefined) el.textContent = '提交注册';
  } catch { /* 极简 DOM mock 也能用 */ }
}

export { DEFAULT_MESSAGE };
