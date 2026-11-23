/**
 * Noxc · 用户案例展示（Showcase）
 *
 * 只展示「用户主动开启」且已开通、账号未被封禁的域名。
 * 默认不展示：subdomains.showcase 默认 0，必须到域名详情页自行开启。
 * 字段存在旧库时由 PRAGMA + ALTER 补齐（SQLite 无 ADD COLUMN IF NOT EXISTS）。
 */

let colsChecked = false;

/**
 * 老库补列（一次性，模块级缓存）。
 *
 * 早期版本靠 schema.sql 里的「重建表」迁移补 root_domain，那段迁移每次部署
 * 都会重跑并把 showcase_* 四列清空。现在改为在 Worker 首次请求时按 PRAGMA
 * 逐列 ALTER，业务表永远不被重建，用户设置的展示开关得以持久化。
 * 补完顺手把历史行的 root_domain 从 fqdn 反推回填（幂等，只填空值）。
 */
export async function ensureCoreColumns(env: any): Promise<void> {
  if (colsChecked) return;
  try {
    const info: any = await env.DB.prepare('PRAGMA table_info(subdomains)').all();
    const have = new Set((info?.results || []).map((r: any) => String(r.name)));
    const added: string[] = [];
    const add = async (col: string, ddl: string) => {
      if (have.has(col)) return;
      await env.DB.prepare(`ALTER TABLE subdomains ADD COLUMN ${col} ${ddl}`).run();
      added.push(col);
    };
    await add('root_domain', "TEXT NOT NULL DEFAULT ''");
    await add('showcase', 'INTEGER NOT NULL DEFAULT 0');
    await add('showcase_title', 'TEXT');
    await add('showcase_desc', 'TEXT');
    await add('showcase_emoji', 'TEXT');
    /* 回填是一次全表扫描。只在「老库真的刚补出 root_domain 列」时跑：
       正常库列早已存在，这里必须 0 次 D1 写入/扫描，否则每个新 isolate
       冷启动都会白扫一遍全表（第二轮 D1 读取优化）。 */
    if (added.includes('root_domain')) {
      await env.DB.prepare(
        `UPDATE subdomains SET root_domain =
           CASE WHEN instr(fqdn, '.') > 0 THEN substr(fqdn, instr(fqdn, '.') + 1) ELSE '' END
         WHERE root_domain IS NULL OR root_domain = ''`
      ).run().catch(() => null);
    }
    colsChecked = true;
  } catch { /* 表不存在 / D1 抖动：公开页降级为空列表，不影响站点 */ }
}

/** 兼容旧调用点 */
export const ensureShowcaseColumns = ensureCoreColumns;

export type ShowcaseItem = {
  fqdn: string;
  label: string;
  emoji: string;
  title: string;
  owner: string;
  desc: string;
};

/** 公开列表：不含邮箱、user_id、审核备注等任何非展示信息 */
export async function showcaseItems(env: any): Promise<ShowcaseItem[]> {
  await ensureCoreColumns(env);
  const sql = `
    SELECT s.fqdn, s.label, s.showcase_title, s.showcase_desc, s.showcase_emoji,
           COALESCE(p.nickname, '') AS nickname, u.email AS email
    FROM subdomains s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN user_profiles p ON p.user_id = u.id
    WHERE s.showcase = 1 AND s.status = 'approved' AND u.status <> 'banned'
    ORDER BY s.created_at DESC
    LIMIT 120`;
  let rows: any[] = [];
  try {
    const r: any = await env.DB.prepare(sql).all();
    rows = r?.results || [];
  } catch {
    // user_profiles 尚未建立时降级：不连接表，站长名用邮箱前缀
    try {
      const r: any = await env.DB.prepare(`
        SELECT s.fqdn, s.label, s.showcase_title, s.showcase_desc, s.showcase_emoji, u.email AS email
        FROM subdomains s JOIN users u ON u.id = s.user_id
        WHERE s.showcase = 1 AND s.status = 'approved' AND u.status <> 'banned'
        ORDER BY s.created_at DESC LIMIT 120`).all();
      rows = (r?.results || []).map((x: any) => ({ ...x, nickname: '' }));
    } catch { return []; }
  }
  return rows.map((r: any) => {
    const owner = String(r.nickname || '').trim() ||
      String(r.email || '').split('@')[0] || 'Noxc 用户';
    return {
      fqdn: String(r.fqdn || ''),
      label: String(r.label || ''),
      emoji: String(r.showcase_emoji || '').trim().slice(0, 8),
      title: (String(r.showcase_title || '').trim() || String(r.label || '') || String(r.fqdn || '')).slice(0, 60),
      desc: String(r.showcase_desc || '').trim().slice(0, 160),
      owner: owner.slice(0, 40),
    };
  }).filter((x) => !!x.fqdn);
}

/** 展示字段清洗：Domain 页 PATCH 与后端共用，避免两边口径漂移 */
export function cleanShowcaseInput(body: any) {
  const out: any = {};
  if (body.showcase !== undefined) out.showcase = body.showcase ? 1 : 0;
  if (body.showcase_title !== undefined) out.showcase_title = String(body.showcase_title ?? '').trim().slice(0, 60);
  if (body.showcase_desc !== undefined) out.showcase_desc = String(body.showcase_desc ?? '').trim().slice(0, 160);
  if (body.showcase_emoji !== undefined) out.showcase_emoji = String(body.showcase_emoji ?? '').trim().slice(0, 8);
  return out;
}
