import { Hono } from 'hono';
import { ok } from '../lib/util.js';
import { showcaseItems } from '../lib/showcase.js';

/** GET /api/showcase —— 公开，不需要登录；只返回主动开启展示的域名 */
const app = new Hono();

app.get('/showcase', async (c) => {
  return ok(c, { items: await showcaseItems(c.env), defaultOff: true });
});

export default app;
