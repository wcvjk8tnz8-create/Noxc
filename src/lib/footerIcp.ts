/**
 * 萌ICP 备案号：首次部署即显示在页脚，管理员可在「站点设置 → 页脚备案号」覆盖。
 * settings 表里还没有 footer_icp_html 这一行时用它；管理员主动清空则写入空串并隐藏，
 * 因此「未设置」与「已清空」必须区分，不能简单用 `|| 默认值`。
 */
export const DEFAULT_FOOTER_ICP_HTML =
  '<a href="https://icp.gov.moe/?keyword=20269429" target="_blank" rel="noopener noreferrer" data-no-i18n>萌ICP备20269429号</a>';
