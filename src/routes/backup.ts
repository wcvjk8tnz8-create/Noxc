/**
 * 数据备份 · 导出与重新汇入（仅管理员）
 *
 * 三种导出物：
 *   · /api/admin/backup/export/users       → CSV（含密码哈希，恢复后可原样登录）
 *   · /api/admin/backup/export/subdomains  → CSV（含所属邮箱，用于跨库重建 user_id）
 *   · /api/admin/backup/export/settings    → JSON（凭据类 key 默认脱敏）
 *
 * 「重新汇入」刻意做成两步：先 dryRun 预览（只算不写），确认后再正式导入。
 * 两档模式：
 *   · merge（默认）：只补当前库里缺失的记录，**绝不覆盖**现有数据 —— 遗失恢复的安全默认
 *   · replace：覆盖同名记录的可恢复字段，但**永不覆盖**用户密码哈希与角色
 *
 * 安全边界：
 *   · 路由内二次校验管理员身份（不依赖挂载位置）
 *   · 只认白名单列 / 白名单 key，所有 SQL 参数化，文件内容绝不拼进 SQL
 *   · 邮箱、域名、状态枚举、数字字段逐个校验；行数 / 文本长度有上限
 *   · 脱敏的空值密钥不会被写成空串，不会把当前正在用的密钥冲掉
 *   · 内部运行态 key（统计快照 / 迁移 marker）导出不带、导入忽略
 */
import { Hono } from 'hono';
import { ok, fail, audit } from '../lib/util.js';
import {
  BACKUP_KINDS, COLS, USERS_COLS, SUBDOMAINS_COLS,
  SENSITIVE_SETTING_KEYS, isInternalSettingKey,
  SETTINGS_FORMAT, SETTINGS_VERSION,
  toCsv, csvToObjects, csvNum, rootOfFqdn, backupFilename,
  USER_ROLES, USER_STATUSES, SUB_STATUSES,
  EMAIL_RE, FQDN_RE, SETTING_KEY_RE,
  type BackupKind,
} from '../lib/backupFormat.js';

const app = new Hono();

const MAX_TEXT = 2 * 1024 * 1024;      // 2MB
const MAX_ROWS = 20_000;
const MAX_SETTING_KEYS = 500;

type Mode = 'merge' | 'replace';
const isMode = (v: unknown): v is Mode => v === 'merge' || v === 'replace';
const isKind = (v: string): v is BackupKind => (BACKUP_KINDS as string[]).includes(v);

function requireAdmin(c: any): boolean {
  const u = c.get('user');
  return !!u && u.role === 'admin' && u.status !== 'banned';
}

function download(c: any, kind: BackupKind, body: string, mime: string): Response {
  const res = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': `${mime}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${backupFilename(kind)}"`,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  return res;
}

/* ───────────────────────── 导出 ───────────────────────── */

app.get('/export/:kind', async (c: any) => {
  if (!requireAdmin(c)) return fail(c, '需要管理员权限', 403);
  const kind = c.req.param('kind');
  if (!isKind(kind)) return fail(c, '不支持的导出类型', 400, { kinds: BACKUP_KINDS });

  if (kind === 'users') {
    const { results } = await c.env.DB.prepare(
      `SELECT ${USERS_COLS.join(',')} FROM users ORDER BY id ASC`
    ).all();
    await audit(c, c.get('user').id, 'backup.export', 'users', `${(results || []).length} 行`);
    return download(c, kind, toCsv(USERS_COLS, (results || []) as any[]), 'text/csv');
  }

  if (kind === 'subdomains') {
    const cols = SUBDOMAINS_COLS.filter((k) => k !== 'owner_email');
    const { results } = await c.env.DB.prepare(
      `SELECT ${cols.map((k) => 's.' + k).join(',')}, u.email AS owner_email
       FROM subdomains s LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.id ASC`
    ).all();
    await audit(c, c.get('user').id, 'backup.export', 'subdomains', `${(results || []).length} 行`);
    return download(c, kind, toCsv(SUBDOMAINS_COLS, (results || []) as any[]), 'text/csv');
  }

  /* settings：默认脱敏；显式 ?includeSecrets=1 才带真值 */
  const includeSecrets = String(c.req.query('includeSecrets') || '').trim() === '1';
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings ORDER BY key ASC').all();
  const settings: Record<string, string> = {};
  const maskedKeys: string[] = [];
  for (const r of (results || []) as any[]) {
    const k = String(r.key);
    if (isInternalSettingKey(k)) continue;          // 内部运行态不算站点设置
    const sensitive = SENSITIVE_SETTING_KEYS.has(k);
    if (sensitive && !includeSecrets) maskedKeys.push(k);
    settings[k] = sensitive && !includeSecrets ? '' : String(r.value ?? '');
  }
  const payload = {
    format: SETTINGS_FORMAT,
    version: SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    includeSecrets,
    settings,
    maskedKeys,
    note: 'Noxc 站点设置备份。凭据类 key 默认置空；汇入时空值密钥会被跳过，不会覆盖现有配置。',
  };
  await audit(c, c.get('user').id, 'backup.export', 'settings',
    `${Object.keys(settings).length} 项${includeSecrets ? '（含凭据）' : `（脱敏 ${maskedKeys.length} 项）`}`);
  return download(c, kind, JSON.stringify(payload, null, 2), 'application/json');
});

