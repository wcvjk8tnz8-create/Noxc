/**
 * 第三方域名接入（外部域名）· 站长定的新流程
 * ──────────────────────────────────────────────────────────────────────
 *   ① 用户填自己拥有的完整域名（只允许 gTLD 二级域，拒绝 xxx.example.com）
 *   ② 在域名「当前」的 DNS 服务商加 _noxc-verify TXT，点「验证 TXT」通过
 *   ③ 验证通过后，才去注册商把 NS 改为 a.ns.fs5.net / b.ns.fs5.net，
 *      并先在 s.eus 完成该域名的 DNS 托管
 *   ④ 用 SEUS 的 API 连接（站点级 MCP Token 优先；用户也可临时填自己的，
 *      仅本次请求使用、绝不落库），查到该域名的托管区域与 zone id
 *   ⑤ 站长在「站点设置 → 第三方域名接入」看到申请，批准后才生效
 *   ⑥ 批准后该域名成为根域名，DNS 后端锁死 SEUS（下拉不可切换）
 *
 * 顺序是硬约束：TXT 必须加在「当前」的权威 DNS 上。一旦把 NS 改到 SEUS，
 * 原服务商的 TXT 就不再被全球 DNS 查询，验证会永远失败，所以验证必须在
 * 改 NS 之前完成并持久化（verified 之后不依赖 TXT 继续存在）。
 * connect / check-ns / 站长批准三处后端都复核 verify_status，绕过前端也跳不过。
 *
 * 与旧流程的区别：不再让用户选择多家供应商、不再由用户在
 * 前端写记录。权属链 = TXT 所有权验证 + SEUS 托管区域 + NS 委派 + 人工批准。
 *
 * 与 subdomains 解耦：不参与 publicStats 全表聚合、不占注册配额、不写本站 zone。
 * 令牌只在本次请求内存里用，不落库、不写日志、不回传。
 */
import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { matchRoot } from '../lib/roots.js';
import { SEUS_NS, seusConnect } from '../lib/seusDns.js';
import { seusServerToken } from '../lib/seusBackend.js';
import {
  newVerifyToken, verifyHost, verifyValue, checkOwnership,
  VERIFY_PREFIX, VERIFY_VALUE_PREFIX,
} from '../lib/externalVerify.js';
import {
  EXTERNAL_DNS_PROVIDER, EXTERNAL_DNS_LABEL, EXTERNAL_NS, EXTERNAL_MAX_PER_USER,
  EXTERNAL_FLOW_HINT, GTLD_SET,
  normalizeExternalDomain, validateExternalDomain,
} from '../lib/externalDomainPolicy.js';

const app = new Hono();

/** 统一标签：前端所有出现该域名的地方都用这一份文案 */
export const EXTERNAL_LABEL = '（外部域名）';

/* 旧库列补齐：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列。
   模块级缓存，PRAGMA 只在每个 isolate 首次请求时跑一次。 */
/** 存量申请（上一版流程没生成 TXT token 但已连上 SEUS zone）一次性放行标记。
    只命中 verify_token 为空且 zone_id 非空的旧行，UPDATE 幂等，不会动新申请。 */
export const LEGACY_VERIFY_TOKEN = 'legacy-pre-txt';
export async function markLegacyExternalVerified(env: any): Promise<number> {
  try {
    /* 跨 isolate 幂等：marker 一行，冷启动不必每次都发一次 UPDATE */
    const done: any = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'external_verify_legacy_v1'"
    ).first();
    if (done) return 0;
    const r = await env.DB.prepare(
      `UPDATE external_domains
          SET verify_status = 'verified', verified_at = ?, verify_token = ?
        WHERE verify_token = '' AND zone_id <> '' AND verify_status = 'pending'`
    ).bind(now(), LEGACY_VERIFY_TOKEN).run();
    await env.DB.prepare(
      "INSERT INTO settings(key, value) VALUES('external_verify_legacy_v1', '1')"
    ).run();
    return Number(r?.meta?.changes || 0);
  } catch { return 0; }
}

