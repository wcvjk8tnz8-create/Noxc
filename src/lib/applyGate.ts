/**
 * 子域名申请开关（全局 + 按根域名）
 *
 * 管理员可在后台「站点设置」暂停新申请（例如维护、配额耗尽、被滥用时），
 * 也可以**只暂停某一个后缀**，其余后缀照常开放。
 *
 * 暂停只影响「新建子域名」这一个动作，不影响：
 *   · 已注册域名的 DNS 记录增删改、续期、转移、展示、解绑
 *   · 该后缀的 WHOIS 查询（仍可查，只是不再出现「立即注册」）
 *   · 签到、兑换、聊天地等其它功能
 *   · 管理员自建域名（管理员是「开通」而非「申请」，仍可操作）
 *
 * 存 settings 表：
 *   apply_paused          = '1' / '0'（全局）
 *   apply_paused_message  = 自定义提示语（可空，全局与按后缀共用）
 *   root_apply_paused     = 逗号分隔的根域名，如 'meoy.top,v-1.top'
 * 环境变量 APPLY_PAUSED / ROOT_APPLY_PAUSED 可强制开启（后台不可关）。
 */
import { pickSettings } from './settingsCache.js';

const DEFAULT_MESSAGE = '站点已暂停新域名申请，请稍后再试。已注册的域名不受影响。';

/** 逗号分隔 → 规范化小写、去尾点、去重、丢弃空项 */
export function parsePausedRoots(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of String(raw ?? '').split(',')) {
    const d = part.trim().toLowerCase().replace(/\.+$/, '');
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

export function serializePausedRoots(list: unknown): string {
  if (!Array.isArray(list)) return '';
  return parsePausedRoots(list.join(',')).join(',');
}

/** 按后缀暂停时给普通用户的提示语：管理员自定义文案优先 */
export function rootApplyMessage(root: string, custom?: string): string {
  const d = String(root || '').trim().toLowerCase().replace(/\.+$/, '');
  const msg = String(custom || '').trim();
  if (msg && msg !== DEFAULT_MESSAGE) return msg.slice(0, 200);
  return `后缀 .${d} 已暂停新域名申请，请稍后再试。已注册的域名不受影响。`;
}

export function isRootApplyPaused(gate: { pausedRoots?: string[] }, root: string): boolean {
  const d = String(root || '').trim().toLowerCase().replace(/\.+$/, '');
  return !!d && Array.isArray(gate?.pausedRoots) && gate.pausedRoots.includes(d);
}

export async function applyGate(env) {
  try {
    const s = await pickSettings(env, ['apply_paused','apply_paused_message','root_apply_paused']);
    const envPaused = String(env.APPLY_PAUSED || '').trim() === '1';
    const envRoots = parsePausedRoots(env.ROOT_APPLY_PAUSED || '');
    return {
      paused: envPaused || String(s.apply_paused || '').trim() === '1',
      message: String(s.apply_paused_message || '').trim().slice(0, 200) || DEFAULT_MESSAGE,
      // 环境变量与后台设置取并集：后台清空也关不掉环境变量强制暂停的后缀
      pausedRoots: parsePausedRoots([...envRoots, ...parsePausedRoots(s.root_apply_paused)].join(',')),
      rootPausedFromEnv: envRoots.length > 0,
    };
  } catch {
    /* settings 表尚未建立：降级为「未暂停」，不阻断站点 */
    return {
      paused: String(env.APPLY_PAUSED || '').trim() === '1',
      message: DEFAULT_MESSAGE,
      pausedRoots: parsePausedRoots(env.ROOT_APPLY_PAUSED || ''),
      rootPausedFromEnv: false,
    };
  }
}

export { DEFAULT_MESSAGE };
