/**
 * 第三方邮箱注册申请（公开接口）
 *
 * 注册页在邮箱不符合规则时提供入口：访客提交邮箱 + 理由，管理员在
 * 后台通过后写入 email_allowlist，该地址即在任何规则模式下都能注册。
 * 全部接口只读/写入自身两张表，不暴露申请列表给未登录访客。
 */
import { Hono } from 'hono';
import { ok, fail, now, clientIp } from '../lib/util.js';
import { signupEmailOk } from '../lib/emailRule.js';

const app = new Hono();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** 最新一条申请的状态；没有记录返回 none */
async function latestStatus(db: any, mail: string): Promise<string> {
  try {
    const row: any = await db
      .prepare('SELECT status, created_at FROM email_requests WHERE email = ? ORDER BY id DESC LIMIT 1')
      .bind(mail)
      .first();
    if (!row) return 'none';
    if (row.status === 'rejected' && Date.now() - Number(row.created_at || 0) > DAY) return 'expired';
    return String(row.status || 'pending');
  } catch {
    return 'unknown'; // 表还没建：前端提示稍后再试
  }
}

/** POST /api/email-request —— 提交第三方邮箱注册申请（无需登录） */
app.post('/email-request', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // 蜜罐：机器人填了隐藏字段时静默返回成功，不写库
  if (String((body as any)?.website || '').trim()) return ok(c, { status: 'pending' });

  const mail = norm((body as any)?.email);
  if (!EMAIL_RE.test(mail)) return fail(c, '请填写有效的邮箱地址');
  const reason = String((body as any)?.reason || '').trim().slice(0, 300);
  const contact = String((body as any)?.contact || '').trim().slice(0, 120);

  // 已符合规则 / 已注册 / 已有申请：都不重复写库，直接回状态让前端给对应提示
  const gate = await signupEmailOk(c.env, mail);
  if (gate.ok) return ok(c, { status: 'unnecessary' });
  try {
    const exist = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(mail).first();
    if (exist) return ok(c, { status: 'registered' });
  } catch { /* users 表异常不阻断申请 */ }

  const prev = await latestStatus(c.env.DB, mail);
  if (prev === 'unknown') return fail(c, '申请服务暂不可用，请稍后再试', 503);
  if (prev !== 'none' && prev !== 'expired') return ok(c, { status: prev });

  const ip = clientIp(c);
  try {
    const cnt: any = await c.env.DB
      .prepare('SELECT COUNT(*) AS n FROM email_requests WHERE ip = ? AND created_at > ?')
      .bind(ip, now() - HOUR)
      .first();
    if ((cnt?.n || 0) >= 3) return fail(c, '提交过于频繁，请稍后再试', 429);
  } catch { return fail(c, '申请服务暂不可用，请稍后再试', 503); }

  try {
    await c.env.DB.prepare(
      'INSERT INTO email_requests (email, reason, contact, status, ip, ua, created_at) VALUES (?,?,?,?,?,?,?)'
    )
      .bind(mail, reason, contact, 'pending', ip, (c.req.header('user-agent') || '').slice(0, 300), now())
      .run();
  } catch {
    return fail(c, '申请服务暂不可用，请稍后再试', 503);
  }
  return ok(c, { status: 'pending' });
});

/** GET /api/email-request/status?email=... —— 只回状态，不泄露理由与联系方式 */
app.get('/email-request/status', async (c) => {
  const mail = norm(c.req.query('email'));
  if (!EMAIL_RE.test(mail)) return fail(c, '请填写有效的邮箱地址');
  return ok(c, { status: await latestStatus(c.env.DB, mail) });
});

export default app;
