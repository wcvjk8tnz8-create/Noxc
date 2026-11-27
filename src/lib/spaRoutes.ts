/**
 * SPA 直达路径的**唯一来源**。
 *
 * 背景：Worker 侧 SPA_PATHS 与前端 App.tsx 的 ROUTES 是两份手写清单。
 * 新增页面时只改了 ROUTES、忘了同步 SPA_PATHS，站内点击（React 接管）正常，
 * 但**直接打开 / 刷新 / 从根域名落地页外链跳过去**会被 ASSETS 当成不存在的
 * 静态文件返回 404 空 body —— 用户看到的就是「整个页面一片白」。
 * /report、/abuse 就是这样漏掉的（举报滥用页白屏）。
 *
 * 现在 Worker 用本模块生成回落清单；spa-routes-regression.ts 会逐个核对
 * App.tsx 的 ROUTES key 都在清单里，并真跑 Hono 验证回落确实发生。
 * 以后加页面：在 SPA_PAGE_NAMES 里加一个名字即可，两边不再漂移。
 */

/** 页面名（不含斜杠与 .html）。/ 与 /index.html 单独处理。 */
export const SPA_PAGE_NAMES = [
  'home', 'login', 'dashboard', 'domain', 'register', 'whois', 'admin',
  'checkin', 'rewards', 'chat', 'tickets', 'transfer', 'profile', 'terms',
  'report', 'abuse', 'showcase', 'docs', 'external-domains',
] as const;

/** 所有需要回落到 index.html 的直达路径（含 .html 变体，兼容旧书签）。 */
export function spaFallbackPaths(): string[] {
  const out = ['/', '/index.html'];
  for (const name of SPA_PAGE_NAMES) {
    out.push('/' + name, '/' + name + '.html');
  }
  return out;
}
