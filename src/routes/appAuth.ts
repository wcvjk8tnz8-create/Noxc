/**
 * App 浏览器授权登录 · /api/app/v1/auth/*
 *
 * 背景：App 直接跳 /api/auth/github/start 在 Custom Tab 里经常只剩空白页
 * （授权跳转被浏览器安全上下文挡住 / 未配置凭据时返回 JSON），真机不可用。
 * 改成「浏览器里登录 → 一次性授权码 → App 换会话」：
 *
 *   1. 用户在浏览器（Custom Tab 里打开的 /app-authorize）用任意方式登录：
 *      邮箱密码、GitHub、NodeLoc 都行，登录态就是站点的 sh_session。
 *   2. 登录后点「授权给 App」→ POST /issue：服务端新建一条**真实 session**，
 *      把 token 绑到一个 12 位一次性码上（5 分钟有效，单次消费）。
 *   3. 页面显示码 + 一键 `noxc://auth?code=` 回 App；也可复制后回 App 粘贴。
 *   4. App POST /exchange 换到 sh_session（Set-Cookie + 响应体双保险）。
 *
 * 安全：码由 Web Crypto 随机生成、绑定用户、5 分钟过期、单次消费、用后即焚；
 * 泄露的码不能二次使用，也不能换到别人的会话。session 仍是站点原有 sessions
 * 表，权限 / 封禁 / 过期判定完全一致，没有另开一条认证旁路。
 */
import { Hono } from 'hono';
import { ok, fail, now } from '../lib/util.js';
import { randomToken } from '../lib/crypto.js';
import { createSession, setSessionCookie } from '../middleware/auth.js';
import { publicUser } from './auth.js';

const app = new Hono();

const CODE_TTL = 5 * 60 * 1000;

/** 幂等建表：与 abuse.ts 同口径，不依赖部署脚本先跑 migration。 */
async function ensureTable(env: any) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS app_auth_codes (
       code TEXT PRIMARY KEY,
       token TEXT NOT NULL,
       user_id INTEGER NOT NULL,
       max_age INTEGER NOT NULL,
       exp INTEGER NOT NULL,
       used INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL
     )`
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_app_auth_exp ON app_auth_codes(exp)').run();
}

function cleanCode(raw: unknown) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
}

/** POST /issue —— 必须已登录（浏览器里的 sh_session）。 */
app.post('/issue', async (c) => {
  const u: any = c.get('user');
  if (!u) return fail(c, '请先在浏览器登录站点，再点「授权给 App」', 401, { needLogin: true });
  if (u.status === 'banned') return fail(c, '账号已被封禁，无法授权', 403);

  await ensureTable(c.env);
  const { token, maxAge } = await createSession(c, u.id, true);
  const code = randomToken(6).toUpperCase();   // 12 位 hex，展示成 XXXX-XXXX-XXXX
  await c.env.DB.prepare(
    `INSERT INTO app_auth_codes (code, token, user_id, max_age, exp, used, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).bind(code, token, u.id, maxAge, now() + CODE_TTL, now()).run();

  // 顺手清掉过期码，表不会越攒越大
  await c.env.DB.prepare('DELETE FROM app_auth_codes WHERE exp < ?').bind(now()).run();

  return ok(c, {
    code,
    display: code.replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3'),
    expiresIn: Math.floor(CODE_TTL / 1000),
    email: u.email,
  });
});

/** POST /exchange —— 公开，凭一次性码换会话。 */
app.post('/exchange', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const code = cleanCode(body?.code);
  if (code.length < 8) return fail(c, '请填写浏览器里显示的授权码', 400);

  await ensureTable(c.env);
  const row: any = await c.env.DB.prepare(
    'SELECT * FROM app_auth_codes WHERE code = ?'
  ).bind(code).first();
  if (!row) return fail(c, '授权码无效或已使用，请重新授权', 404);
  if (Number(row.used) === 1) return fail(c, '授权码已使用，请重新授权', 400);
  if (Number(row.exp) < now()) return fail(c, '授权码已过期，请重新授权', 400);

  // 先标记消费，避免并发重复兑换；后面校验失败也不回滚（宁可让用户重发一次）
  await c.env.DB.prepare('UPDATE app_auth_codes SET used = 1 WHERE code = ?').bind(code).run();

  const sess: any = await c.env.DB.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE token = ?'
  ).bind(row.token).first();
  if (!sess || Number(sess.expires_at) < now()) {
    return fail(c, '授权会话已失效，请重新授权', 400);
  }
  const u: any = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(sess.user_id).first();
  if (!u) return fail(c, '账号不存在', 404);
  if (u.status === 'banned') return fail(c, '账号已被封禁', 403);

  setSessionCookie(c, row.token, Number(row.max_age) || 60 * 60 * 24 * 30);
  // 响应体也带 token：个别 WebView / 代理会吞 Set-Cookie，App 可直接存 SharedPreferences
  return ok(c, { token: row.token, user: publicUser(u) });
});

