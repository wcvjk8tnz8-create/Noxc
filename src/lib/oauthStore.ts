/**
 * OAuth 相关表的运行时准备（幂等，模块级缓存）
 *
 * 旧库里 oauth_bindings 没有 access_token 列、也没有 root_reg_counts 表。
 * schema.sql 每次部署都会跑，但 CREATE TABLE IF NOT EXISTS 不会给已有表加列，
 * 所以这里按 PRAGMA 逐列 ALTER + CREATE TABLE IF NOT EXISTS 补齐。
 * 与 showcase.ts 的 ensureCoreColumns 同套路：绝不 RENAME / DROP 业务表。
 */
let checked = false;

export async function ensureOauthTables(env: any): Promise<void> {
  if (checked) return;
  const db = env?.DB;
  if (!db) return;
  try {
    const info: any = await db.prepare('PRAGMA table_info(oauth_bindings)').all();
    const have = new Set((info?.results || []).map((r: any) => String(r.name)));
    if (!have.has('access_token')) {
      await db.prepare('ALTER TABLE oauth_bindings ADD COLUMN access_token TEXT').run();
    }
    /* 每根域名「每人累计注册次数」：与 subdomains 解耦，释放域名不退还次数。
       记录从本功能启用后开始累计，历史申请不回溯 —— 已注册用户不受影响。 */
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS root_reg_counts (
        user_id     INTEGER NOT NULL,
        root_domain TEXT    NOT NULL,
        count       INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (user_id, root_domain)
      )
    `).run();
    checked = true;
  } catch {
    /* 表不存在 / D1 抖动：功能降级为不限制，不影响站点其它部分 */
  }
}