let colsChecked = false;
async function ensureExternalColumns(env: any): Promise<void> {
  if (colsChecked) return;
  try {
    const info = await env.DB.prepare('PRAGMA table_info(external_domains)').all();
    const have = new Set((info?.results || []).map((r: any) => String(r.name)));
    const add = async (col: string, ddl: string) => {
      if (have.has(col)) return;
      await env.DB.prepare(`ALTER TABLE external_domains ADD COLUMN ${col} ${ddl}`).run();
      have.add(col);
    };
    await add('verify_token', "TEXT NOT NULL DEFAULT ''");
    await add('verify_status', "TEXT NOT NULL DEFAULT 'pending'");
    await add('verified_at', 'INTEGER');
    await add('provider_key', "TEXT NOT NULL DEFAULT ''");
    /* ── 新流程字段 ── */
    await add('status', "TEXT NOT NULL DEFAULT 'pending'");       // pending | approved | rejected
    await add('reviewed_at', 'INTEGER');
    await add('reviewed_by', "TEXT NOT NULL DEFAULT ''");
    await add('review_note', "TEXT NOT NULL DEFAULT ''");
    await add('connected_at', 'INTEGER');
    await add('ns_delegated', 'INTEGER NOT NULL DEFAULT 0');
    await add('api_source', "TEXT NOT NULL DEFAULT ''");           // site | user
    colsChecked = true;
    await markLegacyExternalVerified(env);
  } catch { /* 表未建好：后续查询会自然失败，不阻断其它功能 */ }
}

/** 未通过 TXT 验证就不允许改 NS / 连接 SEUS / 站长批准 */
function verifyGate(row: any): string | null {
  if (String(row?.verify_status || 'pending') !== 'verified') {
    return '请先在域名当前的 DNS 服务商添加 TXT 记录并完成所有权验证；验证通过后才能修改 NS 或连接 SEUS API';
  }
  return null;
}

function shape(r: any) {
  const status = String(r?.status || 'pending');
  return {
    id: r.id,
    fqdn: r.fqdn,
    note: r.note || '',
    provider: EXTERNAL_DNS_PROVIDER,
    providerLabel: EXTERNAL_DNS_LABEL,
    ns1: r.ns1 || EXTERNAL_NS[0],
    ns2: r.ns2 || EXTERNAL_NS[1],
    ns: [r.ns1 || EXTERNAL_NS[0], r.ns2 || EXTERNAL_NS[1]],
    zoneId: r.zone_id || '',
    createdAt: r.created_at,
    kind: 'external',
    externalLabel: EXTERNAL_LABEL,
    status,
    statusLabel: status === 'approved' ? '已通过' : status === 'rejected' ? '已驳回' : '待站长批准',
    reviewedAt: r.reviewed_at || null,
    reviewNote: r.review_note || '',
    connected: !!r.zone_id,
    connectedAt: r.connected_at || null,
    apiSource: String(r.api_source || ''),
    nsDelegated: Number(r.ns_delegated || 0) === 1,
    verifyStatus: String(r.verify_status || 'pending'),
    verified: String(r.verify_status || 'pending') === 'verified',
    verifiedAt: r.verified_at || null,
    verifyHost: verifyHost(String(r.fqdn || '')),
    /* 只回拼好的 TXT 值（用户本来就要填它），不回裸 token；
       存量 legacy 行已验证，无需再展示记录值 */
    verifyValue: String(r.verify_token || '') && String(r.verify_token) !== LEGACY_VERIFY_TOKEN
      ? verifyValue(String(r.verify_token)) : '',
    verifyPrefix: VERIFY_PREFIX,
    verifyValuePrefix: VERIFY_VALUE_PREFIX,
  };
}

async function owned(c: any, id: number) {
  const u = c.get('user');
  const row: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?').bind(id).first();
  if (!row) return null;
  if (row.user_id !== u.id && u.role !== 'admin') return null;
  return row;
}

/** 我的接入申请 + 准入策略（前端一次拿全，不额外请求） */
app.get('/', async (c) => {
  await ensureExternalColumns(c.env);
  const u = c.get('user');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM external_domains WHERE user_id = ? ORDER BY id DESC'
  ).bind(u.id).all();
  return ok(c, {
    items: (results || []).map(shape),
    label: EXTERNAL_LABEL,
    max: EXTERNAL_MAX_PER_USER,
    provider: EXTERNAL_DNS_PROVIDER,
    providerLabel: EXTERNAL_DNS_LABEL,
    ns: [...EXTERNAL_NS],
    gtldExamples: ['com', 'net', 'org', 'xyz', 'top', 'online'],
    gtldCount: GTLD_SET.size,
    flow: EXTERNAL_FLOW_HINT,
    siteTokenReady: !!(await seusServerToken(c.env)),
    verifyOrder: 'txt-before-ns',
  });
});