/** 浏览器授权页：Worker 直出，不走前端构建链，永远能打开。 */
export function authorizePage() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>授权 Noxc App · Authorize</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100vh;background:#101014;color:#F3F3F6;
 font:15px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
 display:flex;align-items:center;justify-content:center;padding:24px}
main{width:100%;max-width:420px;background:#1A1A20;border:1px solid #2C2C34;
 border-radius:24px;padding:28px 24px;box-shadow:0 18px 50px rgba(0,0,0,.45)}
h1{margin:0 0 6px;font-size:22px;letter-spacing:.3px}
p.sub{margin:0 0 22px;color:#9A9AA6;font-size:13px}
.who{background:#121218;border:1px solid #2C2C34;border-radius:16px;padding:14px 16px;margin-bottom:18px;word-break:break-all}
.who b{color:#FF7BC2;font-weight:600}
button,.btn{display:block;width:100%;border:0;border-radius:999px;padding:14px 18px;
 font-size:15px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;margin-top:12px}
.pink{background:#FF7BC2;color:#15151A}
.ghost{background:#2A2A33;color:#F3F3F6}
.code{font:700 26px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:2px;
 text-align:center;background:#121218;border:1px dashed #FF7BC2;border-radius:16px;
 padding:18px 10px;margin:8px 0 4px;word-break:break-all}
.note{color:#9A9AA6;font-size:12px;margin-top:16px;line-height:1.7}
.err{color:#E58A8A;font-size:13px;margin-top:12px;min-height:18px}
.hidden{display:none}
ol{color:#9A9AA6;font-size:13px;padding-left:20px;margin:18px 0 0}
li{margin-bottom:6px}
</style></head><body><main>
<h1>授权 Noxc App</h1>
<p class="sub">Authorize this device · 不会暴露你的密码</p>

<div id="loading" class="who">正在检查登录状态…</div>
<div id="needLogin" class="hidden">
  <div class="who">还没登录。请先在浏览器里用<b>邮箱密码 / GitHub / NodeLoc</b>登录站点，再回到这个页面。</div>
  <a class="btn pink" href="/login">去登录站点</a>
  <button class="ghost" onclick="location.reload()">我已登录，刷新</button>
</div>
<div id="ready" class="hidden">
  <div class="who">当前账号：<b id="email"></b></div>
  <button class="pink" id="issue">授权给 App</button>
  <ol><li>点上面的按钮拿到一次性授权码</li><li>点「一键返回 App」，或复制码回 App 粘贴</li><li>授权码 5 分钟有效、只能用一次</li></ol>
</div>
<div id="done" class="hidden">
  <div class="code" id="code"></div>
  <a class="btn pink" id="deep" href="#">一键返回 App</a>
  <button class="ghost" id="copy">复制授权码</button>
  <div class="note">如果「一键返回 App」没反应，请手动切回 Noxc App，点登录页的「输入授权码」粘贴上面的码。也可以直接点 <a href="/" style="color:#FF7BC2">回到站点首页</a>。</div>
  <button class="ghost" onclick="location.reload()">重新生成</button>
</div>
<div class="err" id="err"></div>
</main>
<script>
const $ = id => document.getElementById(id);
const show = id => ['loading','needLogin','ready','done'].forEach(x => $(x).classList.toggle('hidden', x !== id));
const err = m => { $('err').textContent = m || ''; };
async function boot() {
  err(''); show('loading');
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const j = await r.json();
    const u = j && j.user;
    if (!u) { show('needLogin'); return; }
    $('email').textContent = u.email || '';
    show('ready');
  } catch (e) { show('needLogin'); }
}
$('issue').onclick = async () => {
  err(''); $('issue').disabled = true;
  try {
    const r = await fetch('/api/app/v1/auth/issue', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.message || '授权失败');
    $('code').textContent = j.display || j.code;
    $('deep').href = 'noxc://auth?code=' + encodeURIComponent(j.code);
    $('copy').onclick = () => {
      const t = j.code;
      if (navigator.clipboard) navigator.clipboard.writeText(t).catch(()=>{});
      $('copy').textContent = '已复制 ' + t;
    };
    show('done');
  } catch (e) { err(e.message || '授权失败，请重试'); }
  finally { $('issue').disabled = false; }
};
boot();
</script></body></html>`;
}

export default app;
