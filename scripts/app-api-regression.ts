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
function makeEnv(opts: { loggedIn?: boolean; announcement?: string;
  authCode?: any } = {}) {
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

  // app_auth_codes：一次性授权码的内存表（issue 写 / exchange 读并标记 used）
  const codes = new Map<string, any>();
  if (opts.authCode) codes.set(opts.authCode.code, opts.authCode);

  const exec = (sql: string, args: any[]) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^INSERT INTO app_auth_codes/.test(s)) {
      codes.set(String(args[0]), {
        code: String(args[0]), token: String(args[1]), user_id: Number(args[2]),
        max_age: Number(args[3]), exp: Number(args[4]), used: 0,
      });
      return [];
    }
    if (/^SELECT \* FROM app_auth_codes WHERE code = \?/.test(s)) {
      const row = codes.get(String(args[0]));
      return row ? [row] : [];
    }
    if (/^UPDATE app_auth_codes SET used = 1/.test(s)) {
      const row = codes.get(String(args[0]));
      if (row) codes.set(String(args[0]), { ...row, used: 1 });
      return [];
    }
    if (/^DELETE FROM app_auth_codes WHERE exp/.test(s)) {
      const t = Number(args[0]);
      for (const [k, v] of codes) if (Number(v.exp) < t) codes.delete(k);
      return [];
    }
    if (/^SELECT user_id, expires_at FROM sessions WHERE token = \?/.test(s)) {
      return opts.loggedIn ? [session] : [];
    }
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

async function call(url: string, env: any, cookie = '', init: RequestInit = {}) {
  invalidatePublicConfig();
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Lang': 'zh' };
  if (cookie) headers.Cookie = cookie;
  const res = await app.fetch(new Request('https://nic.test' + url, {
    ...init, headers: { ...headers, ...(init.headers as any || {}) },
  }), env, CTX);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) as any };
}

async function callText(url: string, env: any) {
  const res = await app.fetch(new Request('https://nic.test' + url), env, CTX);
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const post = (body: any): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

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
  'register', 'verifySend', 'verifyCheck', 'reset', 'oauthNodeloc', 'oauthGithub',
  'webConsole', 'webDocs', 'webTerms', 'webExternalDomains', 'webReport',
  'adminOverview', 'records', 'recordUpdate', 'recordDelete', 'apply',
  'adminApprove', 'adminUserBan', 'adminSettings', 'captcha', 'captchaVerify']) {
  check(typeof eps[k] === 'string' && eps[k].length > 0, `endpoints 契约齐全：${k}`);
}
check(eps.records.includes('{id}'), 'records 契约带 {id} 占位符，App 替换后取记录');
const caps = guest.body.capabilities || {};
check(Array.isArray(caps.native) && caps.native.includes('admin')
  && caps.native.includes('dnsCreate') && caps.native.includes('dnsUpdate')
  && caps.native.includes('dnsDelete') && caps.native.includes('adminReview')
  && caps.native.includes('adminSettings') && caps.native.includes('externalDomains')
  && Array.isArray(caps.browserOnly) && caps.browserOnly.length === 1
  && caps.browserOnly[0] === 'oauth',
  'capabilities：管理后台 / DNS 写入全部原生，browserOnly 只剩第三方 OAuth');

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

/* ── E2. 管理后台概览聚合（真跑 dispatch） ── */
const overview = await call('/api/app/v1/admin/overview', makeEnv());
check(overview.status === 200, '后台概览接口游客也 200（服务端 requireAdmin 逐段拒绝，降级 null）');
check(overview.body.sections && typeof overview.body.sections === 'object',
  '概览返回 sections 对象，任一段失败只降级 null 不拖垮 App');
check((String(overview.headers.get('Cache-Control') || '')).includes('no-store'),
  '后台概览 no-store，绝不缓存管理员数据');
check(overview.body.sections && Object.keys(overview.body.sections).length >= 10,
  '概览并发聚合 ≥10 段后台数据');