/** ① 提交域名：只建 pending 申请，不碰任何 DNS 写入 */
app.post('/', async (c) => {
  await ensureExternalColumns(c.env);
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const raw = body.domain ?? body.fqdn;
  const isOwn = !!matchRoot(c.env, normalizeExternalDomain(raw));
  const v = validateExternalDomain(raw, isOwn);
  if (!v.ok) return fail(c, v.reason);

  const dup = await c.env.DB.prepare('SELECT id FROM external_domains WHERE fqdn = ?').bind(v.domain).first();
  if (dup) return fail(c, '该域名已被登记（含待审核申请），请勿重复提交');

  const cnt: any = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM external_domains WHERE user_id = ?'
  ).bind(u.id).first();
  if (Number(cnt?.n || 0) >= EXTERNAL_MAX_PER_USER) {
    return fail(c, `每个账号最多登记 ${EXTERNAL_MAX_PER_USER} 个外部域名`);
  }

  const note = String(body.note || '').trim().slice(0, 160);
  const token = newVerifyToken();
  const res = await c.env.DB.prepare(
    `INSERT INTO external_domains
       (fqdn, user_id, note, provider, ns1, ns2, zone_id, verify_token, verify_status,
        status, connected_at, ns_delegated, api_source, created_at)
     VALUES (?, ?, ?, 'seus', ?, ?, '', ?, 'pending', 'pending', 0, 0, '', ?)`
  ).bind(v.domain, u.id, note, EXTERNAL_NS[0], EXTERNAL_NS[1], token, now()).run();

  try { await audit(c, u.id, 'external_domain.add', v.domain, EXTERNAL_LABEL); } catch {}
  const row: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?')
    .bind(res.meta?.last_row_id).first();
  return ok(c, {
    item: shape(row),
    label: EXTERNAL_LABEL,
    ns: [...EXTERNAL_NS],
    next: `第 1 步：请在域名当前的 DNS 服务商添加 TXT 记录 ${verifyHost(v.domain)} = ${verifyValue(token)}，然后点「验证 TXT」。验证通过前不要改 NS`,
    nsWarning: 'NS 未生效前，即使站长批准，写入的记录也不会被全球 DNS 查询；且必须先完成 TXT 验证再改 NS',
  }, 201);
});

/** ② TXT 所有权验证：查 _noxc-verify.<domain>，通过后才解锁改 NS / API 连接。
 *  注意顺序：TXT 必须加在「当前」的权威 DNS 上，改了 NS 就查不到了。 */
app.post('/:id/verify', async (c) => {
  await ensureExternalColumns(c.env);
  const row = await owned(c, Number(c.req.param('id')));
  if (!row) return fail(c, '记录不存在或无权操作', 404);
  if (String(row.verify_status || 'pending') === 'verified') {
    return ok(c, { item: shape(row), already: true, detail: 'TXT 所有权已验证，现在可以去注册商修改 NS' });
  }
  const token = String(row.verify_token || '');
  if (!token) return fail(c, '该申请缺少验证记录，请撤回后重新提交域名');
  const r = await checkOwnership(String(row.fqdn || ''), token);
  if (!r.ok) return fail(c, r.detail);
  await c.env.DB.prepare(
    `UPDATE external_domains SET verify_status = 'verified', verified_at = ? WHERE id = ?`
  ).bind(now(), row.id).run();
  try { await audit(c, c.get('user').id, 'external_domain.verify', String(row.fqdn || ''), 'TXT 所有权验证通过'); } catch {}
  const fresh: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?').bind(row.id).first();
  return ok(c, {
    item: shape(fresh),
    ns: [...EXTERNAL_NS],
    next: `TXT 验证通过。第 2 步：现在才去注册商把 NS 改为 ${EXTERNAL_NS.join(' / ')}，并在 s.eus 完成 DNS 托管，然后点「用 API 连接」`,
    nsWarning: '改 NS 前请确认 TXT 验证已通过；NS 生效前写入的记录不会被全球 DNS 查询',
  });
});

