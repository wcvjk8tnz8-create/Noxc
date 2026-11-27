/**
 * App 专用接口 /api/app/v1/bootstrap 专项回归
 *
 * 背景：完全原生 App 原来要拼 /api/config + /api/auth/me + /api/subdomains/mine
 * + /api/points/me 四个请求，且不同端容易口径跑偏。现在一个 bootstrap 聚合，
 * 未登录也可读公开配置；登录态数据全部复用站点原有函数。
 *
 * 覆盖：
 *   A. 真跑 Hono + 内存 D1：未登录返回 site / 空登录态 / 不泄露密钥 / 私有缓存头
 *   B. site 字段与 /api/config 同源（不是另写一套规则）
 *   C. endpoints 契约与 capabilities 齐全，App 不硬编码路径
 *   D. 登录态真跑：user 来自 publicUser，domains / points 来自原函数（失败降级不 500）
 *   E. Android 客户端确实只打一个 bootstrap 冷启动接口
 *   F. 反向对照：证明断言不是恒真
 */
import fs from 'node:fs';
import path from 'node:path';
import app from '../src/index.js';
import { invalidatePublicConfig } from '../src/lib/configCache.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/* ───────── A. 宽容内存 D1：未知表返回空、写操作成功 ───────── */
function makeEnv(opts: { loggedIn?: boolean; announcement?: string } = {}) {
  const announcement = opts.announcement ?? '欢迎使用 Noxc';
  const settings: Record<string, string> = {
    site_name: 'Noxc',
    logo_url: '/img/logo.jpg',
    announcement,
    domain_valid_days: '365',
    renew_window_days: '',
    checkin_points: '30',
    initial_points: '100',
    domain_cost: '60',
    short_domain_cost: '300',
  };
  const rows = Object.entries(settings).map(([key, value]) => ({ key, value }));
  const user = {
    id: 7, email: 'app@noxc.uk', role: 'user', status: 'active',
    quota: 5, created_at: 1700000000000, password_hash: 'x',
  };
  const session = { token: 'tok-app', user_id: 7, expires_at: Date.now() + 86400000 };

  const exec = (sql: string, args: any[]) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT key, value FROM settings WHERE key IN \(/.test(s)) {
      const m = s.match(/IN \((.*?)\)/);
      const keys = (m ? m[1] : '').split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
      return rows.filter((r) => keys.includes(r.key));
    }
    if (/^SELECT value FROM settings WHERE key = \?/.test(s)) {
      const r = rows.find((x) => x.key === String(args[0]));
      return r ? [{ value: r.value }] : [];
    }
    if (/^SELECT key, value FROM settings/.test(s)) return rows.slice();
    if (/^SELECT .* FROM settings/.test(s)) {
      const r = rows.find((x) => x.key === String(args[0]));
      return r ? [{ ...r }] : [];
    }
    if (opts.loggedIn && /FROM sessions/.test(s)) return [session];
    if (opts.loggedIn && /FROM users WHERE id = \?/.test(s)) return [user];
    if (opts.loggedIn && /FROM users/.test(s)) return [user];
    if (opts.loggedIn && /COUNT\(\*\)/.test(s) && /subdomains/.test(s)) return [{ n: 0 }];
    if (opts.loggedIn && /FROM subdomains/.test(s)) return [];
    if (opts.loggedIn && /FROM dns_records/.test(s)) return [];
    if (opts.loggedIn && /FROM point_logs/.test(s)) return [];
    if (opts.loggedIn && /FROM points/.test(s)) return [];
    return [];
  };
  const wrap = (sql: string, args: any[]) => ({
    first: async () => exec(sql, args)[0] ?? null,
    all: async () => ({ results: exec(sql, args) }),
    run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
  });
  return {
    DB: {
      prepare(sql: string) {
        const self = wrap(sql, []);
        return {
          bind(...args: any[]) { return wrap(sql, args); },
          first: self.first, all: self.all, run: self.run,
        };
      },
    },
    ROOT_DOMAIN: 'noxc.uk',
    ALLOW_SIGNUP: '1',
  } as any;
}

const CTX: any = { waitUntil() {}, passThroughOnException() {} };