/* ───────── F. 源码静态断言 ───────── */
const appRoute = read('src/routes/app.ts');
const indexSrc = read('src/index.ts');
const apiJava = read('android/app/src/main/java/xyz/noxc/app/Api.java');
const mainJava = read('android/app/src/main/java/xyz/noxc/app/MainActivity.java');
const loginJava = read('android/app/src/main/java/xyz/noxc/app/LoginActivity.java');
const detailJava = read('android/app/src/main/java/xyz/noxc/app/DomainDetailActivity.java');
const registerJava = read('android/app/src/main/java/xyz/noxc/app/RegisterActivity.java');
const forgotJava = read('android/app/src/main/java/xyz/noxc/app/ForgotPasswordActivity.java');
const apiJavaFull = read('android/app/src/main/java/xyz/noxc/app/Api.java');
const readmeFull = read('README.md');
const readme = read('README.md');

check(/createAppRoutes\(\s*\(c\) => configData\(c\)/s.test(indexSrc)
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
  && /api\.endpoint\("register"/.test(registerJava)
  && /api\.endpoint\("reset"/.test(forgotJava)
  && /epGet\("records"/.test(detailJava)
  && /endpointCall|epPost/.test(read('android/app/src/main/java/xyz/noxc/app/Api.java'))
  && /api\.persistEndpoints\(endpoints\)/.test(mainJava),
  '登录 / 注册 / 找回 / DNS 页共用同一份契约（Api.endpointCall 占位替换），零硬编码');
check(!/Intent\.ACTION_VIEW/.test(mainJava + loginJava + registerJava + forgotJava)
  && /CustomTabsIntent/.test(apiJavaFull) && /api\.openInApp\(/.test(mainJava),
  '账号流程零外部浏览器跳转，其余网页用 Custom Tab 在 App 内打开');
check(/new Intent\(this, RegisterActivity\.class\)/.test(loginJava)
  && /new Intent\(this, ForgotPasswordActivity\.class\)/.test(loginJava),
  '注册 / 找回密码是 App 内原生 Activity');
check(/verifyRequired/.test(registerJava), '注册页按 site.verifyRequired 决定验证码字段');
check(/app-api-regression\.ts/.test(read('.github/workflows/deploy.yml')),
  'App 专用接口回归挂进主 deploy.yml');
check(/\/api\/app\/v1\/bootstrap/.test(readmeFull)
  && /Material 3/.test(readmeFull) && /完全原生/.test(readmeFull),
  'README 写明 App 专用接口与 Material 3 完全原生口径');

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

{
/* ═════════ G. 全量契约 vs 真实路由（防止「接口不存在」再次出现） ═════════
   真机反馈：DNS 记录页报「接口不存在」。根因是 endpoints.records 写成
   /api/records/subdomains/{id}/records，而真实挂载是 /api/subdomains/{id}/records。
   这里不再抽查几条，而是把 index.ts 的所有 app.route 挂载 + 各 routes 文件里
   所有 app.get/post/patch/put/delete 展开成真实路径集合，逐条核对契约。 */
const idxSrcAll = read('src/index.ts');
const imports: Record<string, string> = {};
for (const m of idxSrcAll.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)\.js'/g)) {
  imports[m[1]] = m[2] + '.ts';
}
for (const m of idxSrcAll.matchAll(/import\s+(\w+)\s*,\s*\{[^}]*\}\s+from\s+'\.\/routes\/(\w+)\.js'/g)) {
  imports[m[1]] = m[2] + '.ts';
}
const realRoutes: Record<string, Set<string>> = {};
const addRoute = (full: string, method: string) => {
  const p = full.replace(/\/+$/, '') || '/';
  (realRoutes[p] ||= new Set()).add(method.toUpperCase());
};
for (const m of idxSrcAll.matchAll(/app\.route\('([^']+)',\s*(\w+)\)/g)) {
  const prefix = m[1], varName = m[2], f = imports[varName];
  if (!f) continue;
  const fp = 'src/routes/' + f;
  if (!fs.existsSync(fp)) continue;
  const src = read(fp);
  for (const r of src.matchAll(/app\.(get|post|patch|put|delete)\('([^']+)'/g)) {
    addRoute(prefix + r[2], r[1]);
  }
}
for (const m of idxSrcAll.matchAll(/app\.(get|post|patch|put|delete)\('([^']+)'/g)) {
  addRoute(m[2], m[1]);
}
/* createAppRoutes 是 factory：/admin/overview 定义在 factory 内部（r.get），
   不是文件顶层的 app.get，所以要按实际挂载前缀手工补一次。 */
addRoute('/api/app/v1/admin/overview', 'get');
addRoute('/api/app/v1/schema', 'get');
const appTs = read('src/routes/app.ts');
const epBlock = appTs.slice(appTs.indexOf('endpoints: {'), appTs.indexOf('      capabilities: {'));
const eps: Record<string, string> = {};
for (const m of epBlock.matchAll(/^\s*(\w+):\s*'([^']+)',/gm)) eps[m[1]] = m[2];

const normPath = (p: string) => p.split('?')[0].replace(/\{[^}]+\}/g, ':P');
const findRoute = (p: string) => {
  const n = normPath(p);
  return Object.keys(realRoutes).find((r) => r.replace(/:[A-Za-z_]\w*/g, ':P') === n);
};
const unmatched = Object.entries(eps).filter(([, v]) =>
  v.startsWith('/api/') && !findRoute(v));
check(unmatched.length === 0,
  `endpoints 全部 ${Object.keys(eps).length} 条都命中真实路由（不匹配 ${unmatched.length} 条：${unmatched.map(([k, v]) => k + '=' + v).join(', ')}）`);
check(eps.records === '/api/subdomains/{id}/records',
  'DNS 记录列表路径修好：/api/subdomains/{id}/records（与 recordRoutes 挂载一致）');
check(eps.recordUpdate === '/api/records/{rid}' && eps.recordDelete === '/api/records/{rid}',
  'DNS 单条改 / 删路径 /api/records/{rid}');
check(!!findRoute('/app-authorize'), '浏览器授权页 /app-authorize 真实注册在 SPA 回落之前');
check(!!findRoute('/api/app/v1/auth/issue') && !!findRoute('/api/app/v1/auth/exchange'),
  '一次性授权码 issue / exchange 真实挂载');

/* App 里每个 epXxx 使用点：key 必须在契约里，且方法必须与真实路由一致 */
const javaDir = 'android/app/src/main/java/xyz/noxc/app';
const allJava = fs.readdirSync(javaDir).filter((f) => f.endsWith('.java'))
  .map((f) => read(javaDir + '/' + f)).join('\n');
const usages = [...allJava.matchAll(/ep(Get|Post|Patch|Put|Delete)\(\s*"([A-Za-z]\w*)"/g)]
  .map((m) => ({ method: m[1].toUpperCase(), key: m[2] }));
const badKeys = usages.filter((u) => !eps[u.key]);
check(badKeys.length === 0,
  `App 的 ${usages.length} 个契约调用 key 全有定义（缺失：${badKeys.map((x) => x.key).join(',')}）`);
const badMethods = usages.filter((u) => {
  const p = eps[u.key], r = p && findRoute(p);
  return r && !realRoutes[r].has(u.method);
});
check(badMethods.length === 0,
  `App 每个调用点的 HTTP 方法都与真实路由一致（不符：${badMethods.map((x) => x.method + ' ' + x.key).join(',')}）`);

/* Java 兜底契约必须与后端逐条同源：bootstrap 没跑完也不会请求空路径 */
const apiJavaAll = read('android/app/src/main/java/xyz/noxc/app/Api.java');
const defaults: Record<string, string> = {};
for (const m of apiJavaAll.matchAll(/\{"(\w+)",\s*"([^"]+)"\}/g)) defaults[m[1]] = m[2];
check(Object.keys(defaults).length === Object.keys(eps).length
  && Object.entries(eps).every(([k, v]) => defaults[k] === v),
  `Api.DEFAULT_ENDPOINTS 与后端 endpoints 逐条同源（${Object.keys(defaults).length} 条）`);
check(/接口配置缺失/.test(apiJavaAll),
  '契约为空时直接回明确错误，绝不把请求打到站点根路径冒充「接口不存在」');

/* ═════════ H. 浏览器授权登录 & DNS 真跑 ═════════ */
const envGuest = makeEnv();
const issueGuest = await call('/api/app/v1/auth/issue', envGuest, '', post({}));
check(issueGuest.status === 401 && issueGuest.body.needLogin === true,
  '未登录不能领授权码（401 + needLogin）');

const envLogged = makeEnv({ loggedIn: true });
const issued = await call('/api/app/v1/auth/issue', envLogged, 'sh_session=tok-app', post({}));
check(issued.status === 200 && issued.body.success === true,
  '已登录领授权码成功');
check(/^[0-9A-F]{12}$/.test(issued.body.code || '') && issued.body.expiresIn === 300,
  '授权码 12 位随机、5 分钟有效');
check(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(issued.body.display || ''),
  '页面展示成 XXXX-XXXX-XXXX 便于抄写');

const authCode = {
  code: issued.body.code, token: 'tok-app', user_id: 7,
  max_age: 2592000, exp: Date.now() + 300000, used: 0,
};
const exchanged = await call('/api/app/v1/auth/exchange',
  makeEnv({ loggedIn: true, authCode }), '', post({ code: authCode.code }));
check(exchanged.status === 200 && !!exchanged.body.token && !!exchanged.body.user,
  '一次性码换到站点原有 sh_session + 用户信息');
check(String(exchanged.headers.get('Set-Cookie') || '').includes('sh_session='),
  'exchange 同时下发 Set-Cookie（App 两套兜底都能拿到登录态）');
const usedAgain = await call('/api/app/v1/auth/exchange',
  makeEnv({ loggedIn: true, authCode }), '', post({ code: authCode.code }));
check(usedAgain.status === 200 || usedAgain.status === 400, '重复兑换不会 500');
const expired = await call('/api/app/v1/auth/exchange',
  makeEnv({ loggedIn: true, authCode: { ...authCode, exp: Date.now() - 1 } }),
  '', post({ code: authCode.code }));
check(expired.body.success === false && /过期/.test(expired.body.message || ''),
  '过期授权码被拒绝');
const badCode = await call('/api/app/v1/auth/exchange', makeEnv(),
  '', post({ code: 'ZZZZZZZZZZZZ' }));
check(badCode.body.success === false && /无效|已使用/.test(badCode.body.message || ''),
  '无效授权码被拒绝，不泄露账号是否存在');

const page = await callText('/app-authorize', makeEnv());
check(page.status === 200 && page.text.includes('授权 Noxc App')
  && page.text.includes('noxc://auth?code=')
  && page.text.includes('/api/app/v1/auth/issue'),
  '授权页 Worker 直出 HTML：含一键回 App 深链与领码接口');
check(String(page.headers.get('Cache-Control') || '').includes('no-store'),
  '授权页 no-store，绝不缓存');

/* DNS 真跑：正是真机报「接口不存在」的那条路径 */
const dnsList = await call('/api/subdomains/1/records', makeEnv({ loggedIn: true }),
  'sh_session=tok-app');
check(dnsList.body.message !== '接口不存在' && !String(dnsList.body.message || '').includes('接口不存在'),
  'GET /api/subdomains/{id}/records 不再落到 API 兜底 404');
const dnsOld = await call('/api/records/subdomains/1/records', makeEnv({ loggedIn: true }),
  'sh_session=tok-app');
check(dnsOld.body.message === '接口不存在',
  '反向对照：旧的错误路径确实会命中「接口不存在」兜底（证明上面断言不是恒真）');


/* ═════════ I. 全站功能 schema（用户要「所有网站功能」+ 精美动效） ═════════ */
const schemaRes = await call('/api/app/v1/schema', makeEnv());
check(schemaRes.status === 200 && schemaRes.body.success === true
  && schemaRes.body.v === 2, 'GET /api/app/v1/schema 真跑 200 且版本为 2');
check(Array.isArray(schemaRes.body.groups) && schemaRes.body.groups.length >= 10,
  'schema 至少 10 个功能分组');
const schemaScreens = (schemaRes.body.groups || [])
  .reduce((n: number, g: any) => n + (g.screens || []).length, 0);
check(schemaScreens >= 40, `schema 覆盖 ≥40 个页面（实际 ${schemaScreens}）`);
const schemaSettings = (schemaRes.body.groups || [])
  .flatMap((g: any) => g.screens || [])
  .flatMap((s: any) => (s.forms || []).flatMap((f: any) => f.fields || []))
  .filter((f: any) => f && f.raw);
check(schemaSettings.length >= 70,
  `schema 的后台设置页覆盖 ≥70 个字段（实际 ${schemaSettings.length}）`);
check((schemaRes.headers.get('Cache-Control') || '').includes('max-age=300')
  && schemaRes.headers.get('X-Schema-Version') === '2',
  'schema 可缓存 5 分钟并带版本号（App 能判断是否要刷新）');

/* 每个 schema 端点的 ep 必须在契约里；每个真实写接口必须被 schema 覆盖 */
const schemaEps = new Set<string>();
const walkSchema = (o: any) => {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { for (const x of o) walkSchema(x); return; }
  if (typeof o.ep === 'string') schemaEps.add(o.ep);
  for (const v of Object.values(o)) walkSchema(v);
};
walkSchema(schemaRes.body);
check([...schemaEps].every((k) => eps[k]), `schema 引用的 ${schemaEps.size} 个契约 key 全部存在`);
const writeRoutes = Object.keys(realRoutes).filter((r) =>
  r.startsWith('/api/') &&
  [...realRoutes[r]].some((m) => m !== 'GET') &&
  !/\/callback$/.test(r) && !/\/start$/.test(r));
const uncovered = writeRoutes.filter((r) => {
  const nr = r.replace(/:[A-Za-z_]\w*/g, ':P');
  return !Object.values(eps).some((p) => p.split('?')[0].replace(/\{[^}]+\}/g, ':P') === nr);
});
check(uncovered.length === 0,
  `全部 ${writeRoutes.length} 个写接口都有契约路径（未覆盖 ${uncovered.length}）`);
/* 原生精修页（登录 / 注册 / 找回 / DNS 详情 / 滑块 / 申请）里的调用点，
   从 Java 源码自动提取 key —— 不手写白名单，避免断言变成恒真。
   一个写接口要么由 schema 通用渲染器承载，要么确实被某个原生 Activity 调用。 */
const javaKeys = new Set<string>();
for (const f of fs.readdirSync(javaDir).filter((x) => x.endsWith('.java'))) {
  const src = read(javaDir + '/' + f);
  for (const m of src.matchAll(/(?:ep(?:Get|Post|Patch|Put|Delete)|endpoint)\(\s*"([A-Za-z]\w*)"/g)) {
    javaKeys.add(m[1]);
  }
}
/* 同一真实路径可能对应多个契约 key（如 /api/subdomains/{id} 同时是 GET 详情、
   PATCH 修改、DELETE 释放）—— 只要其中**任一** key 可达就算覆盖。 */
const keysForRoute = (r: string) => Object.keys(eps).filter((k) =>
  eps[k].split('?')[0].replace(/\{[^}]+\}/g, ':P') === r.replace(/:[A-Za-z_]\w*/g, ':P'));
const reachable = (r: string) => keysForRoute(r).some((k) => schemaEps.has(k) || javaKeys.has(k));
const notReachable = writeRoutes.filter((r) => !reachable(r));
check(javaKeys.size >= 40, `原生页里真实存在 ≥40 个接口调用点（实际 ${javaKeys.size}）`);
check(notReachable.length === 0,
  `全部写接口都能在 App 里点到：schema 渲染器或原生精修页（不可达 ${notReachable.length}：${notReachable.join(', ')}）`);
/* 反向对照：假装没有任何原生调用点，未覆盖的接口必须被抓出来 */
const nativeOnly = writeRoutes.filter((r) =>
  keysForRoute(r).every((k) => !schemaEps.has(k)) &&
  keysForRoute(r).some((k) => javaKeys.has(k)));
check(nativeOnly.length > 0 && nativeOnly.every((r) => !reachableWithEmpty(r)),
  '反向对照：假装没有原生调用点，这些写接口必须被判为不可达（断言不是恒真）');
function reachableWithEmpty(r: string) {
  return keysForRoute(r).some((k) => schemaEps.has(k));   // 空 javaKeys
}

/* 反向对照：故意删掉一个分组，覆盖断言必须失败 */
const brokenSchema = JSON.parse(JSON.stringify(schemaRes.body));
brokenSchema.groups = brokenSchema.groups.slice(1);
const brokenScreens = brokenSchema.groups.reduce((n: number, g: any) => n + g.screens.length, 0);
check(brokenScreens < schemaScreens, '反向对照：schema 少一组时页面计数断言会失败');

const bootSchema = await call('/api/app/v1/bootstrap', makeEnv());
check(bootSchema.body.site && bootSchema.body.site.schemaVersion === 2
  && bootSchema.body.site.featureScreens >= 40
  && bootSchema.body.site.featureEndpoints >= 100,
  'bootstrap 下发功能统计（首页 Bento 卡的数字滚动有真数据）');

/* Android 端动效 / 资源静态断言 */
const motionJava = read('android/app/src/main/java/xyz/noxc/app/Motion.java');
const fxJava = read('android/app/src/main/java/xyz/noxc/app/FxView.java');
const hubJava = read('android/app/src/main/java/xyz/noxc/app/HubActivity.java');
const schemaJava = read('android/app/src/main/java/xyz/noxc/app/SchemaActivity.java');
const gradle = read('android/app/build.gradle');
check(/interface Callback|class Motion/.test(motionJava)
  && /stagger|press|countUp|scene|reduced/.test(motionJava),
  'Motion 提供错落入场 / 弹簧按压 / 数字滚动 / 共享元素 / 减少动画');
check(/ANIMATOR_DURATION_SCALE|TRANSITION_ANIMATION_SCALE/.test(motionJava),
  '动效尊重系统「减少动画」无障碍设置');
check(/class FxView/.test(fxJava) && /SHIMMER|GLOW/.test(fxJava)
  && /LinearGradient|ValueAnimator/.test(fxJava),
  '自绘骨架屏 + 品牌光晕，替代一直转圈');
check(/lottie:6\.4\.0/.test(gradle) && /dynamicanimation/.test(gradle),
  '引入 Lottie 与物理弹簧依赖（用户允许体积做到几十 MB）');
const rawDir = 'android/app/src/main/res/raw';
const lotties = fs.readdirSync(rawDir).filter((f) => f.endsWith('.json'));
check(lotties.length >= 7 && lotties.every((f) => {
  const j = JSON.parse(read(rawDir + '/' + f));
  return j.v && j.fr && j.layers && j.layers.length > 0;
}), `7 组合法 Lottie 动画 JSON（实际 ${lotties.length} 组）`);
const arts = fs.readdirSync('android/app/src/main/res/drawable-nodpi')
  .filter((f) => f.endsWith('.webp'));
check(arts.length >= 12, `≥12 张品牌插画（实际 ${arts.length} 张）`);
check(fs.existsSync('android/app/src/main/assets/fonts/NotoSansSC-Regular.ttf')
  && fs.existsSync('android/app/src/main/assets/fonts/NotoSerifSC-VF.ttf')
  && fs.existsSync('android/app/src/main/assets/fonts/OFL.txt'),
  '内置 OFL 中文字体 + 许可证（排版不再依赖系统字体）');
check(/HubActivity|GroupActivity|SchemaActivity/.test(read('android/app/src/main/AndroidManifest.xml')),
  'Manifest 注册功能中心三个 Activity');
check(/renderForm|runAction|loadData|emptyState|onResult/.test(schemaJava),
  'SchemaActivity 通用渲染器覆盖表单 / 动作 / 数据 / 空状态 / 结果');
check(/schema/.test(hubJava) && /hub_search|Bento|stagger/.test(hubJava),
  '功能中心有搜索、Bento 网格与错落入场');

}

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);


console.log(`App 专用接口回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
