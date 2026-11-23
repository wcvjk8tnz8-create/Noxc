/**
 * 第三方域名接入（外部域名）· 三步流程
 *
 *   1. 提交域名 → 生成 _noxc-verify.<domain> TXT 验证值（状态 pending）
 *   2. 用户在**当前 DNS 服务商**加这条 TXT → 点验证 → 后端用 DoH 查到即 verified
 *   3. 填供应商 API key → 连接（找/建 zone，返回官方 NS）→ 添加 DNS 记录
 *
 * 必须说清的前提：TXT 只证明所有权。记录要真正生效，域名 NS 必须指向
 * 提供 API key 的那家供应商（Cloudflare / DNSHE），这步由用户在注册商完成，
 * 接口返回 ns + note 明确提示，绝不假装「加了 TXT 就能解析」。
 *
 * 与 subdomains 解耦：不参与 publicStats 全表聚合、不占注册配额、不写本站 zone。
 * API key 只在本次请求内存里用，不落库、不写日志、不回传。
 */
import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { matchRoot } from '../lib/roots.js';
import {
  newVerifyToken, verifyHost, verifyValue, checkOwnership,
} from '../lib/externalVerify.js';
import { connectProvider, addRecord, RECORD_TYPES } from '../lib/providerDns.js';

const app = new Hono();
const MAX_PER_USER = 5;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const PROVIDERS = ['cloudflare', 'dnshe'];

/** 统一标签：前端所有出现该域名的地方都用这一份文案，不各写各的 */
export const EXTERNAL_LABEL = '（外部域名）';

/* ───────── 功能状态：即将上线 ─────────
   用户决定先不开放第三方域名接入。实现代码完整保留（TXT 验证 / 供应商 API
   写记录 / 三步流程），但统一闸门让 /api/external-domains 的所有接口都返回
   「即将上线」，避免前端收起表单后接口仍可裸奔写入。
   以后要开放：把 EXTERNAL_DOMAINS_COMING_SOON 改成 false，并把控制台卡片
   换回完整组件即可，无需重写后端。 */
export const EXTERNAL_DOMAINS_COMING_SOON = true;
export const COMING_SOON_MESSAGE = '第三方域名接入即将上线，敬请期待';

app.use('*', async (c, next) => {
  if (!EXTERNAL_DOMAINS_COMING_SOON) return next();
  return fail(c, COMING_SOON_MESSAGE, 503, {
    comingSoon: true,
    label: EXTERNAL_LABEL,
  });
});

function normalize(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '');
}

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
    colsChecked = true;
  } catch { /* 表未建好：后续查询会自然失败，不阻断其它功能 */ }
}

function shape(r: any) {
  const verified = String(r.verify_status || '') === 'verified';
  return {
    id: r.id,
    fqdn: r.fqdn,
    note: r.note || '',
    provider: r.provider || 'dnshe',
    providerKey: r.provider_key || '',
    ns1: r.ns1 || '',
    ns2: r.ns2 || '',
    zoneId: r.zone_id || '',
    createdAt: r.created_at,
    kind: 'external',
    externalLabel: EXTERNAL_LABEL,
    verifyStatus: verified ? 'verified' : 'pending',
    verified,
    // 只回给本人；验证用的 TXT 值不算敏感，但不做公开接口
    verifyHost: verifyHost(String(r.fqdn || '')),
    verifyValue: verifyValue(String(r.verify_token || '')),
    connected: !!(r.provider_key && r.zone_id),
  };
}

async function owned(c: any, id: number) {
  const u = c.get('user');
  const row: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?').bind(id).first();
  if (!row) return null;
  if (row.user_id !== u.id && u.role !== 'admin') return null;
  return row;
}

/** 我的外部域名列表：按 user_id 索引，一次只读本人几行 */
app.get('/', async (c) => {
  await ensureExternalColumns(c.env);
  const u = c.get('user');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM external_domains WHERE user_id = ? ORDER BY id DESC'
  ).bind(u.id).all();
  return ok(c, {
    items: (results || []).map(shape),
    label: EXTERNAL_LABEL,
    max: MAX_PER_USER,
    providers: PROVIDERS,
    recordTypes: RECORD_TYPES,
  });
});

/** 1. 提交域名：只建 pending 记录 + 返回要添加的 TXT，不碰供应商 */
app.post('/', async (c) => {
  await ensureExternalColumns(c.env);
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const domain = normalize(body.domain ?? body.fqdn);
  if (!DOMAIN_RE.test(domain)) return fail(c, '请填写合法的完整域名（如 example.com）');

  // 本站生效后缀下的名字应走注册页，不能冒充外部域名绕过配额 / 暂停规则
  const hit = matchRoot(c.env, domain);
  if (hit) return fail(c, `这是本站后缀 .${hit.domain}，请到注册页申请子域名`);

  const dup = await c.env.DB.prepare('SELECT id FROM external_domains WHERE fqdn = ?').bind(domain).first();
  if (dup) return fail(c, '该外部域名已被登记');

  const cnt: any = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM external_domains WHERE user_id = ?'
  ).bind(u.id).first();
  if (Number(cnt?.n || 0) >= MAX_PER_USER) return fail(c, `每个账号最多登记 ${MAX_PER_USER} 个外部域名`);

  const token = newVerifyToken();
  const note = String(body.note || '').trim().slice(0, 160);
  const res = await c.env.DB.prepare(
    `INSERT INTO external_domains
       (fqdn, user_id, note, provider, ns1, ns2, zone_id,
        verify_token, verify_status, provider_key, created_at)
     VALUES (?, ?, ?, 'dnshe', '', '', '', ?, 'pending', '', ?)`
  ).bind(domain, u.id, note, token, now()).run();

  try { await audit(c, u.id, 'external_domain.add', domain, EXTERNAL_LABEL); } catch {}
  const row: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?')
    .bind(res.meta?.last_row_id).first();
  return ok(c, {
    item: shape(row),
    label: EXTERNAL_LABEL,
    next: '请在你当前的 DNS 服务商添加这条 TXT，然后点「验证所有权」',
  }, 201);
});

