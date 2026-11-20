/**
 * GET  /api/captcha/challenge  领取一次挑战（缺口图 + 签名 token）
 * POST /api/captcha/verify     提交对齐坐标与拖动轨迹，换取一次性 passToken
 *
 * 独立前缀，不能挂回 /api/subdomains：recordRoutes 先注册了
 * POST /api/subdomains/:id/verify（平台验证），形状与旧 /captcha/verify 完全相同，
 * `captcha` 会被当成域名 id 查库 → 404「子域名不存在」→ 永远拿不到票据。
 * 换到 /api/captcha 后，任何 /:id 路由都不可能再吃掉验证接口。
 * 由 /api/captcha 与 /api/captcha/* 上的 requireAuth 保护：未登录领不到挑战。
 */
import { Hono } from 'hono';
import { ok, fail } from '../lib/util.js';
import {
  captchaEnabled, captchaScope, issueRateOk, issueChallenge, verifyChallenge
} from '../lib/captcha.js';

const app = new Hono();

app.get('/challenge', async (c) => {
  const u: any = c.get('user');
  if (!(await captchaEnabled(c.env))) {
    // 后台关掉验证时不给图也不给票据，前端直接隐藏组件、注册接口同步放行
    return ok(c, { enabled: false });
  }
  if (!(await issueRateOk(c.env, u?.id ?? 'anon'))) {
    return fail(c, '验证请求过于频繁，请稍后再试', 429, { captchaRequired: true });
  }
  const ch = await issueChallenge(c.env, captchaScope(u?.id ?? 'anon'));
  return ok(c, { enabled: true, ...ch });
});

app.post('/verify', async (c) => {
  const u: any = c.get('user');
  if (!(await captchaEnabled(c.env))) return fail(c, '滑块验证已关闭', 400);
  const body = await c.req.json().catch(() => ({}));
  const r = await verifyChallenge(c.env, body as any, captchaScope(u?.id ?? 'anon'));
  if (!r.ok) {
    const msg = r.reason === 'expired' ? '验证已过期，请重新完成'
      : r.reason === 'misaligned' ? '没有对齐，换一张再试'
        : r.reason === 'bad-trace' ? '操作太快，请按住滑块拖动'
          : r.reason === 'replayed' ? '验证已使用，请重新完成'
            : '验证未通过，请重新完成';
    // captchaRequired 让注册页重新领图，避免用户卡在旧挑战上
    return fail(c, msg, 400, { captchaRequired: true, captchaReason: r.reason });
  }
  return ok(c, { passToken: r.passToken });
});

export default app;
