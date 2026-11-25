import { listRoots, normalizeDomain } from '../lib/roots.js';
import { serializeRootCosts, parseRootCosts } from '../lib/points.js';
import { Hono } from 'hono';
import { ok, fail, now, audit, defaultQuotaOf, parseDefaultQuota } from '../lib/util.js';
import { notify } from '../lib/notify.js';
import { cfDelete, cfErrorMessage } from '../lib/cf.js';
import { UNLIMITED } from '../middleware/auth.js';
import { ensurePoints, addPoints } from '../lib/points.js';
import { pointRules } from './points.js';
import { COMBO_REWARD_CAP } from '../lib/pointDefaults.js';
import { expiryRules, computeExpiry, expiryState, renewExpiry, ensureExpiryColumns, migrateLegacyPerpetual } from '../lib/expiry.js';
import { clearDnsProviderCache, dnsProvider } from '../lib/cf.js';
import { spaceshipConfig, spaceshipEnabled, listSpaceshipDomains, testSpaceship } from '../lib/spaceship.js';
import { addExtraRoots, removeRoot, restoreRoot, rootSources, effectiveRootList, setDnsBackend } from '../lib/rootStore.js';
import { aiTest, probeAiModels, chooseModel, loadAiConfig, AGNES_CHAT_MODELS, rootInAiList, endpointCandidates,
  normalizeProvider, WORKERS_AI_MODELS, DEFAULT_WORKERS_AI_MODEL } from '../lib/aiReview.js';
import { runAiReviewBatch, aiBatchStatus, queueAiBatch, startAiBatch } from '../lib/aiBatch.js';
import { EMAIL_RULES, emailRuleOf, type EmailRule } from '../lib/emailRule.js';
import { DEFAULT_FOOTER_ICP_HTML } from '../lib/footerIcp.js';
import { DEFAULT_FOOTER_CONTACT_HTML } from '../lib/footerContact.js';
import { normalizeReservedExtra, reservedOverview } from '../lib/reserved.js';
import { nodelocConfig, maskSecret, NODELOC_CALLBACK_PATH, httpsCallbackUrl } from '../lib/nodeloc.js';
import { githubConfig, GITHUB_CALLBACK_PATH, httpsCallbackUrl as ghCallbackUrl,
         normalizeStarRepo, DEFAULT_STAR_REPO, DEFAULT_STAR_BONUS } from '../lib/github.js';
import { parseRootRegLimits, serializeRootRegLimits } from '../lib/rootLimits.js';
import { parsePausedRoots, serializePausedRoots } from '../lib/applyGate.js';
import { invalidateSettings } from '../lib/settingsCache.js';
import { clearAnynsConfigCache, anynsTokenSource,
         anynsAdminFetchDomains, anynsAdminAddRoots } from '../lib/anynsBackend.js';

const app = new Hono();

// 概览统计
app.get('/stats', async (c) => {
  const q = async (sql, ...b) => (await c.env.DB.prepare(sql).bind(...b).first()) || {};
  const [users, subs, pending, recs, locked] = await Promise.all([
    q('SELECT COUNT(*) AS n FROM users'),
    q("SELECT COUNT(*) AS n FROM subdomains WHERE status = 'approved'"),
    q("SELECT COUNT(*) AS n FROM subdomains WHERE status = 'pending'"),
    q('SELECT COUNT(*) AS n FROM dns_records'),
    q('SELECT COUNT(*) AS n FROM dns_records WHERE verify_lock = 1'),
  ]);
  return ok(c, {
    users: users.n || 0,
    subdomains: subs.n || 0,
    pending: pending.n || 0,
    records: recs.n || 0,
    locked: locked.n || 0,
    rootDomain: c.env.ROOT_DOMAIN,
    rootDomains: listRoots(c.env),
    mock: c.env.CF_MOCK === '1',
  });
});

// 子域名列表（可按状态过滤）
app.get('/subdomains', async (c) => {
  const status = c.req.query('status') || '';
  const sql =
    `SELECT s.*, u.email AS owner_email, (SELECT COUNT(*) FROM dns_records r WHERE r.subdomain_id = s.id) AS record_count
     FROM subdomains s JOIN users u ON u.id = s.user_id
     ${status ? 'WHERE s.status = ?' : ''}
     ORDER BY s.created_at DESC LIMIT 500`;
  const stmt = status ? c.env.DB.prepare(sql).bind(status) : c.env.DB.prepare(sql);
  const { results } = await stmt.all();
  return ok(c, { items: results });
});

// 审核：通过 / 驳回 / 停用 / 恢复
async function review(c, id, status, reason) {
  await ensureExpiryColumns(c.env);
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return fail(c, '子域名不存在', 404);
  const u = c.get('user');
  let extra = '';

  // 批准 → 设置 1 年有效期（永久域名除外）
  if (status === 'approved') {
    const rules = await expiryRules(c.env);
    const exp = Number(sub.perpetual) === 1
      ? null
      : computeExpiry({ perpetual: false, validDays: rules.validDays });
    await c.env.DB.prepare(
      'UPDATE subdomains SET status = ?, reason = ?, expires_at = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?'
    )
      .bind(status, reason || null, exp, now(), u.id, now(), id)
      .run();
    if (exp) extra = `有效期 ${rules.validDays} 天`;

    /* 通知申请人：审核通过（铃铛） */
    await notify(
      c.env,
      sub.user_id,
      'domain_approved',
      '域名审核已通过',
      `你的域名 ${sub.fqdn} 已审核通过并开通${exp ? `，有效期 ${rules.validDays} 天` : '（永久有效）'}。快去添加 DNS 记录吧。`,
      '/domain.html?id=' + id
    );

    /* 单域名队列：同一用户短时间内提交多个申请时，只批准这一个，
       其余 pending 自动驳回（防止并发/绕过导致一人占多个待审名额）。 */
    const others = await c.env.DB
      .prepare("SELECT id, fqdn FROM subdomains WHERE user_id = ? AND status = 'pending' AND id <> ?")
      .bind(sub.user_id, id)
      .all();
    const list = others.results || [];
    if (list.length) {
      const msg = '同一时间只能有一个待审核申请，其余已自动驳回';
      for (const o of list) {
        await c.env.DB.prepare(
          "UPDATE subdomains SET status = 'rejected', reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?"
        )
          .bind(msg, now(), u.id, now(), o.id)
          .run();
        await audit(c, u.id, 'subdomain.rejected', o.fqdn, msg);
      }
      extra += (extra ? ' · ' : '') + `自动驳回同批 ${list.length} 个申请`;
    }
  } else {
    await c.env.DB.prepare(
      'UPDATE subdomains SET status = ?, reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?'
    )
      .bind(status, reason || null, now(), u.id, now(), id)
      .run();

    // 驳回 / 停用 → 通知申请人并说明原因
    await notify(
      c.env,
      sub.user_id,
      'domain_approved',
      status === 'rejected' ? '域名申请被驳回' : '域名已被停用',
      `你的域名 ${sub.fqdn} ${status === 'rejected' ? '未通过审核' : '已被管理员停用'}。${reason ? '原因：' + reason : ''}如有疑问可提交工单。`,
      '/dashboard.html'
    );
  }

  await audit(c, u.id, `subdomain.${status}`, sub.fqdn, [reason, extra].filter(Boolean).join(' · '));
  return ok(c, { status, extra });
}

app.post('/subdomains/:id/approve', async (c) => review(c, Number(c.req.param('id')), 'approved', ''));
app.post('/subdomains/:id/reject', async (c) => {
  const { reason } = await c.req.json().catch(() => ({}));
  return review(c, Number(c.req.param('id')), 'rejected', String(reason || '').slice(0, 200) || '不符合使用规范');
});
app.post('/subdomains/:id/suspend', async (c) => {
  const { reason } = await c.req.json().catch(() => ({}));
  return review(c, Number(c.req.param('id')), 'suspended', String(reason || '').slice(0, 200) || '违规使用');
});
app.post('/subdomains/:id/restore', async (c) => review(c, Number(c.req.param('id')), 'approved', ''));

// 管理员直接删除子域名（连带清空 DNS）
app.delete('/subdomains/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return fail(c, '子域名不存在', 404);
  const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(id).all();
  for (const r of recs.results) if (r.cf_record_id) await cfDelete(c.env, r.cf_record_id, sub.fqdn || sub.root_domain);
  await c.env.DB.prepare('DELETE FROM dns_records WHERE subdomain_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM subdomains WHERE id = ?').bind(id).run();
  await audit(c, u.id, 'admin.subdomain.delete', sub.fqdn);
  return ok(c, {});
});