/** 2. TXT 所有权验证：DoH 查 _noxc-verify.<domain> */
app.post('/:id/verify', async (c) => {
  await ensureExternalColumns(c.env);
  const row = await owned(c, Number(c.req.param('id')));
  if (!row) return fail(c, '记录不存在或无权操作', 404);
  if (String(row.verify_status || '') === 'verified') {
    return ok(c, { verified: true, item: shape(row), detail: '已验证通过' });
  }
  const r = await checkOwnership(String(row.fqdn), String(row.verify_token || ''));
  if (!r.ok) return ok(c, { verified: false, item: shape(row), detail: r.detail });
  await c.env.DB.prepare(
    "UPDATE external_domains SET verify_status = 'verified', verified_at = ? WHERE id = ?"
  ).bind(now(), row.id).run();
  try { await audit(c, c.get('user').id, 'external_domain.verify', row.fqdn, 'TXT'); } catch {}
  const fresh: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?').bind(row.id).first();
  return ok(c, { verified: true, item: shape(fresh), detail: r.detail });
});

/** 3a. 连接供应商：用本次提供的 API key 找/建 zone，取回官方 NS（key 不落库） */
app.post('/:id/connect', async (c) => {
  await ensureExternalColumns(c.env);
  const row = await owned(c, Number(c.req.param('id')));
  if (!row) return fail(c, '记录不存在或无权操作', 404);
  if (String(row.verify_status || '') !== 'verified') return fail(c, '请先通过 TXT 所有权验证');
  const body = await c.req.json().catch(() => ({}));
  const provider = String(body.provider || '').trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) return fail(c, '请选择 Cloudflare 或 DNSHE');
  const apiKey = String(body.apiKey || '').trim();
  if (!apiKey) return fail(c, '请填写供应商 API key（不会保存）');

  const r: any = await connectProvider(provider, apiKey, String(row.fqdn));
  if (!r?.ok) return fail(c, r?.error || '连接供应商失败');

  const ns = Array.isArray(r.ns) ? r.ns.map(String) : [];
  await c.env.DB.prepare(
    'UPDATE external_domains SET provider = ?, provider_key = ?, zone_id = ?, ns1 = ?, ns2 = ? WHERE id = ?'
  ).bind(provider, provider, String(r.zoneId || ''), ns[0] || '', ns[1] || '', row.id).run();

  const fresh: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?').bind(row.id).first();
  return ok(c, {
    item: shape(fresh), ns, zoneStatus: r.zoneStatus || '', note: r.note || '',
    nsWarning: '请到域名注册商把 NS 改成上方两台；NS 生效前写入的记录不会被全球 DNS 查询',
  });
});

/** 3b. 添加 DNS 记录：必须用已验证域名 + 本次提供的 key */
app.post('/:id/records', async (c) => {
  await ensureExternalColumns(c.env);
  const row = await owned(c, Number(c.req.param('id')));
  if (!row) return fail(c, '记录不存在或无权操作', 404);
  if (String(row.verify_status || '') !== 'verified') return fail(c, '请先通过 TXT 所有权验证');
  const key = String(row.provider_key || '');
  if (!PROVIDERS.includes(key) || !row.zone_id) return fail(c, '请先连接供应商');
  const body = await c.req.json().catch(() => ({}));
  const apiKey = String(body.apiKey || '').trim();
  const rec = {
    type: String(body.type || '').toUpperCase(),
    name: String(body.name || '').trim(),
    content: String(body.content || '').trim(),
    ttl: Number(body.ttl || 3600),
  };
  const r: any = await addRecord(key, apiKey, String(row.fqdn), String(row.zone_id), rec);
  if (!r?.ok) return fail(c, r?.error || '写入记录失败');
  try { await audit(c, c.get('user').id, 'external_domain.record', String(r.name || row.fqdn), String(rec.type)); } catch {}
  return ok(c, {
    record: { id: r.id, name: r.name, type: r.type },
    note: r.note,
    nsWarning: '记录已提交到供应商。若域名 NS 尚未指向该供应商，这条记录暂时不会生效',
  }, 201);
});

/** 移除：只能删自己的 */
app.delete('/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const row: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?').bind(id).first();
  if (!row) return fail(c, '记录不存在', 404);
  if (row.user_id !== u.id && u.role !== 'admin') return fail(c, '无权操作该记录', 403);
  await c.env.DB.prepare('DELETE FROM external_domains WHERE id = ?').bind(id).run();
  try { await audit(c, u.id, 'external_domain.remove', row.fqdn, EXTERNAL_LABEL); } catch {}
  return ok(c, { removed: id });
});

export default app;
