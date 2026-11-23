/**
 * 数据备份专项回归（CI 步骤：数据备份导出与汇入回归）
 *
 * 真跑 src/routes/backup.ts + 内存 D1，覆盖：
 *   A. CSV 格式层：公式注入防护 + 精确还原、RFC4180 round-trip、白名单列、脏数字
 *   B. 导出：用户 / 子域名 CSV、站点设置 JSON（脱敏 / 含凭据 / 内部 key 排除）、权限
 *   C. 重新汇入：导出→清空→汇入 round-trip、dryRun 不写库、merge/replace 口径、
 *      跨库按邮箱重建归属、脱敏密钥不覆盖、脏数据与格式校验
 *   D. 静态断言：挂载 / 统计失效 / 后台面板 / README 文末说明
 *
 * 运行：npx tsx scripts/backup-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import backupRoutes from '../src/routes/backup.js';
import {
  csvCell, csvUnescapeCell, toCsv, parseCsv, csvToObjects, csvNum,
  rootOfFqdn, isInternalSettingKey, USERS_COLS, SUBDOMAINS_COLS,
  SETTINGS_FORMAT,
} from '../src/lib/backupFormat.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

type Row = Record<string, any>;
type Store = {
  users: Map<number, Row>;
  subs: Map<number, Row>;
  settings: Map<string, string>;
  audit: Row[];
  seq: number;
};

function fresh(): Store {
  return {
    users: new Map(), subs: new Map(), settings: new Map(), audit: [], seq: 0,
  };
}

function seed(s: Store) {
  s.users.set(1, { id: 1, email: 'admin@x.com', password_hash: 'HASH_ADMIN', role: 'admin',
    status: 'active', ban_reason: '', quota: -1, created_at: 1000, last_login_at: 2000 });
  s.users.set(2, { id: 2, email: 'user@example.com', password_hash: 'HASH_USER', role: 'user',
    status: 'active', ban_reason: '', quota: 5, created_at: 1100, last_login_at: 2100 });
  s.subs.set(10, { id: 10, label: 'mail', root_domain: 'meoy.top', fqdn: 'mail.meoy.top',
    user_id: 2, status: 'approved', reason: '', note: '说明, 带逗号\n还有换行',
    expires_at: 9999999, renewed_at: null, perpetual: 0, created_at: 1200, updated_at: 1300,
    reviewed_at: 1250, reviewed_by: 1, apply_cost: 60, ai_attempts: 0,
    showcase: 1, showcase_title: '=SUM(1+1)', showcase_desc: '带"引号"', showcase_emoji: '' });
  s.settings.set('site_name', 'Noxc');
  s.settings.set('announcement', '欢迎使用Noxc');
  s.settings.set('mail_api_key', 'SECRET_MAIL_KEY');
  s.settings.set('nodeloc_client_secret', 'SECRET_NL');
  s.settings.set('domain_valid_days', '365');
  s.settings.set('public_stats_snapshot', '{"at":1}');
  s.settings.set('runtime_migrations_v3', '1');
}

function makeEnv(s: Store) {
  const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const exec = (sql: string, args: any[]) => {
    const q = norm(sql);
    let rows: Row[] = [], changes = 0, lastRowId = 0;

    if (/^SELECT .* FROM users ORDER BY id ASC/.test(q)) {
      rows = [...s.users.values()].sort((a, b) => a.id - b.id).map((x) => ({ ...x }));
    } else if (/^SELECT .* FROM subdomains s LEFT JOIN users u/.test(q)) {
      rows = [...s.subs.values()].sort((a, b) => a.id - b.id).map((x) => ({
        ...x, owner_email: s.users.get(Number(x.user_id))?.email || '',
      }));
    } else if (/^SELECT key, value FROM settings/.test(q)) {
      rows = [...s.settings.entries()].map(([key, value]) => ({ key, value }));
    } else if (/^SELECT id FROM users WHERE email = \?/.test(q)) {
      const u = [...s.users.values()].find((x) => String(x.email).toLowerCase() === String(args[0]).toLowerCase());
      if (u) rows = [{ id: u.id }];
    } else if (/^SELECT id FROM users WHERE id = \?/.test(q)) {
      if (s.users.has(Number(args[0]))) rows = [{ id: Number(args[0]) }];
    } else if (/^SELECT id FROM subdomains WHERE fqdn = \?/.test(q)) {
      const x = [...s.subs.values()].find((r) => String(r.fqdn).toLowerCase() === String(args[0]).toLowerCase());
      if (x) rows = [{ id: x.id }];
    } else if (/^SELECT key FROM settings WHERE key = \?/.test(q)) {
      if (s.settings.has(String(args[0]))) rows = [{ key: String(args[0]) }];
    } else if (/^UPDATE (\w+) SET /.test(q)) {
      const m = q.match(/^UPDATE (\w+) SET ([\s\S]+?) WHERE (?:id|key) = \?$/);
      if (m) {
        const cols = [...m[2].matchAll(/(\w+) = \?/g)].map((x) => x[1]);
        const table = m[1];
        const key = args[args.length - 1];
        const obj = table === 'users' ? s.users.get(Number(key))
          : table === 'subdomains' ? s.subs.get(Number(key)) : null;
        if (obj) {
          cols.forEach((c, i) => { obj[c] = args[i]; });
          changes = 1;
        }
      }
    } else if (/^INSERT( OR IGNORE)? INTO (users|subdomains|settings|audit_log)\s*\(/.test(q)) {
      const m = q.match(/^INSERT( OR IGNORE)? INTO (\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/);
      if (m) {
        const ignore = !!m[1];
        const table = m[2];
        const cols = m[3].split(',').map((x) => x.trim());
        const vals = args.slice(0, cols.length);
        const o: Row = {};
        cols.forEach((c, i) => { o[c] = vals[i]; });
        if (table === 'audit_log') { s.audit.push(o); changes = 1; }
        else if (table === 'settings') {
          const k = String(o.key);
          const had = s.settings.has(k);
          if (!(had && /ON CONFLICT/.test(q) === false)) s.settings.set(k, String(o.value));
          changes = 1;
        } else {
          const map = table === 'users' ? s.users : s.subs;
          const uniq = table === 'users' ? 'email' : 'fqdn';
          const dupId = o.id !== undefined && o.id !== null && Number(o.id) > 0 && map.has(Number(o.id));
          const dupUniq = [...map.values()].some((x) => String(x[uniq]).toLowerCase() === String(o[uniq]).toLowerCase());
          if (dupId || dupUniq) {
            if (!ignore) throw new Error('UNIQUE constraint failed: ' + uniq);
            changes = 0;                    // OR IGNORE：不插入，让路由回落到自增
          } else {
            const id = o.id && Number(o.id) > 0 ? Number(o.id) : ++s.seq + 100;
            s.seq = Math.max(s.seq, id - 100);
            map.set(id, { ...o, id });
            changes = 1; lastRowId = id;
          }
        }
      }
    }
    return { rows, changes, lastRowId };
  };
  const wrap = (sql: string, args: any[]) => ({
    first: async () => exec(sql, args).rows[0] ?? null,
    all: async () => ({ results: exec(sql, args).rows }),
    run: async () => { const r = exec(sql, args); return { meta: { changes: r.changes, last_row_id: r.lastRowId } }; },
  });
  const DB = {
    prepare(sql: string) {
      const base = wrap(sql, []);
      return { bind: (...a: any[]) => wrap(sql, a), ...base };
    },
  };
  return { DB, ROOT_DOMAIN: 'meoy.top' } as any;
}

const CTX: any = { waitUntil() {}, passThroughOnException() {} };
function appFor(s: Store, role = 'admin') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user', role === 'none' ? null : { id: 1, role, status: 'active', email: 'admin@x.com' });
    await next();
  });
  app.route('/api/admin/backup', backupRoutes);
  const env = makeEnv(s);
  const call = (p: string, init?: RequestInit) =>
    app.fetch(new Request('https://nic.test' + p, init), env, CTX);
  return { call, env };
}
const post = (body: any): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

async function main() {
  /* ───────── A. CSV 格式层 ───────── */
  {
    check(csvCell('=SUM(1+1)') === "'=SUM(1+1)", '导出时公式型单元格前置单引号');
    check(csvCell('-1') === "'-1" && csvUnescapeCell("'-1") === '-1', '负数（quota=-1）不丢符号，导入精确还原');
    check(csvUnescapeCell('普通文本') === '普通文本', '普通文本不被误剥');
    check(csvCell('a,b"c\nd') === '"a,b""c\nd"', '逗号 / 双引号 / 换行按 RFC4180 转义');

    const csv = toCsv(USERS_COLS, [
      { id: 1, email: 'a@x.com', password_hash: 'H', note: '不该出现的列' },
    ]);
    check(csv.startsWith('\uFEFF') && csv.includes('\r\n'), 'CSV 带 UTF-8 BOM 与 CRLF');
    const p = parseCsv(csv);
    check(p.headers.join(',') === USERS_COLS.join(','), '表头按固定列清单输出');
    check(p.rows.length === 1 && p.rows[0][1] === 'a@x.com', '解析回单行数据');
    const o = csvToObjects(csv, USERS_COLS);
    check(o.items[0].email === 'a@x.com' && !('note' in o.items[0]), '额外列被白名单过滤，不会进 SQL');

    const tricky = toCsv(SUBDOMAINS_COLS, [{
      fqdn: 'a.meoy.top', note: '说明, 带逗号\n还有换行', showcase_title: '=1+1',
      showcase_desc: '带"引号"', quota: 0,
    }]);
    const back = csvToObjects(tricky, SUBDOMAINS_COLS).items[0];
    check(back.note === '说明, 带逗号\n还有换行', '引号内逗号与换行 round-trip 无损');
    check(back.showcase_title === '=1+1' && back.showcase_desc === '带"引号"',
      '公式前缀与双引号 round-trip 精确还原');
    check(!!csvToObjects('fqdn,label\r\na.meoy.top,a\r\n', SUBDOMAINS_COLS).items.length,
      '子域名 CSV 必需列是 fqdn');
    check(!!csvToObjects('id,email\r\n1,a@x.com\r\n', USERS_COLS).error === false,
      '用户 CSV 有 email 即通过必需列校验');
    check(!!csvToObjects('fqdn,label\r\na.meoy.top,a\r\n', USERS_COLS).error,
      '拿子域名 CSV 当用户 CSV 汇入会被必需列校验挡下');
    check(csvNum('') === null && csvNum('abc') === null && csvNum('-1') === -1 && csvNum('12.9') === 12,
      '数字字段：空 / 脏值不写成 0，负数保留，小数取整');
    check(rootOfFqdn('mail.meoy.top') === 'meoy.top', '缺 root_domain 时从 fqdn 反推');
    check(isInternalSettingKey('public_stats_snapshot') && isInternalSettingKey('runtime_migrations_v3')
      && !isInternalSettingKey('site_name'), '内部运行态 key 识别');
  }

  /* ───────── B. 导出 ───────── */
  let usersCsv = '', subsCsv = '', settingsJson = '';
  {
    const s = fresh(); seed(s);
    const { call } = appFor(s);

    const ru = await call('/api/admin/backup/export/users');
    usersCsv = await ru.text();
    check(ru.status === 200 && /text\/csv/.test(ru.headers.get('content-type') || ''), '用户导出返回 CSV');
    check(/attachment; filename="noxc-users-\d{4}-\d{2}-\d{2}\.csv"/.test(ru.headers.get('content-disposition') || ''),
      '用户 CSV 带日期文件名');
    check(usersCsv.includes('HASH_ADMIN') && usersCsv.includes('admin@x.com'),
      '用户 CSV 含密码哈希与邮箱（恢复后可原样登录）');
    check(usersCsv.includes("'-1"), '不限量 quota=-1 导出时防公式注入');
    check(csvToObjects(usersCsv, USERS_COLS).items[0].quota === '-1', '导入端能还原 -1');

    const rs = await call('/api/admin/backup/export/subdomains');
    subsCsv = await rs.text();
    check(rs.status === 200, '子域名导出返回 200');
    check(subsCsv.includes('owner_email') && subsCsv.includes('user@example.com'),
      '子域名 CSV 带所属邮箱，跨库可重建归属');
    check(csvToObjects(subsCsv, SUBDOMAINS_COLS).items[0].note === '说明, 带逗号\n还有换行',
      '带逗号 / 换行的说明字段导出无损');
    check(csvToObjects(subsCsv, SUBDOMAINS_COLS).items[0].showcase_title === '=SUM(1+1)',
      '公式型展示标题导出后仍可精确还原');

    const rj = await call('/api/admin/backup/export/settings');
    settingsJson = await rj.text();
    const j = JSON.parse(settingsJson);
    check(rj.status === 200 && /application\/json/.test(rj.headers.get('content-type') || ''), '站点设置导出返回 JSON');
    check(j.format === SETTINGS_FORMAT && j.version === 1, 'JSON 带 format / version，导入端可校验');
    check(j.settings.site_name === 'Noxc' && j.settings.announcement === '欢迎使用Noxc', '普通设置原样导出');
    check(j.settings.mail_api_key === '' && j.maskedKeys.includes('mail_api_key'),
      '凭据类 key 默认脱敏并列进 maskedKeys');
    check(!('public_stats_snapshot' in j.settings) && !('runtime_migrations_v3' in j.settings),
      '统计快照 / 迁移 marker 不进备份');
    check(!settingsJson.includes('SECRET_MAIL_KEY'), '默认导出物里不含任何密钥明文');

    const rj2 = await call('/api/admin/backup/export/settings?includeSecrets=1');
    const j2 = JSON.parse(await rj2.text());
    check(j2.includeSecrets === true && j2.settings.mail_api_key === 'SECRET_MAIL_KEY',
      '显式 includeSecrets=1 才带凭据真值');

    const bad = await call('/api/admin/backup/export/nope');
    check(bad.status === 400, '非法导出类型 400');
    const guest = appFor(s, 'user');
    const denied = await guest.call('/api/admin/backup/export/users');
    check(denied.status === 403, '非管理员导出 403');
    const anon = appFor(s, 'none');
    check((await anon.call('/api/admin/backup/export/settings')).status === 403, '未登录导出 403');
  }

  /* ───────── C. 汇入 round-trip ───────── */
  {
    /* C1 用户：导出 → 清空 → dryRun → 确认 → 全量回来 */
    const s = fresh(); seed(s);
    const { call } = appFor(s);
    const before = await call('/api/admin/backup/export/users');
    const csv = await before.text();
    s.users.clear();
    check(s.users.size === 0, '模拟用户数据遗失');

    const dry = await call('/api/admin/backup/import/users', post({ data: csv, mode: 'merge', dryRun: true }));
    const dj: any = await dry.json();
    check(dry.status === 200 && dj.dryRun === true && dj.insert === 2, 'dryRun 预览算出 2 条新增');
    check(s.users.size === 0, '预览不写入数据库');

    const real = await call('/api/admin/backup/import/users', post({ data: csv, mode: 'merge' }));
    const rj: any = await real.json();
    check(real.status === 200 && rj.insert === 2 && s.users.size === 2, '确认汇入后 2 个用户恢复');
    const admin = [...s.users.values()].find((x) => x.email === 'admin@x.com');
    check(admin?.id === 1 && admin.password_hash === 'HASH_ADMIN' && admin.role === 'admin' && admin.quota === -1,
      '原 id / 密码哈希 / 角色 / -1 配额全部还原');

    /* merge 不覆盖现有 */
    s.users.get(1).quota = 99;
    const mergeAgain = await call('/api/admin/backup/import/users', post({ data: csv, mode: 'merge' }));
    const mj: any = await mergeAgain.json();
    check(mj.skip === 2 && mj.insert === 0 && s.users.get(1).quota === 99,
      'merge 模式只补缺失，现有数据一字不动');

    /* replace 更新可恢复字段，但绝不碰密码哈希与角色 */
    s.users.get(1).password_hash = 'CURRENT_HASH';
    s.users.get(1).role = 'admin';
    const rep = await call('/api/admin/backup/import/users', post({ data: csv, mode: 'replace' }));
    const pj: any = await rep.json();
    check(pj.update === 2 && s.users.get(1).password_hash === 'CURRENT_HASH'
      && s.users.get(1).role === 'admin' && s.users.get(1).quota === -1,
      'replace 恢复配额 / 状态，但保留当前密码哈希与角色');
    check(s.audit.some((a) => a.action === 'backup.import'), '正式汇入写审计日志');
  }

  {
    /* C2 子域名：按 owner_email 跨库重建归属（原 user_id 已失效） */
    const s = fresh(); seed(s);
    const { call } = appFor(s);
    const csv = await (await call('/api/admin/backup/export/subdomains')).text();
    s.subs.clear();
    /* 把用户 id 全部改掉，模拟换库后自增 id 不同 */
    const old = [...s.users.values()];
    s.users.clear();
    old.forEach((u) => s.users.set(u.id + 50, { ...u, id: u.id + 50 }));

    const dry = await call('/api/admin/backup/import/subdomains', post({ data: csv, mode: 'merge', dryRun: true }));
    const dj: any = await dry.json();
    check(dj.insert === 1 && s.subs.size === 0, '子域名预览 1 条新增且不写库');
    const real = await call('/api/admin/backup/import/subdomains', post({ data: csv, mode: 'merge' }));
    const rj: any = await real.json();
    const sub = [...s.subs.values()][0];
    check(rj.insert === 1 && s.subs.size === 1, '子域名恢复成功');
    check(sub.user_id === 52, '跨库时按 owner_email 映射到新 user_id，不沿用失效的旧 id');
    check(sub.id === 10 && sub.root_domain === 'meoy.top' && sub.status === 'approved'
      && sub.note === '说明, 带逗号\n还有换行' && sub.showcase_title === '=SUM(1+1)',
      '原 id / 根域名 / 状态 / 复杂文本 / 展示字段全部还原');
    check(sub.expires_at === 9999999 && sub.apply_cost === 60 && sub.showcase === 1,
      '数字与展示开关字段还原');

    /* 找不到所属用户 → 跳过并给原因 */
    const s2 = fresh(); seed(s2); s2.users.clear();
    const r2: any = await (await appFor(s2).call('/api/admin/backup/import/subdomains',
      post({ data: csv, mode: 'merge' }))).json();
    check(r2.skip === 1 && /找不到所属用户/.test(r2.skipped[0]?.reason || ''),
      '用户不存在时跳过子域名并提示先汇入用户');
  }

  {
    /* C3 站点设置：脱敏备份不覆盖现有密钥 */
    const s = fresh(); seed(s);
    const { call } = appFor(s);
    const json = await (await call('/api/admin/backup/export/settings')).text();
    s.settings.clear();
    s.settings.set('mail_api_key', 'CURRENT_KEY');   // 当前正在用的密钥
    const dry = await call('/api/admin/backup/import/settings', post({ data: json, dryRun: true, mode: 'merge' }));
    const dj: any = await dry.json();
    check(dj.dryRun === true && dj.insert >= 3 && s.settings.size === 1, '设置预览不写库');
    const real = await call('/api/admin/backup/import/settings', post({ data: json, mode: 'merge' }));
    const rj: any = await real.json();
    check(s.settings.get('site_name') === 'Noxc' && s.settings.get('announcement') === '欢迎使用Noxc',
      '普通设置恢复');
    check(s.settings.get('mail_api_key') === 'CURRENT_KEY',
      '脱敏的空密钥被跳过，不会把当前密钥冲成空串');
    check(!s.settings.has('public_stats_snapshot'), '内部快照不会被灌回来');

    /* includeSecrets 的备份可以真正恢复凭据 */
    const s2 = fresh(); seed(s2);
    const full = await (await appFor(s2).call('/api/admin/backup/export/settings?includeSecrets=1')).text();
    s2.settings.clear();
    await appFor(s2).call('/api/admin/backup/import/settings', post({ data: full, mode: 'merge' }));
    check(s2.settings.get('mail_api_key') === 'SECRET_MAIL_KEY', '含凭据备份可完整恢复密钥');

    /* merge 不覆盖 / replace 覆盖 */
    const s3 = fresh(); seed(s3);
    s3.settings.set('site_name', '当前名字');
    const app3 = appFor(s3);
    const m: any = await (await app3.call('/api/admin/backup/import/settings',
      post({ data: json, mode: 'merge' }))).json();
    check(m.insert === 0 && s3.settings.get('site_name') === '当前名字', 'merge 不覆盖现有设置');
    const rp: any = await (await app3.call('/api/admin/backup/import/settings',
      post({ data: json, mode: 'replace' }))).json();
    check(rp.update >= 3 && s3.settings.get('site_name') === 'Noxc', 'replace 覆盖同名设置（脱敏密钥仍跳过）');
  }

  {
    /* C4 脏数据与格式校验 */
    const s = fresh(); seed(s);
    const { call } = appFor(s);
    const badUsers = '\uFEFFid,email,password_hash,role,status,quota,creator\r\n'
      + '3,not-an-email,H,user,active,5,who\r\n'
      + '4,ok@x.com,,user,active,5,who\r\n'
      + '5,bad2@x.com,H,hacker,banned,abc,who\r\n';
    const r: any = await (await call('/api/admin/backup/import/users', post({ data: badUsers }))).json();
    check(r.insert === 1 && r.skip === 2, '非法邮箱 / 缺密码哈希被跳过，非法枚举回落');
    const inserted = [...s.users.values()].find((x) => x.email === 'bad2@x.com');
    check(inserted?.role === 'user' && inserted.quota === 5,
      '非法角色 / 脏配额按安全默认回落，额外列 creator 被忽略');

    const badSubs = 'fqdn,owner_email,status\r\nNOT A DOMAIN,user@example.com,approved\r\n';
    const rs: any = await (await call('/api/admin/backup/import/subdomains', post({ data: badSubs }))).json();
    check(rs.skip === 1 && /域名格式/.test(rs.skipped[0]?.reason || ''), '非法域名被跳过');

    const cases: Array<[string, any, string]> = [
      ['/api/admin/backup/import/settings', { data: '{not json' }, '非法 JSON'],
      ['/api/admin/backup/import/settings', { data: '{"format":"other","version":1,"settings":{}}' }, '错误 format'],
      ['/api/admin/backup/import/settings', { data: JSON.stringify({ format: SETTINGS_FORMAT, version: 99, settings: {} }) }, '错误版本'],

      ['/api/admin/backup/import/users', { data: '' }, '空文件'],
      ['/api/admin/backup/import/users', { data: 'x'.repeat(2 * 1024 * 1024 + 1) }, '超 2MB'],
      ['/api/admin/backup/import/users', { data: 'fqdn\r\na.meoy.top\r\n' }, '缺必需列'],
    ];
    for (const [p, body, label] of cases) {
      const res = await call(p, post(body));
      const j: any = await res.json().catch(() => ({}));
      check(res.status === 400 && j.success === false, `${label} → 400 且给出明确报错`);
    }
    const nonAdmin: any = await (await appFor(s, 'user').call('/api/admin/backup/import/users',
      post({ data: usersCsv }))).json();
    check(nonAdmin.success === false, '非管理员汇入被拒');
    const nonStr: any = await (await call('/api/admin/backup/import/settings',
      post({ data: JSON.stringify({ format: SETTINGS_FORMAT, version: 1, settings: { a: 1 } }) }))).json();
    check(nonStr.success === true && nonStr.skip === 1 && /配置值必须是字符串/.test(nonStr.skipped[0]?.reason || ''),
      '单个非字符串配置值被跳过并说明原因，不毁整份备份');
    check((await call('/api/admin/backup/import/nope', post({ data: 'x' }))).status === 400,
      '非法汇入类型 400');
  }

  /* ───────── D. 静态断言 ───────── */
  {
    const idx = read('src/index.ts');
    const adminTsx = read('src/app/pages/Admin.tsx');
    const legacy = read('src/app/legacy/admin.ts');
    const readme = read('README.md');
    const ci = read('.github/workflows/deploy.yml');
    check(/app\.route\('\/api\/admin\/backup', backupRoutes\)/.test(idx), '备份路由挂在 /api/admin/backup（受 requireAdmin 保护）');
    check(/backup\\\/import/.test(idx) && /invalidatePublicStats/.test(idx),
      '汇入用户 / 子域名会主动失效公开统计快照');
    check(/data-tab="backup"/.test(adminTsx) && /backup: \['数据备份'/.test(legacy),
      '后台新增「数据备份」页签');
    check(/bkExpSubs/.test(legacy) && /bkExpUsers/.test(legacy) && /bkExpSettings/.test(legacy),
      '三个导出按钮都在');
    check(/dryRun: true/.test(legacy) && /dryRun: false/.test(legacy),
      '先预览再确认，两步汇入');
    check(/if \(!pending\)/.test(legacy) && /window\.confirm/.test(legacy),
      '确认前有预览结果与二次确认');
    check(!/[\u{1F300}-\u{1FAFF}]/u.test(legacy.slice(legacy.indexOf('数据备份：导出'), legacy.indexOf("if (tab === 'settings')"))),
      '备份面板零 emoji');
    check(/数据备份/.test(readme)
      && /### Z\.6 数据备份/.test(readme)
      && readme.lastIndexOf('## 附录 Z') > readme.indexOf('### 14. 数据备份'),
      'README 正文有备份说明，注意事项按约定收在文末附录 Z');
    check(/backup-regression\.ts/.test(ci), '专项回归挂进 CI');
    check(/requireAdmin\(c\)/.test(read('src/routes/backup.ts')), '路由内部二次校验管理员身份');
    const bkSrc = read('src/routes/backup.ts');
    check(!/eval\(|new Function/.test(bkSrc)
      && (bkSrc.match(/\.bind\(/g) || []).length >= 8
      && !/body\.data|payload\.settings.*\$\{/.test(bkSrc),
      '汇入代码只用参数化 bind，不执行动态代码、不把文件内容拼进 SQL');
  }

  for (const m of ok) console.log('  ✓ ' + m);
  for (const m of bad) console.error('  ✗ ' + m);
  console.log(`数据备份导出与汇入回归：${ok.length} 通过，${bad.length} 失败`);
  if (bad.length) process.exit(1);
}

main().catch((e) => { console.error('回归异常:', e); process.exit(1); });
