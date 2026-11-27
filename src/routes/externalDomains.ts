/**
 * 第三方域名接入（外部域名）· 站长定的新流程
 * ──────────────────────────────────────────────────────────────────────
 *   ① 用户填自己拥有的完整域名（只允许 gTLD 二级域，拒绝 xxx.example.com）
 *   ② 域名固定托管到 SEUS DNS：NS 指向 a.ns.fs5.net / b.ns.fs5.net
 *   ③ 用 SEUS 的 API 连接（站点级 MCP Token 优先；用户也可临时填自己的，
 *      仅本次请求使用、绝不落库），查到该域名的托管区域与 zone id
 *   ④ 站长在「站点设置 → 第三方域名接入」看到申请，批准后才生效
 *   ⑤ 批准后该域名成为根域名，DNS 后端锁死 SEUS（下拉不可切换）
 *
 * 与旧流程的区别：不再做 TXT 所有权验证、不再让用户选 Cloudflare / DNSHE /
 * AnyNS、不再由用户在前端写记录。权属链由「SEUS 账号里真实存在托管区域 +
 * 注册商 NS 指向 SEUS + 站长人工批准」三道关构成。
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
  EXTERNAL_DNS_PROVIDER, EXTERNAL_DNS_LABEL, EXTERNAL_NS, EXTERNAL_MAX_PER_USER,
  EXTERNAL_FLOW_HINT, GTLD_SET,
  normalizeExternalDomain, validateExternalDomain,
} from '../lib/externalDomainPolicy.js';

const app = new Hono();

/** 统一标签：前端所有出现该域名的地方都用这一份文案 */
export const EXTERNAL_LABEL = '（外部域名）';

/* 旧库列补齐：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列。
   模块级缓存，PRAGMA 只在每个 isolate 首次请求时跑一次。 */
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
  } catch { /* 表未建好：后续查询会自然失败，不阻断其它功能 */ }
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
  const res = await c.env.DB.prepare(
    `INSERT INTO external_domains
       (fqdn, user_id, note, provider, ns1, ns2, zone_id,
        status, connected_at, ns_delegated, api_source, created_at)
     VALUES (?, ?, ?, 'seus', ?, ?, '', 'pending', 0, 0, '', ?)`
  ).bind(v.domain, u.id, note, EXTERNAL_NS[0], EXTERNAL_NS[1], now()).run();

  try { await audit(c, u.id, 'external_domain.add', v.domain, EXTERNAL_LABEL); } catch {}
  const row: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?')
    .bind(res.meta?.last_row_id).first();
  return ok(c, {
    item: shape(row),
    label: EXTERNAL_LABEL,
    ns: [...EXTERNAL_NS],
    next: `请到注册商把 NS 改为 ${EXTERNAL_NS.join(' / ')}，并在 s.eus 完成 DNS 托管，然后点「用 API 连接」`,
    nsWarning: 'NS 未生效前，即使站长批准，写入的记录也不会被全球 DNS 查询',
  }, 201);
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
