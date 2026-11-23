// ============================================================
//  域名有效期 / 续期
//  - 新申请的域名：默认 365 天（后台「站点设置 → 域名有效期」可改）
//  - 迁移前已注册（approved）的域名：设为永久，不追溯
//  - 续期窗口：有效期剩余「少于一半」即可续期（validDays / 2，向下取整）
//    管理员仍可在后台显式填天数覆盖；留空 = 自动跟随有效期一半。
//  - 每次续期顺延一个完整周期
// ============================================================

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_VALID_DAYS = 365;
/** 续期窗口占有效期的比例：少于一半即可续期 */
import { allSettings } from './settingsCache.js';
export const RENEW_HALF_RATIO = 0.5;

/**
 * 计算生效的续期窗口（天）。
 * @param validDays 新域名有效期（天）
 * @param override  后台显式配置的 renew_window_days；undefined / null / 空串 / 非法值 = 自动
 *
 * 自动口径：floor(validDays / 2)，至少 1 天。
 * 365 → 182（少于 182.5，正好「剩余不足一半」）；90 → 45；管理员改有效期后窗口自动跟着变。
 */
export function renewalWindowDays(validDays, override) {
  const n = Number(validDays);
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_VALID_DAYS;
  const raw = override === undefined || override === null || String(override).trim() === ''
    ? NaN : Number(override);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return Math.max(1, Math.floor(v * RENEW_HALF_RATIO));
}

/** 读取有效期相关规则（站点设置可改） */
export async function expiryRules(env) {
  const all = await allSettings(env);
  const get = (k, d) => {
    const v = String(all.get(k) ?? '').trim();
    return v === '' ? d : Number(v);
  };
  const years = Number(await get('domain_valid_days', DEFAULT_VALID_DAYS));
  const validDays = Number.isFinite(years) && years > 0 ? Math.floor(years) : DEFAULT_VALID_DAYS;
  const rawWindow = await get('renew_window_days', '');
  const auto = rawWindow === '' || rawWindow === undefined || rawWindow === null
    || !Number.isFinite(Number(rawWindow)) || Number(rawWindow) < 0;
  return {
    validDays,
    renewWindowDays: auto ? renewalWindowDays(validDays, null) : Math.floor(Number(rawWindow)),
    /** true = 窗口按有效期一半自动推算，后台输入框应留空 */
    renewWindowAuto: auto,
  };
}

/** 首页后缀卡 / 注册须知的统一文案（数字随站点设置变，不再写死 365 / 180） */
export function expiryTipText(rules) {
  const v = Number(rules?.validDays);
  const valid = Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_VALID_DAYS;
  const w = renewalWindowDays(valid, rules?.renewWindowDays);
  return `单次注册 ${valid} 天，到期前 ${w} 天可续期`;
}

/** 计算到期时间；perpetual 或 validDays<=0 返回 null（永久） */
export function computeExpiry({ perpetual = false, validDays = DEFAULT_VALID_DAYS, from = Date.now() } = {}) {
  if (perpetual || !(validDays > 0)) return null;
  return from + validDays * DAY;
}

/**
 * 域名有效期状态
 * @returns { expired, willExpire, canRenew, daysLeft, expiresAt, perpetual }
 * canRenew：剩余天数落到续期窗口内（默认 = 有效期的一半）即可续期。
 */
export function expiryState(row, { renewWindowDays = renewalWindowDays(DEFAULT_VALID_DAYS, null), now = Date.now() } = {}) {
  const perpetual = Number(row?.perpetual) === 1 || !row?.expires_at;
  const expiresAt = row?.expires_at ? Number(row.expires_at) : null;
  if (perpetual || !expiresAt) {
    return { expired: false, willExpire: false, canRenew: false, daysLeft: null, expiresAt: null, perpetual: true };
  }
  const left = expiresAt - now;
  const daysLeft = Math.ceil(left / DAY);
  const inWindow = left > 0 && left <= Number(renewWindowDays) * DAY;
  return {
    expired: left <= 0,
    willExpire: inWindow,
    canRenew: inWindow,
    daysLeft: Math.max(0, daysLeft),
    expiresAt,
    perpetual: false,
  };
}

/** 续期：在可续窗口内把到期时间往后推一个周期 */
export function renewExpiry(row, { validDays = DEFAULT_VALID_DAYS, now = Date.now() } = {}) {
  if (Number(row?.perpetual) === 1) return { ok: false, message: '该域名为永久有效，无需续期' };
  const base = Number(row?.expires_at) || now;
  // 已过期则从现在起算，未过期则在原到期时间上顺延
  const from = base > now ? base : now;
  return { ok: true, expiresAt: from + validDays * DAY };
}

/**
 * 旧库列补齐：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，
 * 因此对 2024 之前建的库需要 ALTER TABLE ADD COLUMN。
 * 幂等 —— 先 PRAGMA table_info 检测，已存在则跳过。
 */
let colsChecked = false;
export async function ensureExpiryColumns(env) {
  if (colsChecked) return;
  try {
    const info = await env.DB.prepare('PRAGMA table_info(subdomains)').all();
    const have = new Set((info?.results || []).map((r) => String(r.name)));
    const add = async (col, ddl) => {
      if (have.has(col)) return;
      await env.DB.prepare(`ALTER TABLE subdomains ADD COLUMN ${col} ${ddl}`).run();
    };
    await add('expires_at', 'INTEGER');
    await add('renewed_at', 'INTEGER');
    await add('perpetual', 'INTEGER NOT NULL DEFAULT 0');
    colsChecked = true;
  } catch { /* 表不存在或其它异常：交由建表流程处理 */ }
}

/**
 * 一次性迁移：把迁移前已 approved 的域名设为永久。
 * 幂等 —— migrations 表记录已执行，重复调用不会覆盖后续管理操作。
 */
export async function migrateLegacyPerpetual(env) {
  try {
    await ensureExpiryColumns(env);
    const m = await env.DB.prepare("SELECT applied_at FROM migrations WHERE name = 'legacy_perpetual'").first();
    if (m && Number(m.applied_at) > 0) return { applied: false };
    const r = await env.DB
      .prepare("UPDATE subdomains SET perpetual = 1, expires_at = NULL WHERE status = 'approved' AND (perpetual IS NULL OR perpetual = 0)")
      .run();
    await env.DB
      .prepare("UPDATE migrations SET applied_at = ? WHERE name = 'legacy_perpetual'")
      .bind(Date.now())
      .run();
    return { applied: true, rows: r?.meta?.changes ?? 0 };
  } catch { return { applied: false }; }
}
