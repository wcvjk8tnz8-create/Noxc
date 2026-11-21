/**
 * Noxc · 滑块拼图验证（服务端核心，零第三方依赖）
 *
 * 安全模型（很重要，别改成「把 x 藏起来」）：
 *   缺口坐标 x 必须下发给前端，否则画不出拼图；所以 x 在 DOM 里看得见是设计的一部分。
 *   真正的门槛是「没走完挑战就拿不到一次性票据」：
 *     1. challenge token 由 HMAC 签名，前端不能伪造 x / scope / 过期时间；
 *     2. 提交时服务端只认 token 里的 x，前端传来的 x 只用于比对；
 *     3. challenge 与 pass 各消耗一次 nonce（D1 主键），重放直接拒绝；
 *     4. pass 绑定用户 id，A 账号的票据不能给 B 账号用；
 *     5. 拖动轨迹做轻量人形判定，挡掉「直接 POST 一个 x」的脚本。
 *   因此绕过 UI 直接调注册接口拿不到有效 passToken，调验证接口也得先领取挑战。
 *
 * 本文件刻意不 import hono / util，纯函数 + Web Crypto，
 * 既能被 Worker 引用，也能被 scripts/captcha-test.mjs 单独 bundle 真跑。
 */

export const CAPTCHA = {
  w: 320,          // 舞台基准宽（前端按实际 DOM 宽等比缩放）
  h: 180,
  piece: 52,       // 拼图块边长
  tol: 8,          // 对齐容差（基准像素）
  ttl: 180_000,    // 挑战有效期 3 分钟
  passTtl: 120_000 // 通过后票据有效期 2 分钟
} as const;

/** 图库：public/img/captcha/<name>.webp，后台可改顺序 / 子集 */
export const CAPTCHA_IMAGES = ['typhoon', 'meoy', 'miku', 'cloud'] as const;

export const captchaScope = (userId: number | string) => `apply:${userId}`;

/* ── base64url / HMAC ────────────────────────────────────────────── */
function b64uBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uToBytes(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function uuid(): string {
  try { return crypto.randomUUID(); } catch {
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
}
function rand(n: number): number {
  const b = crypto.getRandomValues(new Uint32Array(1));
  return Math.floor((b[0] / 0x100000000) * n);
}
async function hmacKey(env: any): Promise<CryptoKey> {
  // 生产务必 `npx wrangler secret put CAPTCHA_SECRET`；本地/CI 未配置时用兜底值，
  // 保证首次部署就能跑（与 AI_API_KEY 等其它可选密钥同一处理口径）。
  const raw = String(env?.CAPTCHA_SECRET || env?.JWT_SECRET || 'terradata-captcha-dev-key');
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(raw),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}
export async function sign(env: any, payload: Record<string, unknown>): Promise<string> {
  const body = b64uBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(body)));
  return body + '.' + b64uBytes(mac);
}
export async function unsign(env: any, token: unknown): Promise<any | null> {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const ok = await crypto.subtle.verify(
      'HMAC', await hmacKey(env), b64uToBytes(parts[1]), new TextEncoder().encode(parts[0])
    );
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(b64uToBytes(parts[0])));
  } catch { return null; }
}

/* ── D1 一次性 nonce ─────────────────────────────────────────────── */
async function markUsed(env: any, id: string, kind: string, exp: number): Promise<boolean> {
  try {
    // 不用 INSERT OR IGNORE：主键冲突抛错本身就是「已用过」的信号，
    // 在本地 D1 mock / 老版本 D1 上都一致。
    await env.DB.prepare('INSERT INTO captcha_nonce (id, kind, exp) VALUES (?, ?, ?)')
      .bind(id, kind, exp).run();
    return true;
  } catch { return false; }
}
async function sweep(env: any): Promise<void> {
  try {
    await env.DB.prepare('DELETE FROM captcha_nonce WHERE exp < ?').bind(Date.now()).run();
  } catch { /* 表尚未建立：不影响签发 */ }
}

/* ── 开关与图库（后台可配，默认全开 + 四张图） ─────────────────── */
export async function captchaEnabled(env: any): Promise<boolean> {
  if (String(env?.CAPTCHA_ENABLED || '').trim() === '0') return false; // 应急关闭
  try {
    const row: any = await env.DB.prepare("SELECT value FROM settings WHERE key = 'captcha_enabled'").first();
    if (row && String(row.value).trim() === '0') return false;
  } catch { /* settings 表未建：默认开启 */ }
  return true;
}
export async function captchaImages(env: any): Promise<string[]> {
  try {
    const row: any = await env.DB.prepare("SELECT value FROM settings WHERE key = 'captcha_images'").first();
    const list = String(row?.value || '').split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => (CAPTCHA_IMAGES as readonly string[]).includes(s));
    if (list.length) return list;
  } catch { /* 表未建：用全量 */ }
  return [...CAPTCHA_IMAGES];
}

/* ── 拖动轨迹：轻量人形判定 ─────────────────────────────────────── */
/**
 * trace: [{ t: 相对毫秒, x: 基准坐标 }]，由前端 pointermove / 键盘真实采样。
 * 只挡「瞬移 / 太短 / 匀速直线脚本」，不追求行为生物识别，避免误伤真人。
 */
