/**
 * 运行时补列 · 跨 isolate 全局幂等
 *
 * 旧写法：ensureCoreColumns / ensureOauthTables 各用模块级布尔缓存，
 * Cloudflare 每次冷启动都是新 isolate → 每个 isolate 首次请求都跑一遍
 * PRAGMA table_info + 一次**全表 UPDATE**（回填 root_domain）。高并发 /
 * 多地区冷启动时，这就是一笔看不见的巨额 rows read。
 *
 * 现在用 settings 表里一行 marker 做跨 isolate 幂等：
 *   - 新 isolate 首次请求只读 1 行 marker，命中即整个跳过
 *   - 只有 marker 不存在（老库首次升级）才跑补列，跑完写 marker
 *   - 回填 UPDATE 只在「真的新增了 root_domain 列」时执行，正常库零全表扫描
 *
 * 表还没建 / D1 抖动时静默降级，不阻断任何请求。
 */
import { readSettingFresh } from './settingsCache.js';
import { ensureCoreColumns } from './showcase.js';
import { ensureOauthTables } from './oauthStore.js';

const MARKER_KEY = 'runtime_migrations_v3';
let localChecked = false;

export async function ensureMigrations(env: any): Promise<void> {
  if (localChecked) return;
  try {
    const hit = await readSettingFresh(env, MARKER_KEY);
    if (String(hit || '').trim() === '1') {
      localChecked = true;
      return;
    }
  } catch { /* 表未建：继续尝试补列 */ }

  // 老库首次升级：补列 + 建表。内部各自有模块级缓存，重复调用不会重跑。
  await ensureCoreColumns(env);
  await ensureOauthTables(env);

  try {
    await env.DB.prepare(
      "INSERT INTO settings(key, value) VALUES (?, '1') " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind(MARKER_KEY).run();
    localChecked = true;
  } catch { /* 写 marker 失败：下个 isolate 会重试，不影响站点 */ }
}

/** 仅供回归：模拟冷启动 isolate */
export function __resetMigrationsForTest(): void { localChecked = false; }
