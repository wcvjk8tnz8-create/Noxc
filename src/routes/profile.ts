/**
 * 用户资料：昵称 / 头像（内置头像库）/ 简介 / UID
 * 独立表 user_profiles，不动 users 结构（避免已存在表补列失败）。
 */
import { Hono } from 'hono';
import { ok, fail, now, audit, clientIp } from '../lib/util.js';
import { AVATARS, DEFAULT_AVATAR, LEGACY_AVATAR } from '../lib/avatars.js';
import { issueCode, checkCode, mailConfig, mailEnabled } from '../lib/mail.js';
import { notify } from '../lib/notify.js';
import { blockedEmailDomain, BLOCKED_EMAIL_MESSAGE } from '../lib/emailRule.js';

const app = new Hono();

/** 更换邮箱专用的验证码场景，与注册 / 重置密码隔离 */
const EMAIL_CHANGE_SCENE = 'email_change';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * 老用户资料里可能存着旧版猫脸 SVG 的路径。
 * 统一归一化成新默认头像，保证顶栏与资料页永远一致。
 */
function normAvatar(v) {
  const s = String(v || '').trim();
  return !s || s === LEGACY_AVATAR ? DEFAULT_AVATAR : s;
}

/** 生成对外展示的 UID：不暴露自增 id */
function makeUid(userId) {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
  let n = userId * 7919 + 104729;
  let s = '';
  for (let i = 0; i < 7; i++) {
    s += ALPHABET[n % ALPHABET.length];
    n = Math.floor(n / ALPHABET.length) + 31;
  }
  return 'VX' + s;
}