// 用户列表
app.get('/users', async (c) => {
  await ensureExpiryColumns(c.env);
  await migrateLegacyPerpetual(c.env);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, u.quota, u.ban_reason, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM subdomains s WHERE s.user_id = u.id AND s.status <> 'rejected') AS sub_count,
            (SELECT COUNT(*) FROM subdomains s WHERE s.user_id = u.id AND s.status = 'rejected') AS rejected_count,
            (SELECT points FROM user_points p WHERE p.user_id = u.id) AS points
     FROM users u ORDER BY u.created_at DESC LIMIT 500`
  ).all();
  const items = results.map((r) => ({
    ...r,
    quotaUnlimited: r.role === 'admin' || Number(r.quota) < 0,
    points: r.role === 'admin' ? -1 : (r.points ?? null),
  }));
  return ok(c, { items });
});

// 调整用户积分（delta 为增减，或设置 setPoints；-1 表示无限）
app.post('/users/:id/points', async (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  const { delta, set: setValue, reason } = await c.req.json().catch(() => ({}));

  const target = await c.env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(id).first();
  if (!target) return fail(c, '用户不存在', 404);
  if (target.role === 'admin') return fail(c, '管理员积分不限，无需调整');

  const rules = await pointRules(c.env);
  let after;
  if (setValue !== undefined && setValue !== null && setValue !== '') {
    const n = Number(setValue);
    if (!Number.isFinite(n) && n !== -1) return fail(c, '积分数值不合法');
    const cur = await ensurePoints(c.env.DB, id, rules);
    after = await addPoints(c.env.DB, id, n - cur, 'admin_set', String(reason || '管理员设置'));
  } else {
    const d = Number(delta);
    if (!Number.isFinite(d)) return fail(c, '请提供 delta 或 set');
    await ensurePoints(c.env.DB, id, rules);
    after = await addPoints(c.env.DB, id, Math.trunc(d), 'admin_adjust', String(reason || '管理员调整'));
  }
  await audit(c, me.id, 'admin.points', target.email, `调整为 ${after}`);
  return ok(c, { points: after });
});

// 封禁 / 解封
app.post('/users/:id/ban', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { reason, purgeDns } = await c.req.json().catch(() => ({}));
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) return fail(c, '用户不存在', 404);
  if (target.role === 'admin') return fail(c, '不能封禁管理员');

  await c.env.DB.prepare('UPDATE users SET status = ?, ban_reason = ? WHERE id = ?')
    .bind('banned', String(reason || '违规使用').slice(0, 300), id)
    .run();
  // 踢下线
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  // 停用其全部子域名
  await c.env.DB.prepare("UPDATE subdomains SET status = 'suspended', reason = ?, updated_at = ? WHERE user_id = ?")
    .bind(String(reason || '账号已封禁').slice(0, 200), now(), id)
    .run();

  let purged = 0;
  if (purgeDns) {
    const subs = await c.env.DB.prepare('SELECT id, fqdn, root_domain FROM subdomains WHERE user_id = ?').bind(id).all();
    for (const s of subs.results) {
      const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(s.id).all();
      for (const r of recs.results) {
        if (r.cf_record_id) {
          const res = await cfDelete(c.env, r.cf_record_id, s.fqdn || s.root_domain);
          if (!res.ok) continue;
        }
        purged++;
      }
      await c.env.DB.prepare('DELETE FROM dns_records WHERE subdomain_id = ?').bind(s.id).run();
    }
  }
  await audit(c, u.id, 'user.ban', target.email, `${reason || ''}｜清空DNS:${purged}`);
  return ok(c, { purged });
});

app.post('/users/:id/unban', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare("UPDATE users SET status = 'active', ban_reason = NULL WHERE id = ?").bind(id).run();
  await c.env.DB.prepare(
    "UPDATE subdomains SET status = 'approved', reason = NULL, updated_at = ? WHERE user_id = ? AND status = 'suspended'"
  )
    .bind(now(), id)
    .run();
  await audit(c, u.id, 'user.unban', String(id));
  return ok(c, {});
});

// 调整配额 / 提权
app.post('/users/:id/quota', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { quota, role } = await c.req.json().catch(() => ({}));
  if (quota !== undefined) {
    const q = Number(quota);
    // -1 表示不限量
    if (!Number.isFinite(q) || q < -1 || q > 10000) return fail(c, '配额需在 -1（不限）到 10000 之间');
    await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?').bind(q === -1 ? -1 : Math.floor(q), id).run();
  }
  if (role !== undefined) {
    if (!['user', 'admin'].includes(role)) return fail(c, '角色不合法');
    await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run();
    // 提为管理员时自动给不限量；降为普通用户时若原本是不限量，恢复默认配额
    if (role === 'admin') {
      await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?').bind(UNLIMITED, id).run();
    } else {
      const cur = await c.env.DB.prepare('SELECT quota FROM users WHERE id = ?').bind(id).first();
      if (cur && Number(cur.quota) < 0) {
        await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?')
          .bind(await defaultQuotaOf(c.env), id)
          .run();
      }
    }
  }
  await audit(c, u.id, 'user.update', String(id), `quota=${quota} role=${role}`);
  return ok(c, {});
});

// 全部处于锁定状态的验证记录
app.get('/locks', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, s.fqdn, s.status AS sub_status, u.email AS owner_email
     FROM dns_records r
     JOIN subdomains s ON s.id = r.subdomain_id
     JOIN users u ON u.id = r.locked_by
     WHERE r.verify_lock = 1 ORDER BY r.locked_at DESC`
  ).all();
  return ok(c, { items: results });
});

// 审计日志
app.get('/audit', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT 200`
  ).all();
  return ok(c, { items: results });
});

// 手动对账：从 Cloudflare 拉取某子域名的记录，清理本地孤儿记录
app.post('/reconcile/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return fail(c, '子域名不存在', 404);
  const errs = [];
  const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(id).all();
  for (const r of recs.results) {
    if (!r.cf_record_id) {
      await c.env.DB.prepare('DELETE FROM dns_records WHERE id = ?').bind(r.id).run();
      errs.push(`${r.name} 缺少 Cloudflare ID，已清理本地记录`);
    }
  }
  await audit(c, u.id, 'admin.reconcile', sub.fqdn, errs.join(' | '));
  return ok(c, { warnings: errs });
});

// 按 IP 聚合账号（用于发现同一网络下的批量注册）
app.get('/ips', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.ip AS ip,
            COUNT(DISTINCT r.user_id) AS accounts,
            MAX(r.created_at) AS last_at,
            GROUP_CONCAT(DISTINCT u.email) AS emails,
            SUM(CASE WHEN u.status = 'banned' THEN 1 ELSE 0 END) AS banned_count
     FROM registrations r LEFT JOIN users u ON u.id = r.user_id
     WHERE r.ip IS NOT NULL AND r.ip <> ''
     GROUP BY r.ip
     ORDER BY accounts DESC, last_at DESC LIMIT 300`
  ).all();
  const limitRow = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'max_accounts_per_ip'").first();
  const bannedIps = await c.env.DB.prepare('SELECT ip, reason FROM ip_bans').all();
  const bannedMap = Object.fromEntries((bannedIps.results || []).map((b) => [b.ip, b.reason]));
  return ok(c, {
    items: results.map((r) => ({
      ...r,
      emails: r.emails || '',
      overLimit: r.accounts > Number(limitRow?.value || 2),
      ipBanned: bannedMap[r.ip] !== undefined,
      ipBanReason: bannedMap[r.ip] || '',
    })),
    limit: Number(limitRow?.value || 2),
  });
});

