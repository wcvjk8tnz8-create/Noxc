/**
 * 数据备份 · 格式层（纯函数，可单测）
 *
 * 三种导出：子域名 CSV、用户 CSV、站点设置 JSON。
 * 导出物必须能「重新汇入」：CSV 用固定列清单与表头，JSON 带 format/version，
 * 导入端只认白名单字段，绝不把文件内容拼进 SQL。
 *
 * CSV 细节：
 *   · UTF-8 BOM + CRLF，Excel 直接打开不乱码
 *   · RFC4180 引号 / 双引号转义
 *   · 以 = + - @ 制表符开头的单元格前置单引号防公式注入，导入时精确还原
 *   · 空值统一为空串，NULL 与 0 不混淆（导入按列类型解析）
 */

export type BackupKind = 'users' | 'subdomains' | 'settings';
export const BACKUP_KINDS: BackupKind[] = ['users', 'subdomains', 'settings'];

export const USERS_COLS = [
  'id', 'email', 'password_hash', 'role', 'status', 'ban_reason',
  'quota', 'created_at', 'last_login_at',
] as const;

export const SUBDOMAINS_COLS = [
  'id', 'fqdn', 'label', 'root_domain', 'user_id', 'owner_email', 'status',
  'reason', 'note', 'expires_at', 'renewed_at', 'perpetual',
  'created_at', 'updated_at', 'reviewed_at', 'reviewed_by',
  'apply_cost', 'ai_attempts', 'showcase', 'showcase_title',
  'showcase_desc', 'showcase_emoji',
] as const;

export const COLS: Record<'users' | 'subdomains', readonly string[]> = {
  users: USERS_COLS,
  subdomains: SUBDOMAINS_COLS,
};

/** 站点设置里属于凭据的 key：默认完整导出；仅生成脱敏副本时置空 */
export const SENSITIVE_SETTING_KEYS = new Set([
  'mail_api_key', 'ai_api_key',
  'nodeloc_client_secret', 'github_client_secret',
  'dns_api_key', 'dns_api_secret',
  'dnshe_api_key', 'dnshe_api_secret',
  'spaceship_api_key', 'spaceship_api_secret',
  'cf_api_token',
]);

/** 内部运行态 key：不是「站点设置」，导出不带、导入忽略，避免把旧快照/迁移标记灌回来 */
export const INTERNAL_SETTING_KEY_RE =
  /^(?:public_stats_snapshot|runtime_migrations_\w+|points_defaults_v\d+|migrations?_\w+)$/;

export function isInternalSettingKey(k: string): boolean {
  return INTERNAL_SETTING_KEY_RE.test(String(k || '').trim().toLowerCase());
}

export const SETTINGS_FORMAT = 'noxc-settings-backup';
export const SETTINGS_VERSION = 1;

/** 公式注入防护：只在导出时加，导入时按同样规则剥掉 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function csvUnescapeCell(s: string): string {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

export function toCsv(cols: readonly string[], rows: Record<string, unknown>[]): string {
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((k) => csvCell(r[k])).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** RFC4180 解析：支持引号内逗号 / 换行 / 双引号转义、CRLF、UTF-8 BOM */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(csvUnescapeCell(cell)); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(csvUnescapeCell(cell)); cell = '';
      if (row.some((x) => x !== '')) out.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(csvUnescapeCell(cell));
    if (row.some((x) => x !== '')) out.push(row);
  }
  if (!out.length) return { headers: [], rows: [] };
  return {
    headers: out[0].map((h) => h.trim()),
    rows: out.slice(1),
  };
}

/** 把解析后的行按表头映射成对象，只保留列白名单里的字段 */
export function csvToObjects(
  text: string,
  cols: readonly string[],
): { items: Record<string, string>[]; headers: string[]; error?: string } {
  const parsed = parseCsv(text);
  if (!parsed.headers.length) return { items: [], headers: [], error: '文件为空或格式不正确' };
  const need = cols.includes('fqdn') ? ['fqdn'] : ['email'];
  const missing = need.filter((k) => !parsed.headers.includes(k));
  if (missing.length) return { items: [], headers: parsed.headers, error: `缺少必需列：${missing.join('、')}` };
  const allowed = new Set(cols);
  const items = parsed.rows.map((r) => {
    const o: Record<string, string> = {};
    parsed.headers.forEach((h, i) => { if (allowed.has(h)) o[h] = r[i] ?? ''; });
    return o;
  });
  return { items, headers: parsed.headers };
}

/** 只接受有限数字；空串 / 非法值返回 null（绝不把脏数据写成 0） */
export function csvNum(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export const USER_ROLES = new Set(['user', 'admin']);
export const USER_STATUSES = new Set(['active', 'banned']);
export const SUB_STATUSES = new Set(['pending', 'approved', 'rejected', 'suspended', 'expired']);

export const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
export const FQDN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
export const SETTING_KEY_RE = /^[a-z0-9_]{1,64}$/;

export function rootOfFqdn(fqdn: string): string {
  const i = String(fqdn || '').indexOf('.');
  return i > 0 ? String(fqdn).slice(i + 1).toLowerCase() : '';
}

export function backupFilename(kind: BackupKind, date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return kind === 'settings' ? `noxc-settings-${d}.json` : `noxc-${kind}-${d}.csv`;
}