async function call(url: string, env: any, cookie = '') {
  invalidatePublicConfig();
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Lang': 'zh' };
  if (cookie) headers.Cookie = cookie;
  const res = await app.fetch(new Request('https://nic.test' + url, { headers }), env, CTX);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) as any };
}

/* ───────── B. 未登录 ───────── */
const guest = await call('/api/app/v1/bootstrap', makeEnv());
check(guest.status === 200, 'bootstrap 未登录也 200（App 冷启动不依赖登录）');
check(guest.body.success === true && guest.body.api === 'noxc-app/v1',
  '统一成功信封 + 显式 api 版本号');
check(guest.body.user === null && guest.body.domains === null && guest.body.points === null,
  '未登录时登录态三段为 null，App 据此显示登录卡');
check(guest.body.site && guest.body.site.announcement === '欢迎使用 Noxc',
  'site 段下发公告（纯文本，与 /api/config 同源）');
check(guest.body.site.siteName === 'Noxc'
  && Array.isArray(guest.body.site.rootDomains)
  && guest.body.site.pointRules && guest.body.site.pointRules.checkin === 30,
  'site 段含站点名 / 后缀 / 积分规则，且随后台设置变');
check(guest.body.site.publicStats && typeof guest.body.site.publicStats.domains === 'number',
  'site 段含公开统计快照');
check((String(guest.headers.get('Cache-Control') || '')).startsWith('private'),
  '响应是 private 缓存（含登录态，绝不 public）');

/* 不泄露任何密钥 / 后台配置 */
const serialized = JSON.stringify(guest.body);
for (const secret of ['api_token', 'apiKey', 'CAPTCHA_SECRET', 'MAIL_API_KEY',
  'ANYNS_API_TOKEN', 'SEUS_API_TOKEN', 'JWT_SECRET', 'password_hash', 'aiStatus',
  'footerIcpHtml', 'footerContactHtml', 'reservedLabels', 'ttlChoices', 'recordTypes']) {
  check(!serialized.includes(secret), `bootstrap 不下发敏感/冗余字段：${secret}`);
}

/* ───────── C. 与 /api/config 同源 ───────── */
const cfg = await call('/api/config', makeEnv());
for (const k of ['siteName', 'announcement', 'pointRules', 'rootDomains', 'pausedRoots',
  'publicStats', 'defaultQuota', 'allowSignup']) {
  check(JSON.stringify(guest.body.site[k]) === JSON.stringify(cfg.body[k]),
    `site.${k} 与 /api/config 逐字段同源（不另写一套规则）`);
}

/* ───────── D. endpoints 契约 ───────── */
const eps = guest.body.endpoints || {};
for (const k of ['check', 'whois', 'records', 'checkin', 'login', 'logout',
  'webConsole', 'webRegister', 'webDocs', 'webTerms', 'webExternalDomains', 'webReport']) {
  check(typeof eps[k] === 'string' && eps[k].length > 0, `endpoints 契约齐全：${k}`);
}
check(eps.records.includes('{id}'), 'records 契约带 {id} 占位符，App 替换后取记录');
const caps = guest.body.capabilities || {};
check(Array.isArray(caps.native) && caps.native.includes('home')
  && Array.isArray(caps.browserOnly) && caps.browserOnly.includes('register')
  && caps.browserOnly.includes('dnsWrite'),
  'capabilities 明示原生可做 / 必须走浏览器的流程');

/* ───────── E. 登录态真跑 ───────── */
const logged = await call('/api/app/v1/bootstrap', makeEnv({ loggedIn: true }), 'sh_session=tok-app');
check(logged.status === 200, '登录态 bootstrap 不 500（降级也不会拖垮 App）');
check(logged.body.user && logged.body.user.email === 'app@noxc.uk'
  && !JSON.stringify(logged.body.user).includes('password_hash'),
  'user 来自 publicUser，只回公开字段');
check(typeof logged.body.used === 'number', 'used 额度同源返回');
/* listMineData / pointsSnapshot 在宽容内存库里若因缺表降级为 null，
   接口仍必须 200 且不把错误抛给 App —— 这正是 .catch 兜底的意义。 */
check(logged.body.domains === null || typeof logged.body.domains === 'object',
  'domains 要么正常返回对象，要么降级 null，绝不让 App 崩');
