/**
 * NodeLoc 登录 / 绑定入口。
 *
 * 一定要是 https 绝对链接：NodeLoc 侧只接受 HTTPS 回调，后台登记的回调 URI
 * 也必须逐字符是 https。线上（https 页面）直接产出 https 绝对地址；
 * 本地 http 开发时退回相对路径，避免把 localhost 跳到不存在的 https 端口。
 *
 * 注意：这里跳的是「站内 /api/auth/nodeloc/start」，由它生成一次性 state
 * 并 302 到 https 的 NodeLoc 授权页。**不能**把按钮直连 provider authorize，
 * 否则 state / Cookie / D1 三重校验全部失效，等于把 OAuth 打穿。
 */
export function nodelocStartUrl(query = ''): string {
  const path = '/api/auth/nodeloc/start' + query;
  if (typeof window === 'undefined') return path;
  const { protocol, host } = window.location;
  return protocol === 'https:' ? `https://${host}${path}` : path;
}