export function validateTrace(trace: unknown, submittedX: number, keyboard = false): boolean {
  if (!Array.isArray(trace)) return false;
  const pts = trace
    .filter((p: any) => p && Number.isFinite(p.t) && Number.isFinite(p.x))
    .map((p: any) => ({ t: Number(p.t), x: Number(p.x) }));
  if (pts.length < 4) return false;
  const last = pts[pts.length - 1];
  if (Math.abs(last.x - submittedX) > 2) return false;       // 终点必须与提交值一致
  const dur = last.t - pts[0].t;
  if (dur < 220 || dur > 60_000) return false;                // 至少 220ms，防脚本秒过
  const steps: Array<{ dx: number; dt: number }> = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dt = pts[i].t - pts[i - 1].t;
    if (dt < 0 || dx < -8 || dx > 90) return false;           // 时间倒流 / 大幅倒拖 / 瞬移
    steps.push({ dx, dt });
  }
  if (steps.every((s) => s.dx < 1)) return false;             // 根本没动
  if (!keyboard && steps.length >= 6) {
    const dts = steps.map((s) => s.dt), dxs = steps.map((s) => s.dx);
    const uniformT = Math.max(...dts) - Math.min(...dts) < 1.5;
    const uniformX = Math.max(...dxs) - Math.min(...dxs) < 0.6;
    if (uniformT && uniformX) return false;                   // 完美匀速直线 = 机器
  }
  return true;
}

/* ── 领取频控：同一用户 60 秒最多 40 次，挡住脚本无限领挑战 ───── */
export async function issueRateOk(env: any, userId: number | string): Promise<boolean> {
  const now = Date.now();
  try {
    const row: any = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM captcha_nonce WHERE kind = 'issue' AND exp > ? AND id LIKE ?"
    ).bind(now, `i:${userId}:%`).first();
    if (Number(row?.n || 0) >= 40) return false;
    await env.DB.prepare('INSERT INTO captcha_nonce (id, kind, exp) VALUES (?, ?, ?)')
      .bind(`i:${userId}:${uuid()}`, 'issue', now + 60_000).run();
    return true;
  } catch { return true; /* 表未建时不拦主流程 */ }
}

/* ── 三段式：签发 → 校验 → 消费 ─────────────────────────────────── */
export async function issueChallenge(env: any, scope: string): Promise<{
  id: string; token: string; img: string; x: number; y: number;
  w: number; h: number; piece: number; exp: number;
}> {
  const imgs = await captchaImages(env);
  const img = imgs[rand(imgs.length)];
  const x = 70 + rand(CAPTCHA.w - 70 - CAPTCHA.piece - 12);
  const y = 14 + rand(CAPTCHA.h - CAPTCHA.piece - 28);
  const id = uuid();
  const exp = Date.now() + CAPTCHA.ttl;
  const token = await sign(env, {
    v: 1, kind: 'challenge', id, img, x, y, scope, exp, nonce: uuid()
  });
  await sweep(env);
  return { id, token, img, x, y, w: CAPTCHA.w, h: CAPTCHA.h, piece: CAPTCHA.piece, exp };
}

export async function verifyChallenge(
  env: any,
  body: { id?: unknown; token?: unknown; x?: unknown; trace?: unknown; keyboard?: unknown },
  scope: string
): Promise<{ ok: true; passToken: string } | { ok: false; reason: string }> {
  const p = await unsign(env, body?.token);
  if (!p || p.v !== 1 || p.kind !== 'challenge') return { ok: false, reason: 'bad-token' };
  if (p.id !== body?.id) return { ok: false, reason: 'id-mismatch' };
  if (p.scope !== scope) return { ok: false, reason: 'scope-mismatch' };
  if (!Number.isFinite(p.exp) || p.exp < Date.now()) return { ok: false, reason: 'expired' };

  const submitted = Number(body?.x);
  if (!Number.isFinite(submitted) || Math.abs(submitted - p.x) > CAPTCHA.tol)
    return { ok: false, reason: 'misaligned' };
  if (!validateTrace(body?.trace, submitted, !!body?.keyboard))
    return { ok: false, reason: 'bad-trace' };
  if (!(await markUsed(env, 'c:' + p.id, 'challenge', p.exp)))
    return { ok: false, reason: 'replayed' };

  const passToken = await sign(env, {
    v: 1, kind: 'pass', id: uuid(), scope, exp: Date.now() + CAPTCHA.passTtl, nonce: p.nonce
  });
  return { ok: true, passToken };
}

/** 注册提交时调用：票据绑定用户、一次性消费，失败即 403 让前端重新出图 */
export async function consumePass(env: any, token: unknown, userId: number | string): Promise<boolean> {
  const p = await unsign(env, token);
  if (!p || p.v !== 1 || p.kind !== 'pass') return false;
  if (p.scope !== captchaScope(userId)) return false;
  if (!Number.isFinite(p.exp) || p.exp < Date.now()) return false;
  return markUsed(env, 'p:' + p.id, 'pass', p.exp);
}
