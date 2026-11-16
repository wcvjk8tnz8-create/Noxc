/**
 * 统一响应 / 小工具（TypeScript 版）
 *
 * 这是渐进式迁移的第一块：存量 .js 仍然 import './util.js'，
 * 两者导出同名函数，互不冲突。新代码请 import './util.ts'。
 */
import type { Context } from 'hono';
import type { Env } from '../types.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { localize } from './i18nServer.js';

/**
 * 统一响应出口做语言本地化：前端带 X-Lang: en 时，把服务端生成的中文文案
 * （message / 通知 / 条款段落 / AI 诊断行 / 状态词）换成英文。
 * 只精确命中词典，绝不改写用户数据，详见 i18nServer.ts。
 * 中文模式下 localize 直接原样返回，零额外开销。
 */
/** 成功响应 */
export function ok<T extends Record<string, unknown>>(
  c: Context<{ Bindings: Env }>,
  data: T = {} as T,
  status: ContentfulStatusCode = 200
) {
  return c.json(localize(c, { success: true, ...data }), status);
}

/** 失败响应 */
export function fail(
  c: Context<{ Bindings: Env }>,
  message: string,
  status: ContentfulStatusCode = 400,
  extra: Record<string, unknown> = {}
) {
  return c.json(localize(c, { success: false, message, ...extra }), status);
}

/** 当前毫秒时间戳 */
export function now(): number {
  return Date.now();
}

/** 客户端 IP（Cloudflare 优先，回落 XFF） */
export function clientIp(c: Context<{ Bindings: Env }>): string {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
}

/**
 * 审计日志。
 * 刻意吞掉异常 —— 审计写失败不应该影响主流程。
 */
export async function audit(
  c: Context<{ Bindings: Env }>,
  userId: number | null | undefined,
  action: string,
  target: string | number = '',
  detail = ''
): Promise<void> {
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (user_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?)'
    )
      .bind(
        userId ?? null,
        action,
        String(target || '').slice(0, 200),
        String(detail || '').slice(0, 1000),
        clientIp(c),
        now()
      )
      .run();
  } catch {
    /* 审计失败不影响主流程 */
  }
}

/**
 * 解析「新用户默认配额」：-1 = 不限量，0..10000 = 具体额度。
 * 空值（undefined / null / 空白串）与脏值一律回落 fallback；空串绝不解释成 0
 * （0 = 禁止申请，曾因 Number('') === 0 把「清空配置」误当成全员禁申）。
 * 注册路由与后台设置共用，避免两处口径不一致（曾出现后台能改、注册仍写死 5）。
 */
export function parseDefaultQuota(raw: unknown, fallback: unknown = 5): number {
  const v = validQuota(raw);
  if (v !== null) return v;
  const f = validQuota(fallback);
  return f === null ? 5 : f;
}

/** 合法配额返回整数，否则返回 null，供后台设置 / 环境变量逐级回落 */
function validQuota(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= -1 && i <= 10000 ? i : null;
}

/** 读取生效的默认配额：后台设置 > 环境变量 DEFAULT_QUOTA > 内置 5 */
export async function defaultQuotaOf(env: any): Promise<number> {
  let raw: unknown;
  try {
    const row: any = await env.DB.prepare("SELECT value FROM settings WHERE key = 'default_quota'").first();
    raw = row?.value;
  } catch { /* 老库还没跑迁移：回落环境变量 */ }
  const fromDb = validQuota(raw);
  if (fromDb !== null) return fromDb;
  return parseDefaultQuota(env.DEFAULT_QUOTA);
}
