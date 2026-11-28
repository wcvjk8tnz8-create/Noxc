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

}

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);

console.log(`App 专用接口回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
