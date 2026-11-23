/**
 * settings 统一读取层 · 减少 D1 rows read（2026-11-23 第二轮优化）
 *
 * 事故复盘：第一轮只压住了 /api/config 和公开统计的放大器，但漏了中间件层 ——
 * `app.use('*')` 的 mergeRootEnv 对**每一个请求**（包括 /assets/*.js、/img/*、
 * SPA HTML、/docs/*）都跑 4 次 settings 单点 SELECT，buildConfigData 内部又散着
 * 十几个单点 SELECT。静态资源请求量最大，于是请求数 × 查询数线性吃掉配额。
 *
 * 这里做唯一配置读取入口：
 *   1) 一次 `SELECT key, value FROM settings` 拿全表（表只有几十行）
 *   2) 按 D1 binding 做 isolate 内缓存 30 秒，命中后所有单点读取 0 次 D1
 *   3) 任何写操作成功后 invalidateSettings() 统一失效（已有中间件覆盖全部写路径）
 *   4) 后台保存后带 ?_= 的请求强制 fresh，保证「保存即生效」跨 isolate 也不卡
 *
 * 为什么用 WeakMap(env.DB) 而不是模块级单例：同一 isolate 内 D1 binding 是同一个
 * 对象，缓存照常命中；不同 D1 实例（多环境 / 回归里每次新建的内存库）自动隔离，
 * 不会把上一个环境的配置串到下一个。
 *
 * 安全：整张表只在 Worker 内存里，绝不整体回传浏览器；/api/config 仍按白名单
 * 挑字段。凭据类读取（OAuth secret / 邮件 key）用 readSettingFresh 直查 D1，
 * 避免管理员改密钥后最多 30 秒旧值仍在本 isolate 生效。
 *
 * 降级：settings 表未建 / D1 抖动时返回空 Map，各调用点回落环境变量或内置默认，
 * 与优化前行为一致，不会让站点挂掉。
 */
export const SETTINGS_TTL = 30_000;

type Cache = { at: number; map: Map<string, string> };
let caches = new WeakMap<object, Cache>();
let inflight = new WeakMap<object, Promise<Map<string, string>>>();
const FALLBACK_KEY = {} as object;

function cacheKey(env: any): object {
  const db = env?.DB;
  return db && typeof db === 'object' ? (db as object) : FALLBACK_KEY;
}

/** 强制重读（后台保存后 ?_= 刷新用） */
export async function allSettings(env: any, fresh = false): Promise<Map<string, string>> {
  const key = cacheKey(env);
  const hit = fresh ? undefined : caches.get(key);
  if (hit && Date.now() - hit.at < SETTINGS_TTL) return hit.map;

  /* 并发击穿防护：loadExtra 用 Promise.all 同时读 4 个 key，缓存还没落盘时
     四个调用会各自发一次全表查询。同一个 binding 的并发请求共用这个 promise。 */
  const pending = fresh ? undefined : inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const map = new Map<string, string>();
    try {
      const r: any = await env?.DB?.prepare('SELECT key, value FROM settings').all();
      for (const row of r?.results || []) map.set(String(row.key), String(row.value ?? ''));
    } catch { /* 表未建 / D1 抖动：空 Map，调用点回落默认 */ }
    caches.set(key, { at: Date.now(), map });
    return map;
  })();

  inflight.set(key, task);
  try { return await task; }
  finally { inflight.delete(key); }
}

/** 单点读取：替代散落各模块的 `SELECT value FROM settings WHERE key = ?` */
export async function readSetting(env: any, key: string): Promise<string | undefined> {
  const m = await allSettings(env);
  return m.has(key) ? m.get(key) : undefined;
}

/** 凭据类读取：不走缓存，管理员改密钥立即生效 */
export async function readSettingFresh(env: any, key: string): Promise<string | undefined> {
  try {
    const row: any = await env?.DB?.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).bind(key).first();
    return row ? String(row.value ?? '') : undefined;
  } catch { return undefined; }
}

/** 批量挑 key：兼容原来 `SELECT ... WHERE key IN (...)` 的写法 */
export async function pickSettings(env: any, keys: readonly string[]): Promise<Record<string, string>> {
  const m = await allSettings(env);
  const out: Record<string, string> = {};
  for (const k of keys) if (m.has(k)) out[k] = m.get(k) as string;
  return out;
}

/** 写路径统一失效：清空所有 binding 的缓存与在途请求 */
export function invalidateSettings(): void {
  caches = new WeakMap<object, Cache>();
  inflight = new WeakMap<object, Promise<Map<string, string>>>();
}
