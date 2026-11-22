/**
 * 独立模板（/docs、meoy.top / v-1.top 根域名落地页）共用的站点公告条。
 *
 * 这些页面由 Worker 直出、不加载 SPA 运行时，所以 refreshRuntime() 管不到，
 * 但后台「站点设置 → 站点公告」同样必须在这里露出来 —— 否则用户会说
 * 「每个地方都没有」。样式 / 结构 / 渲染逻辑收在这一个文件，三处只做插值。
 *
 * 与 SPA 版保持同一观感：纸白淡灰底、墨黑圆点、1px 发丝线、纯文档流、
 * 零彩色、长文可换行。公告是管理员自填的纯文本，一律 textContent，
 * 绝不 innerHTML；英文模式下也不翻译（不挂 i18n 词典）。
 */

/** 插到 <head> 里：自包含样式，深浅色自适应 */
export const ANNOUNCEMENT_CSS = String.raw`<style>
#siteAnnouncement{display:flex;align-items:flex-start;gap:10px;box-sizing:border-box;width:100%;
  padding:10px clamp(20px,5vw,48px);background:#f7f8fa;border-bottom:1px solid rgba(17,19,24,.11);
  color:#4b5563;font:500 13px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  white-space:normal;overflow-wrap:anywhere;position:relative;z-index:2}
#siteAnnouncement[hidden]{display:none!important}
#siteAnnouncement .sa-dot{display:block;width:7px;height:7px;flex:0 0 7px;margin-top:.55em;border-radius:50%;background:#111318}
#siteAnnouncement .sa-text{flex:1 1 auto;min-width:0}
@media(prefers-color-scheme:dark){#siteAnnouncement{background:#141922;border-bottom-color:rgba(226,235,250,.16);color:#b6c0cf}
  #siteAnnouncement .sa-dot{background:#f5f7fb}}
@media(max-width:640px){#siteAnnouncement{padding:9px 20px;font-size:12.5px}}
</style>`;

/** 插到 <body> 最前面：默认隐藏，拿到 /api/config 再显示，避免空条闪一下 */
export const ANNOUNCEMENT_BODY = String.raw`<div id="siteAnnouncement" role="status" hidden><span class="sa-dot"></span><span class="sa-text"></span></div>`;

/**
 * 插到页面已有的 <script> 里，定义渲染函数。
 * 调用方在拿到 /api/config 的响应对象后执行 renderAnnouncement(d)。
 * 接口失败 / 跨域被拦时保持隐藏，不阻断页面其它功能。
 */
export const ANNOUNCEMENT_JS = String.raw`
function renderAnnouncement(cfg){
  var el=document.getElementById('siteAnnouncement');
  if(!el)return;
  var t=(cfg&&typeof cfg.announcement==='string')?cfg.announcement.trim():'';
  if(!t){el.hidden=true;return;}
  var s=el.querySelector('.sa-text');
  if(s)s.textContent=t;   /* 纯文本：管理员写什么就显示什么，不解析 HTML */
  el.hidden=false;
}
`;