/* ───────────────────────── 汇入 ───────────────────────── */

type Counters = {
  total: number; insert: number; update: number; skip: number;
  skipped: Array<{ row: number; reason: string }>;
  warnings: string[];
};

function newCounters(): Counters {
  return { total: 0, insert: 0, update: 0, skip: 0, skipped: [], warnings: [] };
}
function skipRow(r: Counters, row: number, reason: string) {
  r.skip++;
  if (r.skipped.length < 30) r.skipped.push({ row, reason });
}

async function importUsers(c: any, text: string, mode: Mode, dryRun: boolean): Promise<Counters> {
  const r = newCounters();
  const parsed = csvToObjects(text, COLS.users);
  if (parsed.error) throw new Error(parsed.error);
  if (parsed.items.length > MAX_ROWS) throw new Error(`行数超过上限 ${MAX_ROWS}`);
  r.total = parsed.items.length;
  const db = c.env.DB;
  for (const [i, o] of parsed.items.entries()) {
    const row = i + 2;   // 表头算第 1 行
    const email = String(o.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { skipRow(r, row, '邮箱格式不正确'); continue; }
    const hash = String(o.password_hash || '').trim();
    if (!hash) { skipRow(r, row, '缺少密码哈希，无法恢复登录'); continue; }
    const existing: any = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) {
      if (mode === 'merge') { skipRow(r, row, '已存在（merge 模式不覆盖）'); continue; }
      /* replace 只恢复可恢复字段：密码哈希与角色永远不动，避免把当前管理员冲掉 */
      if (!dryRun) {
        await db.prepare(
          `UPDATE users SET status = ?, ban_reason = ?, quota = ?, created_at = ?, last_login_at = ? WHERE id = ?`
        ).bind(
          USER_STATUSES.has(o.status) ? o.status : 'active',
          String(o.ban_reason || '').slice(0, 300) || null,
          csvNum(o.quota) ?? 5,
          csvNum(o.created_at) ?? Date.now(),
          csvNum(o.last_login_at),
          existing.id,
        ).run();
      }
      r.update++;
      continue;
    }
    if (!dryRun) {
      const vals = [
        email,
        hash.slice(0, 500),
        USER_ROLES.has(o.role) ? o.role : 'user',
        USER_STATUSES.has(o.status) ? o.status : 'active',
        String(o.ban_reason || '').slice(0, 300) || null,
        csvNum(o.quota) ?? 5,
        csvNum(o.created_at) ?? Date.now(),
        csvNum(o.last_login_at),
      ];
      const id = csvNum(o.id);
      /* 优先保留原 id（子域名 CSV 里的 user_id 依赖它）；id 被占用时回落自增 */
      if (id && id > 0) {
        const ins = await db.prepare(
          `INSERT OR IGNORE INTO users (id, email, password_hash, role, status, ban_reason, quota, created_at, last_login_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).bind(id, ...vals).run();
        if (Number(ins?.meta?.changes ?? 1) === 0) {
          await db.prepare(
            `INSERT INTO users (email, password_hash, role, status, ban_reason, quota, created_at, last_login_at)
             VALUES (?,?,?,?,?,?,?,?)`
          ).bind(...vals).run();
        }
      } else {
        await db.prepare(
          `INSERT INTO users (email, password_hash, role, status, ban_reason, quota, created_at, last_login_at)
           VALUES (?,?,?,?,?,?,?,?)`
        ).bind(...vals).run();
      }
    }
    r.insert++;
  }
  if (r.skip > r.skipped.length) r.warnings.push(`另有 ${r.skip - r.skipped.length} 行被跳过，未逐一列出`);
  return r;
}

async function importSubdomains(c: any, text: string, mode: Mode, dryRun: boolean): Promise<Counters> {
  const r = newCounters();
  const parsed = csvToObjects(text, COLS.subdomains);
  if (parsed.error) throw new Error(parsed.error);
  if (parsed.items.length > MAX_ROWS) throw new Error(`行数超过上限 ${MAX_ROWS}`);
  r.total = parsed.items.length;
  const db = c.env.DB;
  for (const [i, o] of parsed.items.entries()) {
    const row = i + 2;
    const fqdn = String(o.fqdn || '').trim().toLowerCase();
    if (!FQDN_RE.test(fqdn)) { skipRow(r, row, '域名格式不正确'); continue; }
    /* 先按邮箱找用户（跨库 id 可能变了），再回落到 CSV 里的原 user_id */
    let uid: any = null;
    const email = String(o.owner_email || '').trim().toLowerCase();
    if (EMAIL_RE.test(email)) {
      uid = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    }
    if (!uid) {
      const oldId = csvNum(o.user_id);
      if (oldId && oldId > 0) uid = await db.prepare('SELECT id FROM users WHERE id = ?').bind(oldId).first();
    }
    if (!uid) { skipRow(r, row, '找不到所属用户（请先汇入用户 CSV）'); continue; }

    const existing: any = await db.prepare('SELECT id FROM subdomains WHERE fqdn = ?').bind(fqdn).first();
    if (existing) {
      if (mode === 'merge') { skipRow(r, row, '已存在（merge 模式不覆盖）'); continue; }
      if (!dryRun) {
        await db.prepare(
          `UPDATE subdomains SET user_id = ?, label = ?, root_domain = ?, status = ?, reason = ?, note = ?,
             expires_at = ?, renewed_at = ?, perpetual = ?, updated_at = ?, reviewed_at = ?, reviewed_by = ?,
             apply_cost = ?, ai_attempts = ?, showcase = ?, showcase_title = ?, showcase_desc = ?, showcase_emoji = ?
           WHERE id = ?`
        ).bind(
          uid.id,
          String(o.label || fqdn.split('.')[0]).slice(0, 63),
          String(o.root_domain || rootOfFqdn(fqdn)).slice(0, 253),
          SUB_STATUSES.has(o.status) ? o.status : 'pending',
          String(o.reason || '').slice(0, 500) || null,
          String(o.note || '').slice(0, 1000) || null,
          csvNum(o.expires_at), csvNum(o.renewed_at), csvNum(o.perpetual) ?? 0,
          csvNum(o.updated_at) ?? Date.now(), csvNum(o.reviewed_at), csvNum(o.reviewed_by),
          csvNum(o.apply_cost), csvNum(o.ai_attempts) ?? 0,
          csvNum(o.showcase) ?? 0,
          String(o.showcase_title || '').slice(0, 60) || null,
          String(o.showcase_desc || '').slice(0, 160) || null,
          String(o.showcase_emoji || '').slice(0, 8) || null,
          existing.id,
        ).run();
      }
      r.update++;
      continue;
    }
    if (!dryRun) {
      const vals = [
        String(o.label || fqdn.split('.')[0]).slice(0, 63),
        String(o.root_domain || rootOfFqdn(fqdn)).slice(0, 253),
        fqdn, uid.id,
        SUB_STATUSES.has(o.status) ? o.status : 'pending',
        String(o.reason || '').slice(0, 500) || null,
        String(o.note || '').slice(0, 1000) || null,
        csvNum(o.expires_at), csvNum(o.renewed_at), csvNum(o.perpetual) ?? 0,
        csvNum(o.created_at) ?? Date.now(), csvNum(o.updated_at) ?? Date.now(),
        csvNum(o.reviewed_at), csvNum(o.reviewed_by), csvNum(o.apply_cost),
        csvNum(o.ai_attempts) ?? 0, csvNum(o.showcase) ?? 0,
        String(o.showcase_title || '').slice(0, 60) || null,
        String(o.showcase_desc || '').slice(0, 160) || null,
        String(o.showcase_emoji || '').slice(0, 8) || null,
      ];
      const id = csvNum(o.id);
      const COL = 'label, root_domain, fqdn, user_id, status, reason, note, expires_at, renewed_at, perpetual, created_at, updated_at, reviewed_at, reviewed_by, apply_cost, ai_attempts, showcase, showcase_title, showcase_desc, showcase_emoji';
      const PH20 = Array(20).fill('?').join(',');
      if (id && id > 0) {
        /* 优先保留原 id（DNS 记录等关联表按 subdomain_id 引用）；id 被占用时回落自增 */
        const ins = await db.prepare(
          `INSERT OR IGNORE INTO subdomains (id, ${COL}) VALUES (?,${PH20})`
        ).bind(id, ...vals).run();
        if (Number(ins?.meta?.changes ?? 1) === 0) {
          await db.prepare(
            `INSERT INTO subdomains (${COL}) VALUES (${PH20})`
          ).bind(...vals).run();
        }
      } else {
        await db.prepare(
          `INSERT INTO subdomains (${COL}) VALUES (${PH20})`
        ).bind(...vals).run();
      }
    }
    r.insert++;
  }
  if (r.skip > r.skipped.length) r.warnings.push(`另有 ${r.skip - r.skipped.length} 行被跳过，未逐一列出`);
  return r;
}

async function importSettings(c: any, text: string, mode: Mode, dryRun: boolean): Promise<Counters> {
  const r = newCounters();
  let payload: any;
  try { payload = JSON.parse(text); }
  catch { throw new Error('不是合法的 JSON 文件'); }
  if (!payload || payload.format !== SETTINGS_FORMAT) throw new Error('不是 Noxc 站点设置备份文件');
  if (Number(payload.version) !== SETTINGS_VERSION) throw new Error(`备份版本 ${payload.version} 不受支持`);
  const entries = payload.settings;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('备份文件缺少 settings 对象');
  const keys = Object.keys(entries);
  if (keys.length > MAX_SETTING_KEYS) throw new Error(`配置项超过上限 ${MAX_SETTING_KEYS}`);
  r.total = keys.length;
  const db = c.env.DB;
  for (const [i, k] of keys.entries()) {
    const row = i + 1;
    const key = String(k).trim().toLowerCase();
    if (!SETTING_KEY_RE.test(key)) { skipRow(r, row, '配置键格式不正确'); continue; }
    if (isInternalSettingKey(key)) { skipRow(r, row, '内部运行态键，已忽略'); continue; }
    const value = entries[k];
    if (typeof value !== 'string') { skipRow(r, row, '配置值必须是字符串'); continue; }
    /* 脱敏导出的空密钥：跳过，绝不把当前正在用的密钥清成空串 */
    if (SENSITIVE_SETTING_KEYS.has(key) && value.trim() === '') {
      skipRow(r, row, '脱敏的空密钥，已跳过'); continue;
    }
    const existing: any = await db.prepare('SELECT key FROM settings WHERE key = ?').bind(key).first();
    if (existing && mode === 'merge') { skipRow(r, row, '已存在（merge 模式不覆盖）'); continue; }
    if (!dryRun) {
      await db.prepare(
        'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind(key, value.slice(0, 20_000)).run();
    }
    if (existing) r.update++; else r.insert++;
  }
  return r;
}

app.post('/import/:kind', async (c: any) => {
  if (!requireAdmin(c)) return fail(c, '需要管理员权限', 403);
  const kind = c.req.param('kind');
  if (!isKind(kind)) return fail(c, '不支持的汇入类型', 400, { kinds: BACKUP_KINDS });
  const body: any = await c.req.json().catch(() => ({}));
  const text = String(body?.data ?? '');
  if (!text) return fail(c, '文件内容为空', 400);
  if (text.length > MAX_TEXT) return fail(c, '文件超过 2MB 上限', 400);
  const mode: Mode = isMode(body?.mode) ? body.mode : 'merge';
  const dryRun = body?.dryRun === true;

  let r: Counters;
  try {
    if (kind === 'users') r = await importUsers(c, text, mode, dryRun);
    else if (kind === 'subdomains') r = await importSubdomains(c, text, mode, dryRun);
    else r = await importSettings(c, text, mode, dryRun);
  } catch (e) {
    return fail(c, `汇入失败：${e instanceof Error ? e.message : String(e)}`, 400);
  }

  if (!dryRun) {
    await audit(c, c.get('user').id, 'backup.import', kind,
      `mode=${mode} 总${r.total} 新增${r.insert} 更新${r.update} 跳过${r.skip}`);
  }
  return ok(c, {
    kind, mode, dryRun,
    total: r.total, insert: r.insert, update: r.update, skip: r.skip,
    skipped: r.skipped, warnings: r.warnings,
    hint: dryRun ? '这是预览，尚未写入数据库；确认无误后再点「确认汇入」。' : '汇入完成。',
  });
});

export default app;
