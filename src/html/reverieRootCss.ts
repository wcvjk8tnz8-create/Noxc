/**
 * 两个根域名页（meoy.top / v-1.top）共用的 Reverie 收口层。
 *
 * 它们仍是自包含静态页：把这段 CSS 拼进 <head> 末尾即可，
 * 不用引入官网的 Vite 构建产物，也不加载任何外部字体或脚本。
 * 变量覆盖 + 少量组件收口，保留原本「单屏 dnshe 式查询页」的骨架。
 *
 * 与官网 src/app/styles/reverie.css 同一套令牌：
 *   羊皮纸 #f6f2e8 / 深蕨绿 #2f5d45 / 墨黑药丸 / 发丝线 / 衬线绿斜体。
 */
export const reverieRootCss = String.raw`
/* ── Noxc · Reverie (root domains) ───────────────────────── */
:root{
  --paper:#f6f2e8;--paper2:#efe8da;--card:rgba(255,253,247,.78);
  --ink:#1c221d;--body:#4a5148;--muted:#8a8f83;
  --line:rgba(38,58,44,.16);--line2:rgba(38,58,44,.09);
  --acc:#2f5d45;--accSoft:#e6efe6;--red:#a8464e;
  --radius:18px;
  --serif:"Redaction 35","Noto Serif CJK SC","Songti SC","STSong",Georgia,"Times New Roman",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  --mono:"Redaction 35",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.22,1,.36,1);--dur2:280ms;--dur3:420ms;
  --rv-fern:#2f5d45;--rv-ink:#1c221d;--rv-hair:rgba(38,58,44,.16);
}
@media(prefers-color-scheme:dark){
  :root{
    --paper:#121713;--paper2:#1a211b;--card:rgba(28,36,29,.78);
    --ink:#f1eee3;--body:#bfc7ba;--muted:#8b9689;
    --line:rgba(214,232,216,.16);--line2:rgba(214,232,216,.09);
    --acc:#9dc9a8;--accSoft:#1c3024;--red:#ef8b90;
    --rv-fern:#9dc9a8;--rv-ink:#f1eee3;--rv-hair:rgba(214,232,216,.16);
  }
}
html,body{max-width:100%;overflow-x:clip}
body{
  color:var(--ink);background:var(--paper);
  font-family:var(--sans);
  background-image:radial-gradient(900px 560px at 12% -10%,var(--accSoft),transparent 66%),
                   radial-gradient(760px 520px at 100% 110%,var(--paper2),transparent 70%);
}
.brand,h1,.rv-serif{font-family:var(--serif);letter-spacing:-.035em}
h1 em{font-style:italic;color:var(--acc);font-weight:400}
.eyebrow{font-family:var(--mono);letter-spacing:.24em;color:var(--acc)}
.sub{color:var(--body);line-height:1.8}
/* 发丝线 + 纸面，去掉玻璃重阴影 */
.head{border-bottom:1px solid var(--line2)}
.checker,.metrics,.status,.legal,.pill,.icp-slot{
  background:var(--card)!important;border:1px solid var(--line)!important;
  border-radius:var(--radius)!important;box-shadow:none!important;
}
.checker{overflow:hidden}
.field input,.suffix select{
  background:transparent!important;border:0!important;box-shadow:none!important;
  color:var(--ink)!important;font-size:16px;
}
.field input:focus,.suffix select:focus{outline:none}
/* 墨黑药丸（Uiverse ink pill 范式） */
.check,.lang button,.nav a,.pill,button{
  border-radius:999px!important;
  transition:transform var(--dur2) var(--ease),background var(--dur2) var(--ease),
             border-color var(--dur2) var(--ease),color var(--dur2) var(--ease);
}
.check{
  background:var(--rv-ink)!important;color:var(--paper)!important;
  border:1px solid var(--rv-ink)!important;min-height:44px;
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
}
.check:hover{background:var(--rv-fern)!important;border-color:var(--rv-fern)!important;transform:translateY(-2px)}
.check:active{transform:translateY(0) scale(.985)}
.lang button.on{background:var(--rv-ink)!important;color:var(--paper)!important}
.nav a:hover{color:var(--acc)}
.metric{border-right:1px solid var(--line2)}
.foot{border-top:1px solid var(--line2);color:var(--muted)}
.foot a{color:var(--muted);text-decoration:none;border-bottom:1px solid var(--line)}
.foot a:hover{color:var(--acc);border-color:var(--acc)}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{
  outline:2px solid var(--rv-fern);outline-offset:3px
}
/* 统一的细线扫光与三点 loader（与官网同一套语言） */
@keyframes rvUnderline{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes rvDots{0%,80%,100%{opacity:.25}40%{opacity:1}}
h1 em::after{content:'';position:absolute;left:0;right:0;bottom:.04em;height:2px;
  background:var(--acc);opacity:.32;transform-origin:left;animation:rvUnderline 900ms var(--ease) 380ms both}
h1 em{position:relative}
.rise{animation:rvRise var(--dur3) var(--ease) both}
@keyframes rvRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

/* ── 手机 / 长屏 / 矮横屏：单屏页也不溢出 ─────────────────────── */
@media(max-width:640px){
  .stage{padding-left:calc(16px + env(safe-area-inset-left,0px));
         padding-right:calc(16px + env(safe-area-inset-right,0px));
         padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}
  .head{gap:10px;flex-wrap:wrap;padding-bottom:10px}
  .brand{font-size:22px}
  .nav{gap:14px;font-size:12px}
  .nav a:nth-child(n+3){display:none}
  h1{font-size:clamp(32px,8.8vw,46px);line-height:1.16}
  .sub{font-size:14px}
  .checker{flex-direction:column;align-items:stretch;border-radius:20px}
  .field,.suffix{width:100%;border-right:0!important;border-bottom:1px solid var(--line2)}
  .field input,.suffix select{min-height:46px;width:100%}
  .check{width:100%;min-height:48px;margin:0}
  .metrics{grid-template-columns:repeat(2,minmax(0,1fr));width:100%}
  .metric{border-bottom:1px solid var(--line2)}
  .lang button{min-height:44px;min-width:44px}
  .foot{flex-wrap:wrap;gap:8px 14px;font-size:11.5px}
}
@media(max-width:360px){
  .stage{padding-left:calc(10px + env(safe-area-inset-left,0px));
         padding-right:calc(10px + env(safe-area-inset-right,0px))}
  .brand{font-size:19px}
  h1{font-size:clamp(29px,8.4vw,38px)}
  .metrics{grid-template-columns:minmax(0,1fr)}
}
@media(max-aspect-ratio:9/19) and (max-width:500px){
  .hero{gap:0}
  h1{font-size:clamp(30px,8.2vw,42px)}
  .sub{margin-top:12px}
  .checker{margin-top:20px}
}
@media(orientation:landscape) and (max-height:520px){
  h1{font-size:clamp(26px,5vw,40px)}
  .stage{padding-top:calc(10px + env(safe-area-inset-top,0px))}
  .checker{margin-top:14px}
}
@media(max-height:430px){
  html,body{overflow-x:clip;overflow-y:auto}
  .stage{min-height:100dvh;height:auto}
}
@media(prefers-reduced-motion:reduce){
  .rise,h1 em::after{animation:none!important;transform:none!important}
  .rise{opacity:1!important}
  .check:hover{transform:none}
}
`;
