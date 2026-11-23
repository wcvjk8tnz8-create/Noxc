/**
 * 第三方域名接入（外部域名）
 *
 * 允许登记不属于本站生效后缀的完整域名，列表 / WHOIS 一律标「（外部域名）」。
 * 设计上刻意与 subdomains 解耦：
 *   - 不参与 publicStats 的全表聚合（那正是 D1 读取超限的放大器）
 *   - 不占注册配额、不走本站 Cloudflare zone 写 DNS
 *   - 可选填 DNSHE API Token 自动创建解析区域并取回 NS；Token 只在本次请求
 *     使用，绝不落库
 * DNS 记录仍由域名注册商 / DNSHE 管理；需要本站托管时用现有「NS 委派」功能。
 */
import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { matchRoot } from '../lib/roots.js';
import { findProvider, createZoneAtProvider } from '../lib/delegation.js';

const app = new Hono();
const MAX_PER_USER = 5;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** 统一标签：前端所有出现该域名的地方都用这一份文案，不各写各的 */
export const EXTERNAL_LABEL = '（外部域名）';

function normalize(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '');
}

function shape(r: any) {
  return {
    id: r.id,
    fqdn: r.fqdn,
    note: r.note || '',
    provider: r.provider || 'dnshe',
    ns1: r.ns1 || '',
    ns2: r.ns2 || '',
    zoneId: r.zone_id || '',
    createdAt: r.created_at,
    kind: 'external',
    externalLabel: EXTERNAL_LABEL,
  };
}

/** 我的外部域名列表：按 user_id 索引，一次只读本人几行 */
app.get('/', async (c) => {
  const u = c.get('user');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM external_domains WHERE user_id = ? ORDER BY id DESC'
  ).bind(u.id).all();
  return ok(c, { items: (results || []).map(shape), label: EXTERNAL_LABEL, max: MAX_PER_USER });
});

/** 登记外部域名 */
app.post('/', async (c) => {
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

  let ns1 = '', ns2 = '', zoneId = '', zoneNote = '';
  const token = String(body.dnsheToken || '').trim();
  if (token) {
    // Token 只用于这一次 API 调用，不写库、不写日志、不回传
    const r: any = await createZoneAtProvider(findProvider('dnshe'), token, domain);
    if (r?.ok) {
      ns1 = String(r.ns?.[0] || '');
      ns2 = String(r.ns?.[1] || '');
      zoneId = String(r.zoneId || '');
      zoneNote = ns1 ? '已在 DNSHE 创建解析区域，请把 NS 改到下方两台服务器' : '已在 DNSHE 创建解析区域，请到面板查看官方 NS';
    } else {
      zoneNote = `DNSHE 自动建区未成功（${String(r?.error || '未提供有效 Token').slice(0, 160)}）；域名仍已登记，可稍后到服务商面板手动添加`;
    }
  } else {
    zoneNote = '未自动创建解析区域；请到你的域名注册商或 DNSHE 面板添加解析';
  }

  const note = String(body.note || '').trim().slice(0, 160);
  const res = await c.env.DB.prepare(
    `INSERT INTO external_domains (fqdn, user_id, note, provider, ns1, ns2, zone_id, created_at)
     VALUES (?, ?, ?, 'dnshe', ?, ?, ?, ?)`
  ).bind(domain, u.id, note, ns1, ns2, zoneId, now()).run();

  try { await audit(c, u.id, 'external_domain.add', domain, EXTERNAL_LABEL); } catch {}

  const row: any = await c.env.DB.prepare('SELECT * FROM external_domains WHERE id = ?')
    .bind(res.meta?.last_row_id).first();
  return ok(c, { item: shape(row), zoneNote, label: EXTERNAL_LABEL }, 201);
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