// 一键封禁：该 IP 下的全部账号（并可选加入 IP 封禁名单）
app.post('/ips/ban', async (c) => {
  const u = c.get('user');
  const { ip, reason, banIp, purgeDns } = await c.req.json().catch(() => ({}));
  const target = String(ip || '').trim();
  if (!target) return fail(c, '缺少 IP');

  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT r.user_id AS id, u.email FROM registrations r
     JOIN users u ON u.id = r.user_id WHERE r.ip = ? AND u.role <> 'admin'`
  )
    .bind(target)
    .all();

  const list = rows.results || [];
  if (!list.length) return fail(c, '该 IP 下没有可封禁的账号');

  const why = String(reason || '').trim() || `同一 IP 注册账号超限（${list.length} 个）`;
  let purged = 0;

  for (const row of list) {
    await c.env.DB.prepare("UPDATE users SET status = 'banned', ban_reason = ? WHERE id = ?")
      .bind(why, row.id)
      .run();
    // 踢下线
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id).run();
    // 停用其全部子域名
    await c.env.DB.prepare("UPDATE subdomains SET status = 'suspended', reason = ? WHERE user_id = ?")
      .bind(why, row.id)
      .run();

    if (purgeDns) {
      const recs = await c.env.DB.prepare(
        `SELECT r.id, r.cf_record_id, s.fqdn, s.root_domain FROM dns_records r
         JOIN subdomains s ON s.id = r.subdomain_id WHERE s.user_id = ?`
      )
        .bind(row.id)
        .all();
      for (const r of recs.results || []) {
        await cfDelete(c.env, r.cf_record_id, r.fqdn || r.root_domain);
        await c.env.DB.prepare('DELETE FROM dns_records WHERE id = ?').bind(r.id).run();
        purged++;
      }
    }
    await audit(c, row.id, 'user.ban', row.email, why);
  }

  if (banIp !== false) {
    await c.env.DB.prepare(
      'INSERT INTO ip_bans (ip, reason, created_by, created_at) VALUES (?,?,?,?) ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason'
    )
      .bind(target, why, u.id, now())
      .run();
  }

  await audit(c, u.id, 'admin.ip_ban', target, `封禁 ${list.length} 个账号 · ${why}${purgeDns ? ` · 清空 ${purged} 条 DNS` : ''}`);
  return ok(c, { banned: list.length, emails: list.map((x) => x.email), purged });
});

// 解除 IP 封禁
app.post('/ips/unban', async (c) => {
  const u = c.get('user');
  const { ip } = await c.req.json().catch(() => ({}));
  const target = String(ip || '').trim();
  if (!target) return fail(c, '缺少 IP');
  await c.env.DB.prepare('DELETE FROM ip_bans WHERE ip = ?').bind(target).run();
  await audit(c, u.id, 'admin.ip_unban', target, '');
  return ok(c, {});
});

// 站点设置：站点名 / Logo / 公告
app.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all();
  const raw = Object.fromEntries(results.map((r) => [r.key, r.value]));

  // 敏感项：不回传明文，只回传「是否已配置 + 尾号」，前端显示为占位符
  const SENSITIVE = ['dnshe_api_key', 'dnshe_api_secret', 'dns_api_key', 'dns_api_secret', 'mail_api_key', 'spaceship_api_key', 'spaceship_api_secret', 'ai_api_key', 'nodeloc_client_secret', 'github_client_secret', 'anyns_api_token'];
  const items = { ...raw };
  for (const k of SENSITIVE) delete items[k];
  // 未配置过时把默认备案号回填到输入框，避免「页脚明明有、后台却是空的」
  if (raw.footer_icp_html === undefined) items.footer_icp_html = DEFAULT_FOOTER_ICP_HTML;
  // 未配置过时把默认联系方式回填到输入框，避免「页脚明明有、后台却是空的」
  if (raw.footer_contact_html === undefined) items.footer_contact_html = DEFAULT_FOOTER_CONTACT_HTML;
  // 老库没跑新迁移时，显示实际生效值（环境变量或内置 5），不显示空白
  if (raw.default_quota === undefined) items.default_quota = String(parseDefaultQuota(c.env.DEFAULT_QUOTA));
  // 未配置「额外保留域名」时输入框留空（基线名单由代码保证，不需要在这里重复填）
  if (raw.reserved_labels === undefined) items.reserved_labels = '';
  // 滑块验证：老库没跑新迁移时显示实际生效的默认值（默认开启 + 四张图）
  if (raw.captcha_enabled === undefined) items.captcha_enabled = '1';
  if (raw.captcha_images === undefined) items.captcha_images = 'typhoon,meoy,miku,cloud';
  // NodeLoc 第三方登录：老库没跑新迁移时显示实际生效值，不显示空白
  if (raw.nodeloc_enabled === undefined) items.nodeloc_enabled = '0';
  if (raw.nodeloc_client_id === undefined) items.nodeloc_client_id = '';
  if (raw.nodeloc_auto_register === undefined) items.nodeloc_auto_register = '1';
  if (raw.nodeloc_scope_email === undefined) items.nodeloc_scope_email = '1';
  if (raw.nodeloc_redirect_uri === undefined) items.nodeloc_redirect_uri = '';
  // GitHub 第三方登录：老库没跑新迁移时显示实际生效值，不显示空白
  if (raw.github_enabled === undefined) items.github_enabled = '0';
  if (raw.github_client_id === undefined) items.github_client_id = '';
  if (raw.github_auto_register === undefined) items.github_auto_register = '1';
  if (raw.github_redirect_uri === undefined) items.github_redirect_uri = '';
  if (raw.github_star_repo === undefined) items.github_star_repo = DEFAULT_STAR_REPO;
  if (raw.github_star_bonus === undefined) items.github_star_bonus = String(DEFAULT_STAR_BONUS);

  const mask = (v) => {
    const s = String(v || '');
    if (!s) return '';
    return '••••••••' + s.slice(-4);
  };
  const nodeloc = await nodelocConfig(c.env);
  const github = await githubConfig(c.env);

  // 自定义 DNS 提供商状态（URL 可回显，Key/Secret 只给掩码）
  const prov = await dnsProvider(c.env);
  const envDnsUrl = String(c.env.DNS_API_URL || '').trim();
  const envDnsKey = String(c.env.DNS_API_KEY || '').trim();
  const envDnsSecret = String(c.env.DNS_API_SECRET || '').trim();
  const envKey = String(c.env.DNSHE_API_KEY || '').trim();
  const envSecret = String(c.env.DNSHE_API_SECRET || '').trim();
  return ok(c, {
    items,
    // 注册邮箱规则（后台可切换；环境变量 EMAIL_RULE 可覆盖默认值）
    emailRule: await emailRuleOf(c.env),
    emailRules: [...EMAIL_RULES],
    dnsProvider: {
      custom: prov.custom,
      url: prov.custom ? prov.base : '',
      fromEnv: !!envDnsUrl,
      keySet: !!(raw.dns_api_key || envDnsKey),
      secretSet: !!(raw.dns_api_secret || envDnsSecret),
      keyMasked: mask(raw.dns_api_key || envDnsKey),
      secretMasked: mask(raw.dns_api_secret || envDnsSecret),
    },
    // 邮件与验证码配置（API Key 只回掩码）
    mail: {
      provider: String(raw.mail_provider || c.env.MAIL_PROVIDER || '').trim(),
      from: String(raw.mail_from || c.env.MAIL_FROM || '').trim(),
      keySet: !!(raw.mail_api_key || String(c.env.MAIL_API_KEY || '').trim()),
      keyMasked: mask(raw.mail_api_key || String(c.env.MAIL_API_KEY || '').trim()),
      fromEnv: !!(String(c.env.MAIL_PROVIDER || '').trim() && String(c.env.MAIL_API_KEY || '').trim()),
      verifyRequired: String(raw.mail_verify_required || c.env.MAIL_VERIFY_REQUIRED || '0').trim() === '1',
      enabled: !!(String(raw.mail_provider || c.env.MAIL_PROVIDER || '').trim()
        && (raw.mail_api_key || String(c.env.MAIL_API_KEY || '').trim())
        && String(raw.mail_from || c.env.MAIL_FROM || '').trim()),
    },
    // Spaceship 域名注册商（Key/Secret 只回掩码）
    spaceship: {
      url: String(raw.spaceship_api_url || c.env.SPACESHIP_API_URL || '').trim(),
      keySet: !!(raw.spaceship_api_key || String(c.env.SPACESHIP_API_KEY || '').trim()),
      secretSet: !!(raw.spaceship_api_secret || String(c.env.SPACESHIP_API_SECRET || '').trim()),
      keyMasked: mask(raw.spaceship_api_key || String(c.env.SPACESHIP_API_KEY || '').trim()),
      secretMasked: mask(raw.spaceship_api_secret || String(c.env.SPACESHIP_API_SECRET || '').trim()),
      fromEnv: !!(String(c.env.SPACESHIP_API_KEY || '').trim() && String(c.env.SPACESHIP_API_SECRET || '').trim()),
      enabled: !!(String(raw.spaceship_api_url || c.env.SPACESHIP_API_URL || '').trim()
        && (raw.spaceship_api_key || String(c.env.SPACESHIP_API_KEY || '').trim())
        && (raw.spaceship_api_secret || String(c.env.SPACESHIP_API_SECRET || '').trim())),
    },
    // 当前生效的根域名（含后台导入的）
    rootDomains: listRoots(c.env).map((r) => r.domain),
    // 按根域名的积分覆盖（0 = 免费；未列出的后缀按全局规则）
    rootPointCosts: parseRootCosts(raw.root_point_costs),
    // 按根域名「每人注册次数」（-1 = 无限；留空 = 不限制）
    rootRegLimits: parseRootRegLimits(raw.root_reg_limits),
    // 按后缀单独暂停新申请（只拦新建，已注册域名全部不受影响）
    rootApplyPaused: parsePausedRoots([String(c.env.ROOT_APPLY_PAUSED || ''), raw.root_apply_paused].join(',')),
    rootApplyPausedFromEnv: parsePausedRoots(c.env.ROOT_APPLY_PAUSED || '').length > 0,
    // 域名有效期 / 续期窗口（renewWindowAuto=true 时后台输入框留空）
    // 以前误放在 secrets 里，前端读 d.expiry 一直是 undefined，输入框永远显示 HTML 写死的 365/180，
    // 一点保存就把旧值写回数据库覆盖真实配置 —— 必须放在顶层。
    expiry: await expiryRules(c.env),
    // 系统保留名称：base 是代码基线（不可删），extra 是后台追加，effective 为最终生效
    reserved: await reservedOverview(c.env),

    // AI 自动审核（自定义 OpenAI 兼容网关 / Workers AI）
    ai: {
      enabled: String(raw.ai_review_enabled || '1').trim() === '1',
      roots: String(raw.ai_review_roots || 'v-1.top').trim(),
      provider: normalizeProvider(raw.ai_provider || c.env.AI_PROVIDER),
      workersAiAvailable: !!c.env.AI && typeof c.env.AI.run === 'function',
      workersAiModels: [...WORKERS_AI_MODELS],
      url: String(raw.ai_api_url || c.env.AI_API_URL || 'https://apihub.agnes-ai.com/v1').trim(),
      model: String(raw.ai_model || c.env.AI_MODEL || '').trim(),
      modelSelected: !!String(raw.ai_model || c.env.AI_MODEL || '').trim(),
      keySet: !!(raw.ai_api_key || String(c.env.AI_API_KEY || '').trim()),
      endpoint: String(raw.ai_api_endpoint || c.env.AI_API_ENDPOINT || '').trim(),
      mode: ['auto','direct','standard'].includes(String(raw.ai_endpoint_mode || '').trim())
        ? String(raw.ai_endpoint_mode).trim() : 'auto',
      keyMasked: mask(raw.ai_api_key || String(c.env.AI_API_KEY || '').trim()),
      fromEnv: !!String(c.env.AI_API_KEY || '').trim(),
      ready: !!(raw.ai_api_key || String(c.env.AI_API_KEY || '').trim()),
      dnsUnlimitedRoots: String(raw.dns_unlimited_roots || 'v-1.top').trim(),
    },

    // 新域名申请开关
    applyPaused: String(raw.apply_paused || c.env.APPLY_PAUSED || '').trim() === '1',
    applyPausedFromEnv: String(c.env.APPLY_PAUSED || '').trim() === '1',
    applyPausedMessage: String(raw.apply_paused_message || '').trim(),

    // NodeLoc 第三方登录：Secret 只回掩码，不下发明文；callbackUrl 供管理员
    // 直接复制到 NodeLoc 应用管理页（必须逐字符一致，否则授权会被拒）
    nodeloc: {
      enabled: nodeloc.switchedOn,
      ready: nodeloc.enabled,
      clientId: nodeloc.clientId,
      secretSet: !!nodeloc.clientSecret,
      secretMasked: maskSecret(nodeloc.clientSecret),
      autoRegister: nodeloc.autoRegister,
      scopeEmail: nodeloc.scopeEmail,
      fromEnv: nodeloc.fromEnv,
      callbackPath: NODELOC_CALLBACK_PATH,
      // 必须是 https：NodeLoc 应用管理页只登记 HTTPS 回调，逐字符一致才不会被拒
      callbackUrl: httpsCallbackUrl(c),
      redirectUri: nodeloc.redirectUri,
    },

    // GitHub 第三方登录 + Star 配额奖励：Secret 只回掩码，不下发明文
    github: {
      enabled: github.switchedOn,
      ready: github.enabled,
      clientId: github.clientId,
      secretSet: !!github.clientSecret,
      secretMasked: maskSecret(github.clientSecret),
      autoRegister: github.autoRegister,
      fromEnv: github.fromEnv,
      callbackPath: GITHUB_CALLBACK_PATH,
      callbackUrl: ghCallbackUrl(c),
      redirectUri: github.redirectUri,
      starRepo: github.starRepo,
      starBonus: github.starBonus,
      scope: github.scope,
    },

    // R2 头像公网地址（留空则用 Worker 代理 /api/avatar/<key>）
    r2PublicUrl: String(raw.r2_public_url || c.env.R2_PUBLIC_URL || '').trim(),
    r2FromEnv: !!String(c.env.R2_PUBLIC_URL || '').trim(),
    secrets: {
      dnsheApiKeySet: !!(raw.dnshe_api_key || envKey),
      dnsheApiSecretSet: !!(raw.dnshe_api_secret || envSecret),
      dnsheApiKeyMasked: mask(raw.dnshe_api_key || envKey),
      dnsheApiSecretMasked: mask(raw.dnshe_api_secret || envSecret),
      fromEnv: !!(envKey && envSecret),   // 来自环境变量时后台不可改
    },

    /* AnyNS（n.ht 社区）站点级管理令牌：后台可填，Worker Secret 优先。
       只回掩码 / 布尔，绝不回明文；公开 /api/config 完全不含这一项。 */
    anyns: {
      tokenSet: !!(raw.anyns_api_token || String(c.env.ANYNS_API_TOKEN || '').trim()),
      tokenMasked: mask(raw.anyns_api_token || String(c.env.ANYNS_API_TOKEN || '').trim()),
      fromEnv: anynsTokenSource(c.env, raw.anyns_api_token) === 'env',
      source: anynsTokenSource(c.env, raw.anyns_api_token),
      roots: String(raw.anyns_roots || c.env.ANYNS_ROOTS || c.env.ROOT_DOMAIN || '').trim(),
      zoneId: String(raw.anyns_zone_id || c.env.ANYNS_ZONE_ID || '').trim(),
      zoneIds: String(raw.anyns_zone_ids || c.env.ANYNS_ZONE_IDS || '').trim(),
      ready: !!(raw.anyns_api_token || String(c.env.ANYNS_API_TOKEN || '').trim()),
      // 迁移期的「暂停解析」也在这里管：清空名单即一次性恢复，不用改数据库
      dnsPausedRoots: raw.dns_paused_roots === undefined ? 'meoy.top' : String(raw.dns_paused_roots || ''),
      migrationNotice: String(raw.dns_migration_notice || '').trim(),
    },
  });
});

/* AI 模型探测：填好地址与 Key 后自动拉取 /models，并自动选定一个模型。
   body 可带「尚未保存」的 aiUrl / aiApiKey 用于即时探测；响应不回传任何密钥。 */
app.post('/ai-models', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const blank = { selected: '', autoPicked: false, inList: false };
  try {
    const typedProvider = body.aiProvider !== undefined
      ? normalizeProvider(body.aiProvider) : undefined;
    const p = await probeAiModels(c.env, {
      base: String(body.aiUrl || '').trim(),
      key: String(body.aiApiKey || '').trim(),
      provider: typedProvider,
    });
    let choice = blank;
    if (p.ok) choice = await chooseModel(c.env, p.models, typedProvider);
    const isWorkers = p.source === 'workers-ai'
      || normalizeProvider(typedProvider || '') === 'workers-ai';
    await audit(c, c.get('user')?.id, 'admin.ai-models', 'ai',
      `${p.source === 'gateway' ? '网关清单' : '内置清单'} · ${p.models.length} 个模型 · 选用 ${choice.selected || '（未选）'}`);
    return ok(c, {
      ok: p.ok, models: p.models, message: p.message, detail: p.detail,
      source: p.source, attempts: p.attempts,
      chatModels: isWorkers ? WORKERS_AI_MODELS : AGNES_CHAT_MODELS,
      provider: isWorkers ? 'workers-ai' : 'custom',
      selected: choice.selected, autoPicked: choice.autoPicked, inList: choice.inList,
    });
  } catch (e) {
    return ok(c, {
      ok: false, models: [], message: '模型探测异常',
      detail: String((e as Error)?.message || e).slice(0, 200), ...blank,
      source: 'catalog', attempts: [], chatModels: AGNES_CHAT_MODELS,
    });
  }
});

/* 一键诊断：一次讲清 Key / 地址 / 端点 / 模型 / 实际调用各自的状态。
   会把网关 /models 的真实清单列出来，便于核对管理员填的模型名大小写。 */
app.post('/ai-diagnose', async (c) => {
  try {
    const cfg = await loadAiConfig(c.env);
    // Workers AI 的「探测」是返回内置清单，不发任何网络请求，因此即使
    // binding 缺失也照常跑，好把「绑定缺失」和「模型清单」都列出来。
    const probe = (cfg.configured || cfg.provider === 'workers-ai')
      ? await probeAiModels(c.env) : null;
    const test = cfg.configured ? await aiTest(c.env) : null;
    const isWorkers = cfg.provider === 'workers-ai';
    const allRoots = listRoots(c.env).map((r) => r.domain);
    const MODE_TEXT: Record<string, string> = {
      auto: '自动（先直连地址本身，失败回落子路径）',
      direct: '强制直连（不调用 /chat/completions）',
      standard: '标准 OpenAI（/chat/completions）',
    };
    const providerLines = isWorkers ? [
      '审核服务：Workers AI（Cloudflare 内置，无需 API Key / 接口地址 / 端点探测）',
      `Workers AI 绑定：${cfg.workersAiAvailable ? '✓ 已绑定 env.AI' : '✗ 未绑定 —— 检查 wrangler.toml 的 [ai] binding = "AI" 并重新部署'}`,
      `内置候选模型：${WORKERS_AI_MODELS.join(', ')}`,
    ] : [
      '审核服务：自定义 OpenAI 兼容网关',
      `API Key：${cfg.key ? '已配置' : '未配置'}`,
      `接口地址（填写值）：${cfg.base}`,
      `端点模式：${MODE_TEXT[cfg.mode] || MODE_TEXT.auto}`,
      `已记住的成功端点：${cfg.endpoint || '（尚未成功调用过）'}`,
      `候选请求地址：${endpointCandidates(cfg).join(' → ')}`,
    ];
    const lines = [
      ...providerLines,
      `当前模型：${cfg.model || '（未选，审核时用 ' + (isWorkers ? DEFAULT_WORKERS_AI_MODEL : AGNES_CHAT_MODELS[0]) + '）'}`,
      `自动审核开关：${cfg.enabled ? '开启' : '关闭'}`,
      `作用根域名：${cfg.roots.join(', ') || '（无）'}${cfg.roots.includes('*') ? '  ← * 表示所有根域名' : ''}`,
      `全局 REQUIRE_APPROVAL：${c.env.REQUIRE_APPROVAL || '（未设置）'}（现已不作为 AI 的前置条件）`,
      `站点当前根域名：${allRoots.join(', ') || '（无）'}`,
      '每个根域名是否会触发 AI：',
      ...(allRoots.length ? allRoots : ['（未配置）']).map(
        (d) => `  ${d} → ${rootInAiList(cfg, d) ? '✓ 会触发' : '✗ 不在名单，申请会走人工审核'}`,
      ),
      `/models：${isWorkers ? '不适用（Workers AI 使用内置模型清单）'
        : (probe ? (probe.source === 'gateway' ? '网关返回 ' + probe.models.length + ' 个' : '不可用，已回落内置清单') : '未检测')}`,
      `可用模型清单：${(probe?.models || []).slice(0, 20).join(', ') || '（无）'}`,
      `当前模型是否在可用清单中：${test?.modelInCatalog === false ? '✗ 不在 —— 请从上面的清单里改选（大小写必须一致）' : (test?.modelInCatalog ? '✓ 在' : '未检测')}`,
      `${isWorkers ? '实际调用方式' : '实际打通地址'}：${test?.ok ? test.endpoint + (test.model !== cfg.model ? `（已把可用模型 ${test.model} 写回设置）` : '') : '（无）'}`,
      `审核调用：${test ? (test.ok ? '可用 · ' + test.model : '不可用 · ' + test.message) : '未检测'}`,
      `审核调用耗时：${test ? (test.latencyMs / 1000).toFixed(1) + 's' + (test.ok ? '（真实模型往返）' : '（失败前的探测）') : '未检测'}`,
      // 真调模型必然有网络往返（通常 1–5 秒）；「提交后立刻开通」一定是短路，不是 AI 判定
      `审核结果语义：${c.env.REQUIRE_APPROVAL === '1'
        ? '需要审核：AI 通过才立即开通，AI 失败则进入人工审核'
        : '全局免审核：无论 AI 是否调用成功都会直接开通（AI 未参与时界面会写明「免审核直接开通」，不会冒充 AI 通过）'}`,
    ];
    const blockers = [];
    if (!cfg.configured) blockers.push(isWorkers ? 'Workers AI 未绑定' : '未配置 API Key');
    if (!cfg.enabled) blockers.push('自动审核开关未开启');
    const matched = allRoots.filter((d) => rootInAiList(cfg, d));
    if (!matched.length) blockers.push(`AI 名单（${cfg.roots.join(', ') || '空'}）没有覆盖任何当前根域名`);
    if (!cfg.model && !isWorkers) blockers.push('后台未选定审核模型');
    if (cfg.model && test?.modelInCatalog === false) {
      blockers.push(isWorkers ? '模型名不在 Workers AI 内置清单里' : '模型名不在网关 /models 清单里');
    }
    if (cfg.configured && !test?.ok) blockers.push(isWorkers ? 'Workers AI 调用失败' : '审核接口调用失败');
    lines.push(blockers.length
      ? `结论：AI 不会自动审核 → ${blockers.join('；')}${c.env.REQUIRE_APPROVAL !== '1' ? '；但全局免审核仍会让申请秒过（不是 AI 审的）' : ''}`
      : c.env.REQUIRE_APPROVAL !== '1'
        ? '结论：配置齐全，但当前为全局免审核 —— 申请会瞬间开通，AI 仍会尝试判定并可驳回违规内容，通过时界面会显示实际耗时'
        : '结论：配置齐全，普通用户在名单内根域名申请会由 AI 自动判定');
    if (test?.attempts?.length) lines.push('候选模型逐项：' + test.attempts.join(' | ').slice(0, 500));
    if (probe?.attempts?.length) {
      lines.push('/models 请求明细：');
      for (const a of probe.attempts) lines.push(`  ${a.url} → HTTP ${a.status} (${a.ms}ms) ${a.sample.slice(0, 120)}`);
    }
    await audit(c, c.get('user')?.id, 'admin.ai-diagnose', 'ai',
      test?.ok ? `可用 · ${test.model}` : `不可用 · ${test?.message || '未配置 Key'}`);
    return ok(c, {
      ok: !!test?.ok, lines, keySet: cfg.configured, base: cfg.base,
      provider: cfg.provider, workersAiAvailable: cfg.workersAiAvailable,
      model: cfg.model, modelFromCatalog: !cfg.model,
      gatewayModels: probe?.models || [], modelInCatalog: !!test?.modelInCatalog,
      probeSource: probe?.source || '', testOk: !!test?.ok,
      testModel: test?.ok ? test.model : '', testEndpoint: test?.ok ? test.endpoint : '',
    });
  } catch (e) {
    return ok(c, {
      ok: false, lines: ['诊断异常：' + String((e as Error)?.message || e).slice(0, 200)],
      keySet: false, base: '', model: '', modelFromCatalog: true, probeSource: '', testOk: false,
      gatewayModels: [], modelInCatalog: false,
    });
  }
});

/* AI 自动审核连接自检：用选定模型 + 真实审核提示词跑一次，回报模型名 / 延迟 / 具体失败点。
   只回诊断信息，不回密钥；需管理员权限（/api/admin/* 已统一鉴权）。 */
app.post('/ai-test', async (c) => {
  try {
    const r = await aiTest(c.env);
    await audit(c, c.get('user')?.id, 'admin.ai-test', 'ai',
      r.ok ? `可用 · ${r.model} · ${r.latencyMs}ms` : `失败 · ${r.message}`);
    return ok(c, { ...r });
  } catch (e) {
    return ok(c, { ok: false, model: '', latencyMs: 0, sample: '',
      message: '自检异常', detail: String((e as Error)?.message || e).slice(0, 200) });
  }
});

/* 立即审核所有待审域名。手动触发与 cron / 新申请共用同一套批处理，
   原子领取锁保证不会重复调用模型。reset=true 会清零失败计数，
   让之前「累计失败 5 次转人工」的记录重新送审。 */
app.post('/ai-review-run', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const r = await runAiReviewBatch(c.env, 'manual', {
      reset: body?.reset === true,
      limit: Math.min(Number(body?.limit) || 20, 100),
    });
    await audit(c, c.get('user')?.id, 'admin.ai-batch', 'ai',
      `${r.reason} · 触发 manual · ${r.elapsedMs}ms`);
    return ok(c, { ...r });
  } catch (e) {
    return ok(c, {
      trigger: 'manual', scanned: 0, approved: 0, rejected: 0, failed: 0, skipped: 0,
      noConfig: false, reason: '批量审核异常：' + String((e as Error)?.message || e).slice(0, 200),
      details: [], elapsedMs: 0,
    });
  }
});

/* 队列状态：待审总数、名单内可审数、转人工数、上次运行结果与逐条失败原因 */
app.get('/ai-review-status', async (c) => {
  try {
    return ok(c, await aiBatchStatus(c.env));
  } catch (e) {
    return ok(c, {
      pendingTotal: 0, aiCovered: 0, manualOnly: 0, exhausted: 0,
      configured: false, enabled: false, roots: [], items: [],
      error: String((e as Error)?.message || e).slice(0, 200),
    });
  }
});

/**
 * 页脚备案 HTML：管理员可直接贴 <a href="...">萌ICP备…号</a>。
 * 只放行 <a> 文字链接与纯文本（其它标签一律丢弃，杜绝 script / onerror / javascript:），
 * href 仅允许 http(s)、mailto 与站内相对路径，并统一补 target / rel。
 * 清洗结果存库，前端直接用 innerHTML 渲染，不再二次拼接。
 */
function sanitizeFooterHtml(raw: unknown): string {
  const src = String(raw ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 600);
  if (!src) return '';
  const escText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (t: string) => t
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = /<a\b[^>]*>[\s\S]*?<\/a\s*>|<[^>]+>|[^<]+/gi;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const chunk = m[0];
    if (chunk[0] !== '<') { out += escText(chunk); continue; }
    const link = chunk.match(/^<a\b([^>]*)>([\s\S]*?)<\/a\s*>$/i);
    if (!link) continue;   // 其它标签整段丢弃，只保留文字内容
    const hm = link[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = String((hm && (hm[1] ?? hm[2] ?? hm[3])) || '').trim();
    if (!/^(https?:\/\/|mailto:|\/(?!\/))/i.test(href)) { out += escText(link[2]); continue; }
    const label = escText(link[2].replace(/<[^>]*>/g, ''));
    // data-no-i18n：备案号是专有编号，英文模式下也不该被界面翻译器改写
    out += '<a href="' + escAttr(href) + '" target="_blank" rel="noopener noreferrer" data-no-i18n>' + label + '</a>';
  }
  return out;
}

app.post('/settings', async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const set = async (k, v) => {
    if (v === undefined) return;
    await c.env.DB.prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
      .bind(k, String(v))
      .run();
  };
  const name = String(body.siteName ?? '').trim().slice(0, 40);
  const logo = String(body.logoUrl ?? '').trim().slice(0, 500);
  const favicon = String(body.faviconUrl ?? '').trim().slice(0, 500);
  const anno = String(body.announcement ?? '').trim().slice(0, 300);

  if (name) await set('site_name', name);
  // 只在本次请求确实提交了该字段时写入，避免只提交 AI 等单项设置时把 Logo 重置成默认
  if (body.logoUrl !== undefined) await set('logo_url', logo || '/img/logo.jpg');
  if (body.faviconUrl !== undefined) await set('favicon_url', favicon || '/favicon.ico');
  if (body.announcement !== undefined) await set('announcement', anno);
  /* 页脚备案号：留空即隐藏；清洗后存库，公开接口只回传这段安全 HTML */
  if (body.footerIcpHtml !== undefined) {
    await set('footer_icp_html', sanitizeFooterHtml(body.footerIcpHtml));
  }
  /* 页脚联系方式：与备案号共用清洗器，只留 <a> 文字链接；留空即隐藏 */
  if (body.footerContactHtml !== undefined) {
    await set('footer_contact_html', sanitizeFooterHtml(body.footerContactHtml));
  }
  /* 额外保留域名：与代码基线、环境变量合并生效，保存即生效，无需重新部署。
     只存「额外」部分，基线项自动去重；管理员仍可自建保留名称。 */
  if (body.reservedLabels !== undefined) {
    const next = normalizeReservedExtra(body.reservedLabels);
    await set('reserved_labels', next);
    await audit(c, u.id, 'admin.reserved-labels', 'site', next || '(清空额外名单)');
  }
  /* 注册滑块验证：开关 + 图库子集。图名按白名单过滤，
     防止管理员填了不存在的名字让验证图 404；留空回落到四张全量。 */
  if (body.captchaEnabled !== undefined) {
    await set('captcha_enabled', body.captchaEnabled ? '1' : '0');
    await audit(c, u.id, 'admin.captcha', 'site', `enabled=${body.captchaEnabled ? '1' : '0'}`);
  }
  if (body.captchaImages !== undefined) {
    const ALLOWED = ['typhoon', 'meoy', 'miku', 'cloud'];
    const list = String(body.captchaImages || '').split(',')
      .map((x) => x.trim().toLowerCase()).filter((x) => ALLOWED.includes(x));
    await set('captcha_images', list.length ? list.join(',') : ALLOWED.join(','));
  }

  /* NodeLoc 第三方登录：开关 + 应用凭据 + 首次登录策略。
     Secret 只在显式提交新值时写入；前端显示掩码，留空不覆盖已有密钥。 */
  if (body.nodelocEnabled !== undefined) {
    await set('nodeloc_enabled', body.nodelocEnabled ? '1' : '0');
    await audit(c, u.id, 'admin.nodeloc', 'site', `enabled=${body.nodelocEnabled ? '1' : '0'}`);
  }
  if (body.nodelocClientId !== undefined) {
    await set('nodeloc_client_id', String(body.nodelocClientId || '').trim().slice(0, 200));
  }
  if (String(body.nodelocClientSecret || '').trim()) {
    await set('nodeloc_client_secret', String(body.nodelocClientSecret).trim().slice(0, 300));
  } else if (body.nodelocClearSecret === true) {
    await set('nodeloc_client_secret', '');
  }
  if (body.nodelocAutoRegister !== undefined) {
    await set('nodeloc_auto_register', body.nodelocAutoRegister ? '1' : '0');
  }
  // email 是必需资料，恒开：旧库里被关成 0 的也一并纠正，避免 userInfo
  // 不带邮箱后又退回生成乱码内部地址
  await set('nodeloc_scope_email', '1');
  if (body.nodelocRedirectUri !== undefined) {
    const r = String(body.nodelocRedirectUri || '').trim();
    // NodeLoc 只接受 HTTPS 回调，http:// 一律拒绝，避免授权被 provider 拒掉
    if (r && !/^https:\/\//i.test(r)) return fail(c, '回调地址必须是以 https:// 开头的绝对地址');
    await set('nodeloc_redirect_uri', r.slice(0, 300));
  }

  /* GitHub 第三方登录：默认关闭，必须填齐 Client ID / Secret 并打开开关才生效。
     Secret 只在显式提交新值时写入；前端显示掩码，留空不覆盖已有密钥。 */
  if (body.githubEnabled !== undefined) {
    await set('github_enabled', body.githubEnabled ? '1' : '0');
    await audit(c, u.id, 'admin.github', 'site', `enabled=${body.githubEnabled ? '1' : '0'}`);
  }
  if (body.githubClientId !== undefined) {
    await set('github_client_id', String(body.githubClientId || '').trim().slice(0, 200));
  }
  if (String(body.githubClientSecret || '').trim()) {
    await set('github_client_secret', String(body.githubClientSecret).trim().slice(0, 300));
  } else if (body.githubClearSecret === true) {
    await set('github_client_secret', '');
  }
  if (body.githubAutoRegister !== undefined) {
    await set('github_auto_register', body.githubAutoRegister ? '1' : '0');
  }
  if (body.githubRedirectUri !== undefined) {
    const r = String(body.githubRedirectUri || '').trim();
    if (r && !/^https:\/\//i.test(r)) return fail(c, 'GitHub 回调地址必须是以 https:// 开头的绝对地址');
    await set('github_redirect_uri', r.slice(0, 300));
  }
  if (body.githubStarRepo !== undefined) {
    const repo = normalizeStarRepo(body.githubStarRepo);
    if (!repo) return fail(c, 'Star 仓库格式应为 owner/repo，例如 wcvjk8tnz8-create/Noxc');
    await set('github_star_repo', repo);
  }
  if (body.githubStarBonus !== undefined) {
    const n = Number(String(body.githubStarBonus).trim());
    if (!Number.isFinite(n) || n < 0 || n > 100) return fail(c, 'Star 奖励配额需在 0-100 之间');
    await set('github_star_bonus', String(Math.floor(n)));
  }

  // 新域名申请开关（暂停后普通用户无法提交申请，管理员仍可自建）
  if (body.applyPaused !== undefined && String(c.env.APPLY_PAUSED || '').trim() !== '1') {
    await set('apply_paused', body.applyPaused ? '1' : '0');
  }
  if (body.applyPausedMessage !== undefined) {
    await set('apply_paused_message', String(body.applyPausedMessage || '').trim().slice(0, 200));
  }

  /* AI 自动审核：密钥只在显式提交新值时写入；前端显示掩码，空串不覆盖已有 Key。
     也支持 Worker Secret AI_API_KEY（此时后台只读，避免两处配置打架）。 */
  const cleanRoots = (v) => String(v ?? '')
    .split(',').map((x) => x.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter((x) => x === '*' || /^[a-z0-9][a-z0-9.-]{0,251}$/.test(x)).slice(0, 30).join(',');
  if (body.aiEnabled !== undefined) await set('ai_review_enabled', body.aiEnabled ? '1' : '0');
  if (body.aiRoots !== undefined) await set('ai_review_roots', cleanRoots(body.aiRoots));
  if (body.aiDnsUnlimitedRoots !== undefined) await set('dns_unlimited_roots', cleanRoots(body.aiDnsUnlimitedRoots));
  /* 只有地址 / 端点模式「真的变了」才清掉已记住的成功端点。
     后台表单每次都会带 aiUrl 与 aiEndpointMode，以前无条件清空 ——
     「用此模型测试审核」刚打通并写回的端点，一保存就没了，正式申请
     又得重新探端点，表现为「设置里能调、提交时失败」。 */
  const getSetting = async (k: string): Promise<string> => {
    try {
      const row: any = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(k).first();
      return String(row?.value ?? '').trim();
    } catch { return ''; }
  };
  if (body.aiUrl !== undefined) {
    const u = String(body.aiUrl || '').trim().replace(/\/+$/, '');
    const url = /^https:\/\//i.test(u) ? u.slice(0, 300) : 'https://apihub.agnes-ai.com/v1';
    if ((await getSetting('ai_api_url')) !== url) await set('ai_api_endpoint', '');
    await set('ai_api_url', url);
  }
  if (body.aiEndpointMode !== undefined) {
    const m = String(body.aiEndpointMode || '').trim();
    const mode = ['auto', 'direct', 'standard'].includes(m) ? m : 'auto';
    if ((await getSetting('ai_endpoint_mode')) !== mode) await set('ai_api_endpoint', '');
    await set('ai_endpoint_mode', mode);
  }
  /* 审核服务提供方：custom（自定义网关）/ workers-ai（Cloudflare 内置）。
     切换时清掉自定义网关记住的端点，避免两个服务互相污染。 */
  if (body.aiProvider !== undefined) {
    const p = normalizeProvider(body.aiProvider);
    if ((await getSetting('ai_provider')) !== p) await set('ai_api_endpoint', '');
    await set('ai_provider', p);
  }
  if (body.aiModel !== undefined) {
    let m = String(body.aiModel || '').trim().slice(0, 80);
    // 切到 Workers AI 后，旧网关模型名不属于 Cloudflare 清单，直接换成内置默认
    if (normalizeProvider(await getSetting('ai_provider')) === 'workers-ai'
      && m && !WORKERS_AI_MODELS.includes(m)) m = DEFAULT_WORKERS_AI_MODEL;
    await set('ai_model', m);
  }
  if (String(body.aiApiKey || '').trim()) await set('ai_api_key', String(body.aiApiKey).trim().slice(0, 300));
  else if (body.aiClearKey === true) await set('ai_api_key', '');

  /* ── AnyNS（n.ht 社区）站点级 DNS 后端 ──
     令牌是敏感项：只在显式提交新值时写入，留空不覆盖；也可勾选清空。
     Worker Secret ANYNS_API_TOKEN 优先级更高，此时后台只读（fromEnv）。
     保存后统一失效三层缓存（settings / dnsProvider / anyns），立即生效。 */
  if (String(body.anynsApiToken || '').trim()) {
    await set('anyns_api_token', String(body.anynsApiToken).trim().slice(0, 300));
  } else if (body.anynsClearToken === true) {
    await set('anyns_api_token', '');
  }
  const cleanDomains = (v: unknown) => String(v ?? '')
    .split(/[,\s]+/).map((x) => x.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter((x) => /^[a-z0-9][a-z0-9.-]{0,251}$/.test(x)).slice(0, 30).join(',');
  if (body.anynsRoots !== undefined) await set('anyns_roots', cleanDomains(body.anynsRoots));
  if (body.anynsZoneId !== undefined) {
    const z = String(body.anynsZoneId || '').trim();
    await set('anyns_zone_id', /^\d+$/.test(z) ? z : '');
  }
  if (body.anynsZoneIds !== undefined) {
    const pairs = String(body.anynsZoneIds || '')
      .split(/[,\s]+/).map((x) => x.trim())
      .filter((x) => /^[a-z0-9][a-z0-9.-]{0,251}[:=]\d+$/i.test(x))
      .slice(0, 30).join(',');
    await set('anyns_zone_ids', pairs);
  }
  /* 迁移期「暂停解析」：同一张卡片管理，清空名单即全部恢复 */
  if (body.dnsPausedRoots !== undefined) await set('dns_paused_roots', cleanDomains(body.dnsPausedRoots));
  if (body.dnsMigrationNotice !== undefined) {
    await set('dns_migration_notice', String(body.dnsMigrationNotice || '').trim().slice(0, 300));
  }

  // 注册邮箱规则（默认「白名单 ∪ 任意含 edu 的邮箱」）
  if (body.emailRule !== undefined) {
    const r = String(body.emailRule || '').trim().toLowerCase();
    if (!EMAIL_RULES.includes(r as EmailRule)) return fail(c, '注册邮箱规则不合法');
    await set('email_rule', r);
  }

  // 同 IP 账号上限
  if (body.maxAccountsPerIp !== undefined && body.maxAccountsPerIp !== '') {
    const n = Number(body.maxAccountsPerIp);
    if (!Number.isFinite(n) || n < 1 || n > 50) return fail(c, '单 IP 账号数需在 1-50 之间');
    await set('max_accounts_per_ip', String(Math.floor(n)));
  }

  /* 域名有效期规则。
     续期窗口留空 = 自动取「有效期的一半」（少于一半即可续期），这样管理员只改
     有效期时窗口会跟着变；填数字才是显式覆盖。老代码无校验，后台输入框因
     expiry 放错位置一直显示写死的 365/180，保存就会把旧值写回库里。 */
  if (body.domainValidDays !== undefined) {
    const s = String(body.domainValidDays ?? '').trim();
    const n = Number(s);
    if (!s || !Number.isFinite(n) || n < 1 || n > 3650) {
      return fail(c, '新域名有效期需在 1-3650 天之间');
    }
    await set('domain_valid_days', String(Math.floor(n)));
  }
  if (body.renewWindowDays !== undefined) {
    const s = String(body.renewWindowDays ?? '').trim();
    if (s === '') {
      await set('renew_window_days', '');
    } else {
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0 || n > 3650) {
        return fail(c, '续期窗口需在 0-3650 天之间（留空 = 有效期一半）');
      }
      await set('renew_window_days', String(Math.floor(n)));
    }
  }

  // Spaceship 域名注册商 API（只读：拉取账号下域名）
  if (body.spaceshipApiUrl !== undefined) {
    const u = String(body.spaceshipApiUrl || '').trim().replace(/\/$/, '').slice(0, 300);
    if (u && !/^https?:\/\//i.test(u)) return fail(c, 'Spaceship API 地址需以 http:// 或 https:// 开头');
    await set('spaceship_api_url', u);
  }
  if (body.spaceshipApiKey !== undefined) {
    const k = String(body.spaceshipApiKey || '').trim();
    if (k && !k.startsWith('••')) await set('spaceship_api_key', k.slice(0, 200));
  }
  if (body.spaceshipApiSecret !== undefined) {
    const k = String(body.spaceshipApiSecret || '').trim();
    if (k && !k.startsWith('••')) await set('spaceship_api_secret', k.slice(0, 200));
  }

  // 邮件与验证码（Resend / Brevo）
  if (body.mailProvider !== undefined) {
    const p = String(body.mailProvider || '').trim().toLowerCase();
    if (p && !['resend', 'brevo'].includes(p)) return fail(c, '邮件服务商仅支持 resend / brevo');
    await set('mail_provider', p);
  }
  if (body.mailFrom !== undefined) {
    const f = String(body.mailFrom || '').trim().slice(0, 120);
    if (f && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f)) return fail(c, '发件人邮箱格式不正确');
    await set('mail_from', f);
  }
  if (body.mailApiKey !== undefined) {
    const k = String(body.mailApiKey || '').trim();
    // 空字符串或掩码占位 = 不修改
    if (k && !k.startsWith('••')) await set('mail_api_key', k.slice(0, 200));
  }
  if (body.mailVerifyRequired !== undefined) {
    await set('mail_verify_required', body.mailVerifyRequired ? '1' : '0');
  }

  // R2 头像公网地址（形如 https://img.meoy.top，留空则用 /api/avatar/<key> 代理）
  if (body.r2PublicUrl !== undefined) {
    const u = String(body.r2PublicUrl || '').trim().slice(0, 300);
    if (u && !/^https?:\/\//i.test(u)) return fail(c, 'R2 公网地址需以 http:// 或 https:// 开头');
    await set('r2_public_url', u.replace(/\/$/, ''));
  }

  // 滥用举报渠道（外部域名 WHOIS 的「举报通道」区块展示）
  if (body.abuseEmail !== undefined) await set('abuse_email', String(body.abuseEmail || '').trim());
  if (body.abuseReportUrl !== undefined) await set('abuse_report_url', String(body.abuseReportUrl || '').trim());

  // 托管面板域名（CNAME 识别用：域名 CNAME 到它时显示自定义名称）
  if (body.hostingPanelDomain !== undefined) await set('hosting_panel_domain', String(body.hostingPanelDomain || '').trim().toLowerCase());
  if (body.hostingPanelName !== undefined) await set('hosting_panel_name', String(body.hostingPanelName || '').trim());

  // 自定义 DNS 提供商（填了 URL 就走它，可突破 Cloudflare 200 条记录限制；留空用 Cloudflare）
  if (body.dnsApiUrl !== undefined) {
    await set('dns_api_url', String(body.dnsApiUrl || '').trim());
    clearDnsProviderCache();   // 清缓存，立即生效
  }
  if (body.dnsApiKey !== undefined) await set('dns_api_key', String(body.dnsApiKey || '').trim());
  if (body.dnsApiSecret !== undefined) await set('dns_api_secret', String(body.dnsApiSecret || '').trim());

  // DNSHE API 凭证（用于查询 DNSHE 系域名；留空则退回公开模式）
  if (body.dnsheApiKey !== undefined) await set('dnshe_api_key', String(body.dnsheApiKey || '').trim());
  if (body.dnsheApiSecret !== undefined) await set('dnshe_api_secret', String(body.dnsheApiSecret || '').trim());

  // 积分规则
  const numRule = async (key, val, min, max, label) => {
    if (val === undefined || val === '') return true;
    const n = Number(val);
    if (!Number.isFinite(n) || n < min || n > max) {
      c.__ruleErr = `${label}需在 ${min}-${max} 之间`;
      return false;
    }
    await set(key, String(Math.floor(n)));
    return true;
  };
  if (!(await numRule('checkin_points', body.checkinPoints, 0, 1000, '每日签到积分'))) return fail(c, c.__ruleErr);
  if (!(await numRule('domain_cost', body.domainCost, 0, 10000, '域名消耗积分'))) return fail(c, c.__ruleErr);
  if (!(await numRule('short_domain_cost', body.shortDomainCost, 0, 100000, '单字域名消耗积分'))) return fail(c, c.__ruleErr);
  if (!(await numRule('short_domain_len', body.shortDomainLen, 1, 10, '单字域名长度上限'))) return fail(c, c.__ruleErr);
  if (!(await numRule('initial_points', body.initialPoints, 0, 10000, '新用户初始积分'))) return fail(c, c.__ruleErr);
  // 用户案例展示奖励：0 = 关闭奖励；已领过的不回收，之后再调回来也不会补发
  if (!(await numRule('showcase_reward_points', body.showcaseRewardPoints, 0, 100000, '用户案例展示奖励积分'))) return fail(c, c.__ruleErr);
  // 组合任务奖励（绑定 NodeLoc + Star 项目）：同样 0 = 关闭，已领不回收
  if (!(await numRule('combo_reward_points', body.comboRewardPoints, 0, COMBO_REWARD_CAP, '组合任务奖励积分'))) return fail(c, c.__ruleErr);

  /* 新用户默认子域名配额：后台可自定义；-1 = 不限量，0 = 不允许申请。
     优先级高于环境变量 DEFAULT_QUOTA，注册时直接读这个值。 */
  if (!(await numRule('default_quota', body.defaultQuota, -1, 10000, '新用户默认配额'))) return fail(c, c.__ruleErr);
  if (body.applyQuotaToExisting === true) {
    if (body.defaultQuota === '' || body.defaultQuota === undefined) return fail(c, '请先填写新用户默认配额');
    const q = await defaultQuotaOf(c.env);
    const res = await c.env.DB.prepare("UPDATE users SET quota = ? WHERE role != 'admin'").bind(q).run();
    await audit(c, u.id, 'admin.quota.apply-all', 'site', `default_quota=${q} affected=${res.meta?.changes ?? '?'}`);
  }

  /* 按根域名单独设置申请积分：{ 'v-1.top': 0, 'meoy.top': '' }
     · 0 = 该后缀免费（普通用户也不扣分）
     · 留空 = 删除覆盖，回落上方全局规则（含单字加价）
     · 只接受当前生效的根域名，避免写入野值 */
  if (body.rootPointCosts !== undefined) {
    const active = (await effectiveRootList(c.env)).map((r) => r.domain);
    const allowed = new Set(active);
    const input = body.rootPointCosts && typeof body.rootPointCosts === 'object'
      ? body.rootPointCosts : {};
    const next = {};
    for (const [raw, val] of Object.entries(input)) {
      const d = normalizeDomain(String(raw || '').toLowerCase());
      const s = String(val ?? '').trim();
      if (!allowed.has(d) || s === '') continue;
      if (!/^\d+$/.test(s)) return fail(c, `根域名 ${d} 的积分必须是 0 或正整数`);
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0 || n > 100000) return fail(c, `根域名 ${d} 的积分需在 0-100000 之间`);
      next[d] = Math.floor(n);
    }
    await set('root_point_costs', serializeRootCosts(next));
    await audit(c, u.id, 'admin.root-point-costs', 'site',
      Object.keys(next).length
        ? Object.entries(next).map(([d, n]) => `${d}:${n}`).join(',')
        : '全部恢复全局规则');
  }

  /* 按根域名设置「每个账号能注册几次」。只接受当前生效的根域名：
       -1 = 无限；0 = 禁止该后缀；正整数 = 累计次数上限；留空 = 删除限制。
     计数从功能启用后开始，不回溯历史 —— 已注册用户不受影响。 */
  if (body.rootRegLimits !== undefined) {
    const active = (await effectiveRootList(c.env)).map((r) => r.domain);
    const allowed = new Set(active);
    const input = body.rootRegLimits && typeof body.rootRegLimits === 'object'
      ? body.rootRegLimits : {};
    const nextLimits: Record<string, number> = {};
    for (const [raw, val] of Object.entries(input)) {
      const d = normalizeDomain(String(raw || '').toLowerCase());
      const s = String(val ?? '').trim();
      if (!allowed.has(d) || s === '') continue;
      if (!/^-?\d+$/.test(s)) return fail(c, `根域名 ${d} 的注册次数必须是 -1 或 0 以上的整数`);
      const n = Number(s);
      if (!Number.isFinite(n) || n < -1 || n > 10000) return fail(c, `根域名 ${d} 的注册次数需在 -1 到 10000 之间`);
      nextLimits[d] = Math.floor(n);
    }
    await set('root_reg_limits', serializeRootRegLimits(nextLimits));
    await audit(c, u.id, 'admin.root-reg-limits', 'site',
      Object.keys(nextLimits).length
        ? Object.entries(nextLimits).map(([d, n]) => `${d}:${n}`).join(',')
        : '全部恢复不限制');
  }

  /* 按后缀单独暂停新申请：只接受当前生效的根域名，逗号分隔存 settings。
     环境变量 ROOT_APPLY_PAUSED 的项始终生效，后台清空也关不掉。 */
  if (body.rootApplyPaused !== undefined) {
    const active = new Set((await effectiveRootList(c.env)).map((r) => r.domain));
    const input = Array.isArray(body.rootApplyPaused) ? body.rootApplyPaused : [];
    const forced = parsePausedRoots(c.env.ROOT_APPLY_PAUSED || '');
    const chosen = parsePausedRoots(input.join(','))
      .filter((d) => active.has(d) && !forced.includes(d));
    await set('root_apply_paused', chosen.join(','));
    await audit(c, u.id, 'admin.root-apply-paused', 'site',
      chosen.length ? `暂停申请：${chosen.join(',')}` : '全部恢复开放申请');
  }

  // 全局中文字体（正文 / 标题）：拉丁与数字始终用 Redaction 35，这里只决定中文用哪个字体
  const FONTS = ['system', 'noto', 'lxgw', 'zcool'];
  if (body.fontBody !== undefined) {
    const f = String(body.fontBody).toLowerCase();
    if (!FONTS.includes(f)) return fail(c, '正文字体取值不合法');
    await set('font_body', f);
  }
  if (body.fontDisplay !== undefined) {
    const f = String(body.fontDisplay).toLowerCase();
    if (!FONTS.includes(f)) return fail(c, '标题字体取值不合法');
    await set('font_display', f);
  }

  // WHOIS 持有人显示策略
  if (body.whoisHolder !== undefined) {
    const m = String(body.whoisHolder).toLowerCase();
    if (!['masked', 'none', 'full'].includes(m)) return fail(c, 'WHOIS 显示方式不合法');
    await set('whois_holder', m);
  }

  /* 管理员刚改完 AI 配置（例如补上 Key / 换模型）时，顺手把积压的
     pending 重新送审一次，不必等下一个整点或下一笔新申请。 */
  queueAiBatch(c, 'settings-save');

  /* 站点设置落库后统一失效三层缓存：保存即生效，不必等 isolate 的 30s/15s TTL。
     以前只有个别分支清 dnsProvider，settings 统一缓存没清，改完要等半分钟。 */
  invalidateSettings();
  clearDnsProviderCache();
  clearAnynsConfigCache();

  await audit(c, u.id, 'admin.settings', 'site', `name=${name} logo=${logo || '(默认)'}`);
  return ok(c, {});
});

// 恢复默认 Logo（重新指向内置图片）
app.post('/settings/reset-logo', async (c) => {
  const u = c.get('user');
  for (const [k, v] of [['logo_url', '/img/logo.jpg'], ['favicon_url', '/favicon.ico']]) {
    await c.env.DB.prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
      .bind(k, v)
      .run();
  }
  await audit(c, u.id, 'admin.settings', 'site', '恢复默认 Logo');
  return ok(c, {});
});


// ══════════════════════════════════════════════════════════
//  Spaceship 域名注册商：拉取账号域名 → 管理员勾选添加为根域名
//  全部只读，不注册 / 不续费 / 不改 NS（避免误触资金操作）
// ══════════════════════════════════════════════════════════

/** 测试连通性（只取 1 条，不消耗多少额度） */
app.post('/spaceship/test', async (c) => {
  const r = await testSpaceship(c.env);
  if (!r.ok) return fail(c, r.error, r.notConfigured ? 400 : 502);
  await audit(c, c.get('user').id, 'admin.spaceship.test', 'spaceship', `域名数=${r.total}`);
  return ok(c, { total: r.total, base: r.base });
});

/** AnyNS：用站点设置 / Worker Secret 里的管理令牌拉取账号下全部解析区域 */
app.get('/anyns/domains', async (c) => {
  const r = await anynsAdminFetchDomains(c.env);
  if (!r.ok) {
    return fail(c, r.message || '拉取 AnyNS 域名失败',
      r.notConfigured ? 400 : 502, { notConfigured: !!r.notConfigured });
  }
  await audit(c, c.get('user').id, 'admin.anyns.list', 'anyns',
    `拉取 ${r.total} 个解析区域`);
  return ok(c, { items: r.items, total: r.total });
});

/** AnyNS：把勾选的解析区域添加为根域名 / 切换为 AnyNS 后端 */
app.post('/anyns/add', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const r = await anynsAdminAddRoots(c.env, body.domains);
  if (!r.ok) {
    return fail(c, r.message || '添加失败', r.notConfigured ? 400 : 400,
      { notConfigured: !!r.notConfigured });
  }
  /* 后端映射刚变，清掉 dnsProvider 快照，下一次写记录立即走 AnyNS */
  clearDnsProviderCache();
  await audit(c, c.get('user').id, 'admin.anyns.add', 'anyns',
    `添加 ${r.added.join(',') || '（无）'} · 切换 ${r.switched.join(',') || '（无）'}`);
  return ok(c, {
    added: r.added,
    switched: r.switched,
    skipped: r.skipped,
    invalid: r.invalid,
    rootDomains: r.rootDomains,
    note: '已生效：这些根域名的 DNS 记录会写进对应的 AnyNS 解析区域。若之后要改回 Cloudflare / Spaceship，在「根域名管理」的下拉里切换即可。',
  });
});

/** 拉取账号下的域名，并标注哪些已经是本站根域名 */
app.get('/spaceship/domains', async (c) => {
  const cfg = await spaceshipConfig(c.env);
  if (!spaceshipEnabled(cfg)) {
    return fail(c, '未配置 Spaceship API 凭证，请先在「站点设置」填写 API Key 与 Secret', 400, { notConfigured: true });
  }
  const r = await listSpaceshipDomains(c.env);
  if (!r.ok) return fail(c, r.error, r.notConfigured ? 400 : 502);

  const roots = await effectiveRootList(c.env);
  const known = new Map(roots.map((x) => [x.domain, x.zoneId || '']));
  const items = r.domains.map((d) => ({
    ...d,
    alreadyAdded: known.has(d.domain),
    zoneId: known.get(d.domain) || '',
    hasZone: !!known.get(d.domain),
  }));
  await audit(c, c.get('user').id, 'admin.spaceship.list', 'spaceship', `拉取 ${items.length} 个域名`);
  return ok(c, {
    items,
    total: r.total,
    base: r.base,
    configuredRoots: roots.map((x) => x.domain),
  });
});

/** 把勾选的域名添加为根域名（可附带 Cloudflare Zone ID） */
app.post('/spaceship/add', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // Spaceship 账号里拉下来的域名，DNS 默认就归 Spaceship 管。
  // 以前只在后台没填 Zone ID 时才「自动推断」成 Spaceship：一旦用户顺手填了
  // Zone ID，记录就会被写去 Cloudflare API（用户的域名根本不在那个 Zone），
  // 表现就是「Spaceship 导入的域名改不了 DNS 记录」。这里显式写死后端。
  const entries = (Array.isArray(body.domains) ? body.domains : []).map((e) => ({
    ...e,
    backend: String(e?.backend || 'spaceship').trim().toLowerCase(),
  }));
  if (!entries.length) return fail(c, '请至少选择一个域名');
  if (entries.length > 100) return fail(c, '一次最多添加 100 个域名');

  const r = await addExtraRoots(c.env, entries);
  // 关键：不清缓存的话，dnsProvider 里 60 秒内的旧快照仍会把这个域名
  // 判成 Cloudflare（无 Zone → 写入必失败），表现为「导入后改不了 DNS 记录」。
  clearDnsProviderCache();
  invalidateSettings();
  if (!r.added.length) {
    return fail(c, r.invalid.length
      ? '域名格式不正确：' + r.invalid.join('、')
      : '所选域名都已添加过了');
  }
  await audit(c, c.get('user').id, 'admin.spaceship.add', 'spaceship', '添加根域名：' + r.added.join(','));
  return ok(c, {
    added: r.added,
    skipped: r.skipped,
    invalid: r.invalid,
    rootDomains: r.roots,
    note: '已生效。DNS 记录默认通过 Spaceship API Key 写入；如需改用 Cloudflare，请在「根域名管理」把该域名切换为 Cloudflare 并填写 Zone ID。',
  });
});

/** 移除一个根域名：后台导入的直接删，环境变量的写入屏蔽名单（无需重新部署） */
app.delete('/roots/:domain', async (c) => {
  const d = String(c.req.param('domain') || '').toLowerCase();
  const r = await removeRoot(c.env, d);
  clearDnsProviderCache();
  invalidateSettings();
  if (!r.removed) return fail(c, r.reason || '移除失败', 400);
  await audit(c, c.get('user').id, 'admin.root.remove', 'root', `移除根域名：${d}（${r.mode}）`);
  return ok(c, { rootDomains: r.roots, mode: r.mode });
});

/** 兼容旧前端路径 */
app.delete('/spaceship/roots/:domain', async (c) => {
  const d = String(c.req.param('domain') || '').toLowerCase();
  const r = await removeRoot(c.env, d);
  clearDnsProviderCache();
  if (!r.removed) return fail(c, r.reason || '移除失败', 400);
  await audit(c, c.get('user').id, 'admin.root.remove', 'root', `移除根域名：${d}（${r.mode}）`);
  return ok(c, { rootDomains: r.roots, mode: r.mode });
});

/** 恢复一个被屏蔽的根域名 */
app.post('/roots/:domain/restore', async (c) => {
  const d = String(c.req.param('domain') || '').toLowerCase();
  const r = await restoreRoot(c.env, d);
  clearDnsProviderCache();
  invalidateSettings();
  if (!r.restored) return fail(c, '该域名不在已移除列表中', 404);
  await audit(c, c.get('user').id, 'admin.root.restore', 'root', '恢复根域名：' + d);
  return ok(c, { rootDomains: r.roots });
});

/** 显式指定某个根域名的 DNS 后端；传空值恢复自动判断 */
app.post('/roots/:domain/backend', async (c) => {
  const d = String(c.req.param('domain') || '').toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const kind = String(body.backend || '').trim().toLowerCase();
  const r = await setDnsBackend(c.env, d, kind);
  if (!r.ok) return fail(c, r.reason || '切换失败', 400);
  clearDnsProviderCache();
  invalidateSettings();   // 下拉切完立刻 GET /roots 要能看到新后端
  await audit(c, c.get('user').id, 'admin.root.backend', 'root', `${d} → ${kind || '自动'}`);
  return ok(c, { backend: r.backend, backends: r.backends });
});

/** 当前根域名列表（含来源与已移除项，便于后台展示） */
app.get('/roots', async (c) => {
  const s = await rootSources(c.env);
  return ok(c, {
    items: s.items,
    disabled: s.disabled,
    rootDomains: s.items.map((r) => r.domain),
  });
});

/* ---------------- 第三方邮箱注册申请 / 精确白名单 ---------------- */

const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normMail = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** 申请列表 + 当前白名单（一个请求渲染整个后台页签） */
app.get('/email-requests', async (c) => {
  try {
    const reqs = await c.env.DB.prepare(
      `SELECT id, email, reason, contact, status, ip, created_at, reviewed_at, reviewed_by, note
         FROM email_requests
        ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC LIMIT 200`
    ).all();
    const allow = await c.env.DB.prepare(
      'SELECT email, note, source, created_at FROM email_allowlist ORDER BY created_at DESC LIMIT 200'
    ).all();
    return ok(c, { items: reqs.results || [], allowlist: allow.results || [] });
  } catch {
    return ok(c, { items: [], allowlist: [], unavailable: true });
  }
});

/** 通过：写入精确白名单并标记申请（两步都完成才算成功） */
app.post('/email-requests/:id/approve', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return fail(c, '申请编号不合法');
  const row: any = await c.env.DB.prepare('SELECT * FROM email_requests WHERE id = ?').bind(id).first();
  if (!row) return fail(c, '申请不存在', 404);
  if (row.status === 'approved') return ok(c, { email: row.email, already: true });
  const body = await c.req.json().catch(() => ({}));
  const note = String((body as any)?.note || '').trim().slice(0, 200);
  try {
    await c.env.DB.prepare(
      `INSERT INTO email_allowlist(email, note, source, created_at) VALUES (?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET note = excluded.note, source = excluded.source`
    ).bind(row.email, note || '邮箱注册申请通过', 'request', now()).run();
    await c.env.DB.prepare(
      'UPDATE email_requests SET status = ?, reviewed_at = ?, reviewed_by = ?, note = ? WHERE id = ?'
    ).bind('approved', now(), String(u?.email || ''), note, id).run();
  } catch {
    return fail(c, '写入白名单失败，请稍后重试', 500);
  }
  await audit(c, u?.id, 'admin.email.approve', row.email, note || '通过第三方邮箱注册申请');
  return ok(c, { email: row.email });
});

/** 驳回 */
app.post('/email-requests/:id/reject', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return fail(c, '申请编号不合法');
  const body = await c.req.json().catch(() => ({}));
  const note = String((body as any)?.note || '').trim().slice(0, 200);
  const r: any = await c.env.DB.prepare(
    'UPDATE email_requests SET status = ?, reviewed_at = ?, reviewed_by = ?, note = ? WHERE id = ? AND status = ?'
  ).bind('rejected', now(), String(u?.email || ''), note, id, 'pending').run();
  if (!r?.meta?.changes) return fail(c, '申请不存在或已处理', 404);
  await audit(c, u?.id, 'admin.email.reject', String(id), note || '驳回第三方邮箱注册申请');
  return ok(c, {});
});

/** 手动添加白名单邮箱（不必等用户提交申请） */
app.post('/email-allowlist', async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const mail = normMail((body as any)?.email);
  if (!MAIL_RE.test(mail)) return fail(c, '请填写有效的邮箱地址');
  const note = String((body as any)?.note || '').trim().slice(0, 200);
  try {
    await c.env.DB.prepare(
      `INSERT INTO email_allowlist(email, note, source, created_at) VALUES (?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET note = excluded.note`
    ).bind(mail, note, 'manual', now()).run();
  } catch {
    return fail(c, '写入白名单失败，请稍后重试', 500);
  }
  await audit(c, u?.id, 'admin.email.allow', mail, note || '手动添加邮箱白名单');
  return ok(c, { email: mail });
});

/** 移除白名单（表存在后以表为准，不会被内置种子复活） */
app.delete('/email-allowlist/:email', async (c) => {
  const u = c.get('user');
  const mail = normMail(c.req.param('email'));
  if (!MAIL_RE.test(mail)) return fail(c, '请填写有效的邮箱地址');
  await c.env.DB.prepare('DELETE FROM email_allowlist WHERE email = ?').bind(mail).run();
  await audit(c, u?.id, 'admin.email.unallow', mail, '移除邮箱白名单');
  return ok(c, {});
});

export default app;
