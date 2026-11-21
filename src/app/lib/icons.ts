/**
 * Noxc · 全站统一图标集（hairline / currentColor / 零外链）
 *
 * 参考来源与取舍：
 *  · Uiverse —— 组件都是自包含 HTML/CSS，class 名极通用（.card/.button），
 *    整包复制会互相覆盖。这里只取「细线、克制、状态可读」的范式，
 *    前缀全部收成 rv-/td-，不引入任何第三方 class。
 *  · React Bits —— 用「源码归你」的思路：图标是字符串常量而不是 npm 包，
 *    每个参数（线宽、尺寸、圆角）都能直接改。
 *  · Aceternity UI —— Hero Highlight 的克制版：只留一条会扫过的细线，
 *    不引 Background Beams / Wobble Card，避免破坏 Reverie 的安静。
 *
 * 全部 24×24 网格、stroke=currentColor、无 fill、无外部请求；
 * legacy 控制器用 innerHTML 动态渲染时复用同一份 svgIcon()，
 * 因此动态插入的卡片与静态页面图标永远一致。
 */
export const ICON_PATHS = {
  arrow: 'M4 12h15M13 6l6 6-6 6',
  arrowUp: 'M6 18L18 6M9 6h9v9',
  chevron: 'M5 9l7 7 7-7',
  search: 'M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM15.6 15.6L21 21',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3.2 9h17.6M3.2 15h17.6M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z',
  layers: 'M12 3l9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  chat: 'M20 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h1a8 8 0 0 1 8 8Z',
  shield: 'M12 3l8 3v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3ZM8.5 12l2.5 2.5 4.5-4.5',
  spark: 'M12 2.5l1.8 6.2 6.2 1.8-6.2 1.8L12 18.5l-1.8-6.2L4 10.5l6.2-1.8L12 2.5Z',
  check: 'M4.5 12.5l5 5 10-10',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6M12 7.5h.01',
  external: 'M13 5h6v6M19 5l-9 9M18 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M5 5l14 14M19 5L5 19',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3.5 2',
  leaf: 'M20 4C10 4 4 8 4 15a5 5 0 0 0 5 5c7 0 11-6 11-16ZM4 20c3-6 7-9 12-11',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** 给 legacy innerHTML / 字符串模板用；aria-hidden 避免读屏重复播报 */
export function svgIcon(name: IconName, size = 20, cls = ''): string {
  const d = ICON_PATHS[name] || ICON_PATHS.info;
  return `<svg class="td-ico ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}