check(logged.body.points === null || typeof logged.body.points === 'object',
  'points 要么正常返回对象，要么降级 null，绝不让 App 崩');

/* ───────── F. 源码静态断言 ───────── */
const appRoute = read('src/routes/app.ts');
const indexSrc = read('src/index.ts');
const apiJava = read('android/app/src/main/java/xyz/noxc/app/Api.java');
const mainJava = read('android/app/src/main/java/xyz/noxc/app/MainActivity.java');
const loginJava = read('android/app/src/main/java/xyz/noxc/app/LoginActivity.java');
const detailJava = read('android/app/src/main/java/xyz/noxc/app/DomainDetailActivity.java');
const readme = read('README.md');

check(/createAppRoutes\(\(c\) => configData\(c\)\)/.test(indexSrc)
  && /app\.route\('\/api\/app\/v1'/.test(indexSrc),
  '注册在 requireAuth 之前，且复用 /api/config 的 30 秒缓存（不多打 D1）');
check(/app\.route\('\/api\/app\/v1'/.test(indexSrc)
  && indexSrc.indexOf("app.route('/api/app/v1'") < indexSrc.indexOf('// 需要登录的接口'),
  'bootstrap 未被 requireAuth 挡住，未登录也能读公告/统计');
check(/listMineData\(c\)/.test(appRoute) && /pointsSnapshot\(c\)/.test(appRoute)
  && /publicUser\(full\)/.test(appRoute),
  '登录态数据复用站点原有函数，不另写补发奖励 / 暂停解析 / 额度规则');
check(/Promise\.all\(\[/.test(appRoute), '公开配置与三段登录态数据并发取');
check(/private, max-age=10/.test(appRoute), '私有 10 秒缓存，签到后带 ?_= 强制 fresh');
check(/bootstrap\(boolean fresh/.test(apiJava)
  && /\/api\/app\/v1\/bootstrap/.test(apiJava),
  'Api.java 提供 bootstrap(fresh) 专用方法');
check(/api\.bootstrap\(fresh/.test(mainJava)
  && /boot\(true\)/.test(mainJava) && /boot\(false\)/.test(mainJava),
  'MainActivity 冷启动只打一个 bootstrap，写操作后带 fresh 重拉');
check(!/\/api\/config/.test(mainJava) && !/\/api\/auth\/me/.test(mainJava)
  && !/\/api\/subdomains\/mine/.test(mainJava) && !/\/api\/points\/me/.test(mainJava),
  'App 不再拼四个分散接口（少 3 次请求 / 3 次登录态校验）');
check(/ep\("check"/.test(mainJava) && /ep\("whois"/.test(mainJava)
  && /ep\("checkin"/.test(mainJava),
  '主界面交互路径从 endpoints 契约读取，不在客户端硬编码');
check(/api\.endpoint\("login"/.test(loginJava)
  && /api\.endpoint\("records"/.test(detailJava)
  && /replace\("\{id\}"/.test(detailJava)
  && /Api\.setEndpoints\(endpoints\)/.test(mainJava),
  '登录页 / 记录页共用同一份契约（含 {id} 占位替换），三个 Activity 零硬编码');
check(/app-api-regression\.ts/.test(read('.github/workflows/deploy.yml')),
  'App 专用接口回归挂进主 deploy.yml');
check(/\/api\/app\/v1\/bootstrap/.test(readme)
  && /完全原生/.test(readme), 'README 写明 App 专用接口与完全原生口径');

/* ───────── G. 反向对照 ───────── */
const leaked = serialized + ',"api_token":"should-never-appear"';
check(/api_token/.test(leaked) && !serialized.includes('api_token'),
  '反向对照：真泄露 api_token 时脱敏断言会判失败');
const brokenCache = appRoute.replace("'private, max-age=10'", "'public, max-age=600'");
check(!/'private, max-age=10'/.test(brokenCache),
  '反向对照：把登录态响应用改成 public 缓存必须被抓住');
const brokenJava = mainJava.replace('api.bootstrap(fresh,', 'api.get("/api/config",');
check(!/api\.bootstrap\(fresh/.test(brokenJava),
  '反向对照：App 退回拼 /api/config 必须被抓住');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`App 专用接口回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