/** 查一次注册商 NS 是否已指向 SEUS（DoH；查不到不算错误，只留未确认） */
async function nsDelegatedToSeus(domain: string): Promise<boolean | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`,
      { headers: { accept: 'application/dns-json' }, signal: ctl.signal }
    );
    clearTimeout(timer);
    if (!r.ok) return null;
    const j: any = await r.json();
    const got = (j?.Answer || [])
      .filter((a: any) => Number(a?.type) === 2)
      .map((a: any) => String(a?.data || '').toLowerCase().replace(/\.+$/, ''));
    if (!got.length) return null;
    const want = SEUS_NS.map((x) => x.toLowerCase());
    return got.some((g: string) => want.some((w) =>
      g === w || g.endsWith('.' + w) || w.endsWith('.' + g)));
  } catch { return null; }
}

/** ③ 用 SEUS API 连接：找托管区域、取回 zone id，并记录 NS 委派状态 */
app.post('/:id/connect', async (c) => {
  await ensureExternalColumns(c.env);
  const row = await owned(c, Number(c.req.param('id')));
  if (!row) return fail(c, '记录不存在或无权操作', 404);
  if (String(row.status || 'pending') === 'approved') {
    return ok(c, { item: shape(row), already: true, detail: '该域名已获批准，无需重复连接' });
  }
  const gate = verifyGate(row);
  if (gate) return fail(c, gate);
  const body = await c.req.json().catch(() => ({}));
  const siteToken = await seusServerToken(c.env);
  /* 站点级令牌优先；站点没配时允许用户临时填自己的 mbt_ Token，
     只在本次请求内存里用，绝不写库、不回传。 */
  const userToken = String(body.apiToken || '').trim();
  const token = siteToken || userToken;
  const apiSource = siteToken ? 'site' : (userToken ? 'user' : '');
  if (!token) {
    return fail(c, '站长还没在「站点设置 → 第三方域名接入」填 SEUS MCP Token（留空也能用）；你可以临时填自己的 mbt_ Token 完成本次连接，仅本次使用、不会保存');
  }

  const fqdn = String(row.fqdn || '');
  let r: any;
  try { r = await seusConnect(token, fqdn); }
  catch (e) { return fail(c, `SEUS API 连接失败：${String((e as any)?.message || e).slice(0, 220)}`); }
  if (!r?.ok) return fail(c, r?.error || 'SEUS 账号里找不到该域名的托管区域');

  const ns = Array.isArray(r.ns) && r.ns.length ? r.ns.map(String) : [...EXTERNAL_NS];
  const delegated = await nsDelegatedToSeus(fqdn);
  await c.env.DB.prepare(
    `UPDATE external_domains
        SET provider = 'seus', zone_id = ?, ns1 = ?, ns2 = ?,
            connected_at = ?, ns_delegated = ?, api_source = ?
      WHERE id = ?`
  ).bind(String(r.zoneId || ''), ns[0] || '', ns[1] || '', now(),
    delegated === true ? 1 : 0, apiSource, row.id).run();

  try { await audit(c, c.get('user').id, 'external_domain.connect', fqdn, `SEUS zone ${r.zoneId}`); } catch {}
  const fresh: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?').bind(row.id).first();
  return ok(c, {
    item: shape(fresh),
    ns,
    zoneId: String(r.zoneId || ''),
    zoneStatus: String(r.zoneStatus || ''),
    nsDelegated: delegated,
    note: r.note || '',
    next: '连接成功，申请已提交给站长。请在「站点设置 → 第三方域名接入」等待批准',
    nsWarning: delegated === true
      ? '注册商 NS 已指向 SEUS DNS'
      : '暂未查到注册商 NS 指向 SEUS。请到注册商确认，NS 生效前记录不会全球生效',
  });
});

/** 重新检查 NS 委派（DNS 传播后可点，不改动 zone） */
app.post('/:id/check-ns', async (c) => {
  await ensureExternalColumns(c.env);
  const row = await owned(c, Number(c.req.param('id')));
  if (!row) return fail(c, '记录不存在或无权操作', 404);
  const gate = verifyGate(row);
  if (gate) return fail(c, gate);
  const delegated = await nsDelegatedToSeus(String(row.fqdn || ''));
  await c.env.DB.prepare('UPDATE external_domains SET ns_delegated = ? WHERE id = ?')
    .bind(delegated === true ? 1 : 0, row.id).run();
  const fresh: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?').bind(row.id).first();
  return ok(c, { item: shape(fresh), nsDelegated: delegated, ns: [...EXTERNAL_NS] });
});

/** 移除：只有未批准的申请能删；已批准的域名由站长在根域名管理里处理 */
app.delete('/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const row: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?').bind(id).first();
  if (!row) return fail(c, '记录不存在', 404);
  if (row.user_id !== u.id && u.role !== 'admin') return fail(c, '无权操作该记录', 403);
  if (String(row.status || 'pending') === 'approved') {
    return fail(c, '该域名已获批准，请联系站长在「根域名管理」移除');
  }
  await c.env.DB.prepare('DELETE FROM external_domains WHERE id = ?').bind(id).run();
  try { await audit(c, u.id, 'external_domain.remove', row.fqdn, EXTERNAL_LABEL); } catch {}
  return ok(c, { removed: id });
});

export default app;
