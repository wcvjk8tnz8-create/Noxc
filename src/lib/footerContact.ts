/**
 * 页脚联系方式：首次部署即显示，管理员可在「站点设置 → 页脚联系方式」覆盖。
 * 与备案号同一套规则：settings 里没有这一行时用默认值；管理员主动清空写入空串并隐藏，
 * 因此「未设置」与「已清空」必须区分，不能简单用 `|| 默认值`。
 * 清洗与渲染复用 footerIcp.ts 的同一条链路（只放行 <a> 文字链接）。
 */
export const DEFAULT_FOOTER_CONTACT_HTML =
  '<a href="https://t.me/+cTDEQy_0HqcxZDVl" target="_blank" rel="noopener noreferrer" data-no-i18n>Telegram</a>';