/** 头像合法性：只接受站内头像库或 http(s) 外链 */
function safeAvatar(v) {
  const s = normAvatar(v);
  if (AVATARS.some((a) => a.url === s)) return s;
  // 旧版 12 张自绘猫脸 SVG：仍允许已保存的旧值继续读写
  if (/^\/img\/avatar\/[a-z0-9._-]+\.svg$/i.test(s)) return s;
  // 本站 R2 上传的头像：/api/avatar/<key>（key 限制为安全字符）
  if (/^\/api\/avatar\/[A-Za-z0-9._-]{1,120}$/.test(s)) return s;
  if (/^https:\/\/[^\s"']+\.(png|jpe?g|gif|webp|svg)(\?[^\s"']*)?$/i.test(s)) return s.slice(0, 500);
  return null; // 非法
}

/** 读取（不存在则自动创建初始资料） */
async function loadProfile(env, userId) {
  let p = await env.DB.prepare('SELECT * FROM user_profiles WHERE user_id = ?').bind(userId).first();
  if (!p) {
    const uid = makeUid(userId);
    await env.DB.prepare(
      'INSERT INTO user_profiles (user_id, uid, avatar, nickname, bio, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(userId, uid, DEFAULT_AVATAR, '', '', now())
      .run();
    p = { user_id: userId, uid, avatar: DEFAULT_AVATAR, nickname: '', bio: '' };
  }
  return p;
}

/** GET /api/profile —— 我的资料 + 头像库 */
app.get('/', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const p = await loadProfile(c.env, u.id);
  const full = await c.env.DB.prepare('SELECT created_at, last_login_at FROM users WHERE id = ?').bind(u.id).first();
  const dom = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subdomains WHERE user_id = ? AND status IN ('pending','approved','suspended')"
  )
    .bind(u.id)
    .first();
  const rec = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM dns_records r
     JOIN subdomains s ON s.id = r.subdomain_id
     WHERE s.user_id = ?`
  )
    .bind(u.id)
    .first();

  return ok(c, {
    profile: {
      uid: p.uid,
      avatar: normAvatar(p.avatar),
      nickname: p.nickname || '',
      bio: p.bio || '',
    },
    email: u.email,
    role: u.role,
    createdAt: full?.created_at || null,
    lastLoginAt: full?.last_login_at || null,
    domains: dom?.n || 0,
    records: rec?.n || 0,
    avatars: AVATARS,
  });
});

/** PUT /api/profile —— 更新昵称/头像/简介 */
app.put('/', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const body = await c.req.json().catch(() => ({}));

  const nickname = String(body.nickname ?? '').trim().slice(0, 24);
  const bio = String(body.bio ?? '').trim().slice(0, 160);
  const avatar = safeAvatar(body.avatar);
  if (body.avatar !== undefined && avatar === null) {
    return fail(c, '头像地址不合法：请选择内置头像，或填写 https 图片链接');
  }

  await loadProfile(c.env, u.id); // 确保有记录
  const sets = [];
  const vals = [];
  if (body.nickname !== undefined) { sets.push('nickname = ?'); vals.push(nickname); }
  if (body.bio !== undefined) { sets.push('bio = ?'); vals.push(bio); }
  if (body.avatar !== undefined) { sets.push('avatar = ?'); vals.push(avatar); }
  if (!sets.length) return fail(c, '没有要更新的内容');
  sets.push('updated_at = ?');
  vals.push(now(), u.id);

  await c.env.DB.prepare(`UPDATE user_profiles SET ${sets.join(', ')} WHERE user_id = ?`)
    .bind(...vals)
    .run();

  await audit(c, u.id, 'user.profile', u.email, sets.filter((s) => !s.startsWith('updated_at')).join(','));
  const p = await loadProfile(c.env, u.id);
  return ok(c, {
    profile: { uid: p.uid, avatar: normAvatar(p.avatar), nickname: p.nickname || '', bio: p.bio || '' },
  });
});


/**
 * 校验「想改成的新邮箱」是否可用。
 *
 * 只保留三道硬门槛：格式合法、不是硬性封禁域名（一次性 / 保留 TLD）、
 * 没有和当前邮箱相同、没被别的账号占用。
 * 刻意**不套注册白名单 / edu 规则**：那是「谁能新注册」的门槛，
 * 不是「已登录账号能不能换绑」的门槛。NodeLoc 登录建出来的账号、
 * 以及第三方邮箱申请通过的用户，都应该能靠「新邮箱收得到验证码」
 * 换成自己真正使用的地址。
 */
async function checkNewEmail(c: any, mail: string, currentEmail: string) {
  if (!EMAIL_RE.test(mail)) return '请填写有效的邮箱地址';
  if (mail === currentEmail) return '新邮箱不能与当前邮箱相同';
  if (blockedEmailDomain(mail)) return BLOCKED_EMAIL_MESSAGE;
  const taken: any = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(mail).first();
  if (taken) return '该邮箱已被其它账号使用';
  return '';
}

/** POST /api/profile/email/send —— 给新邮箱发更换邮箱验证码 */
app.post('/email/send', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const body = await c.req.json().catch(() => ({}));
  const mail = String(body?.email || '').trim().toLowerCase();

  const cfg = await mailConfig(c.env);
  if (!mailEnabled(cfg)) {
    return fail(
      c,
      '站点未配置邮件服务，无法发送验证码。请联系管理员在「站点设置 → 邮件与验证码」中配置 Resend 或 Brevo。',
      503,
      { mailNotConfigured: true }
    );
  }

  const current = String(u.email || '').trim().toLowerCase();
  const err = await checkNewEmail(c, mail, current);
  if (err) return fail(c, err, 400);

  // 节流：同一邮箱 60 秒内不重复发送；按 IP 也限一次，防止换邮箱穷举
  const recent: any = await c.env.DB.prepare(
    'SELECT created_at FROM email_verifications WHERE email = ? AND scene = ? ORDER BY id DESC LIMIT 1'
  ).bind(mail, EMAIL_CHANGE_SCENE).first();
  if (recent?.created_at && Date.now() - Number(recent.created_at) < 60_000) {
    return fail(c, '发送过于频繁，请 60 秒后再试');
  }

  const r = await issueCode(c.env, mail, EMAIL_CHANGE_SCENE, clientIp(c));
  if (!r.sent) return fail(c, r.warning || '验证码发送失败', 502);
  // 返回体不含验证码；devCode 只在未配置服务商时出现，上面已拦截
  return ok(c, { sent: true, expiresIn: 600 });
});

/** POST /api/profile/email/confirm —— 校验验证码并写入新邮箱 */
app.post('/email/confirm', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const body = await c.req.json().catch(() => ({}));
  const mail = String(body?.email || '').trim().toLowerCase();
  const code = String(body?.code || '').trim();

  const current = String(u.email || '').trim().toLowerCase();
  const err = await checkNewEmail(c, mail, current);
  if (err) return fail(c, err, 400);

  // checkCode 通过后会把该码标记 used，天然一次性
  const v = await checkCode(c.env, mail, EMAIL_CHANGE_SCENE, code);
  if (!v.ok) return fail(c, v.reason || '验证码不正确', 400, { needCode: true });

  // 并发兜底：发码到确认之间邮箱可能被人抢注，再查一次
  const taken: any = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id <> ?')
    .bind(mail, u.id).first();
  if (taken) return fail(c, '该邮箱已被其它账号使用', 400);

  try {
    await c.env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(mail, u.id).run();
  } catch {
    return fail(c, '邮箱更新失败，请稍后重试');
  }
  // NodeLoc 绑定奖励记录里也存过邮箱，/status 要跟着显示新值。
  // 注意：oauth_bindings 的 provider+sub 不变，用户自助改的邮箱不会被下次
  // OAuth 登录覆盖（repairOauthEmail 只认 nl.<hex>@oauth.local 占位格式）。
  await c.env.DB.prepare('UPDATE oauth_quota_grants SET email = ? WHERE provider = ? AND user_id = ?')
    .bind(mail, 'nodeloc', u.id).run().catch(() => null);

  await audit(c, u.id, 'user.email_change', current, `${current} → ${mail}（新邮箱验证码通过）`);
  // 拆成固定短句 + 变量，英文模式下前端词典能逐句翻译，不会整段夹生
  await notify(
    c.env, u.id, 'system', '账号邮箱已更换',
    `你的邮箱已更换。新邮箱：${mail}；原邮箱：${current}；操作 IP：${clientIp(c) || '未知'}。若非本人操作请立即联系管理员。`,
    '/profile.html'
  ).catch(() => null);
  return ok(c, { email: mail });
});

/** POST /api/profile/avatar —— 上传自定义头像到 R2（multipart/form-data） */
app.post('/avatar', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  // 头像上传一律按「未启用」处理：项目当前不绑定 R2（wrangler.toml 无 [[r2_buckets]]），
  // 即使账号里存在桶也不启用 —— 避免因 R2 未就绪导致部署失败或上传报错。
  // 用户仍可使用内置头像库或填写外链头像。
  if (!c.env.AVATARS || String(c.env.AVATAR_ENABLED || '').trim() !== '1') {
    return fail(c, '当前未开放自定义头像上传，可从内置头像库中选择或填写头像链接', 501);
  }

  let form;
  try { form = await c.req.formData(); } catch { return fail(c, '上传格式不正确'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return fail(c, '请选择图片文件');

  const maxKb = Number(c.env.AVATAR_MAX_KB || 2048);
  if (file.size > maxKb * 1024) return fail(c, `图片不能超过 ${maxKb} KB`);
  if (file.size < 16) return fail(c, '图片文件无效');

  // 只接受图片类型
  const type = String(file.type || '').toLowerCase();
  const extMap = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
    'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  };
  const ext = extMap[type];
  if (!ext) return fail(c, '仅支持 PNG / JPG / GIF / WebP / SVG 图片');
  if (ext === 'svg') return fail(c, '出于安全考虑不支持 SVG，请上传 PNG / JPG');

  // 读取前 8 字节校验图片魔数，防止伪造 Content-Type
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const magicOk =
    (ext === 'png' && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) ||
    (ext === 'jpg' && head[0] === 0xff && head[1] === 0xd8) ||
    (ext === 'gif' && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) ||
    (ext === 'webp' && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46);
  if (!magicOk) return fail(c, '文件内容与声明的类型不符，请上传真实图片');

  const key = `u${u.id}-${Date.now().toString(36)}.${ext}`;
  await c.env.AVATARS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` },
  });

  // 公网地址：后台设置优先，其次环境变量；都没有就用 Worker 代理
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'r2_public_url'").first();
  const publicBase = (String(row?.value || '').trim() || String(c.env.R2_PUBLIC_URL || '').trim()).replace(/\/$/, '');
  const url = publicBase ? `${publicBase}/${key}` : `/api/avatar/${key}`;

  await loadProfile(c.env, u.id);
  await c.env.DB.prepare('UPDATE user_profiles SET avatar = ?, updated_at = ? WHERE user_id = ?')
    .bind(url, now(), u.id)
    .run();
  await audit(c, u.id, 'user.avatar.upload', u.email, key);

  return ok(c, { url, key });
});

export default app;
