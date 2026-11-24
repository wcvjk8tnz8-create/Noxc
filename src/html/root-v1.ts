/** v-1.top 根域名落地页（自包含，供静态托管导出或 Worker 按 Host 直出） */
import { reverieRootCss } from './reverieRootCss.js';
import { ANNOUNCEMENT_CSS, ANNOUNCEMENT_BODY, ANNOUNCEMENT_JS } from './announcement.js';

export const v1TopHtml = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<title>v-1.top · Noxc</title>
<link rel="icon" type="image/png" href="data:image/png;base64,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">

<meta name="description" content="v-1.top — Noxc public subdomain service">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Redaction+35:ital,wght@0,400;0,700;1,400&display=swap" media="print" onload="this.media='all'">
<style>
:root{
  --paper:#ffffff;--paper2:#f7f9fc;--card:#fff;--ink:#111318;--body:#49525f;
  --muted:#8b94a3;--line:rgba(17,19,24,.13);--line2:rgba(17,19,24,.07);--acc:#1667f2;--accSoft:#e8f0ff;
  --blue:#1667f2;--red:#d0464e;--radius:18px;
  --serif:"Redaction 35","Noto Serif CJK SC","Songti SC","STSong",Georgia,"Times New Roman",serif;
  --sans:"Redaction 35",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  --mono:"Redaction 35",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
  --ease:cubic-bezier(.22,1,.36,1);--easeSoft:cubic-bezier(.4,0,.2,1);
  --dur1:160ms;--dur2:280ms;--dur3:420ms;--dur4:620ms;
}
@media(prefers-color-scheme:dark){
  :root{--paper:#101315;--paper2:#171b1e;--card:#171b1e;--ink:#f2f0e9;--body:#c8cdd2;
    --muted:#858d94;--line:#2b3134;--line2:#3a4246;--acc:#5b93ff;--accSoft:#16233c;
    --blue:#8ab4ff;--red:#f3979b}
}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{
  height:100dvh;overflow:hidden;color:var(--ink);background:var(--paper);
  font-family:var(--sans);-webkit-font-smoothing:antialiased;
  background-image:radial-gradient(900px 560px at 12% -10%,var(--accSoft),transparent 66%),
                   radial-gradient(760px 520px at 100% 110%,var(--paper2),transparent 70%);
}
a{color:inherit;text-decoration:none}
.stage{
  height:100%;display:flex;flex-direction:column;
  padding:calc(20px + env(safe-area-inset-top)) calc(clamp(20px,5vw,72px) + env(safe-area-inset-right))
          calc(16px + env(safe-area-inset-bottom)) calc(clamp(20px,5vw,72px) + env(safe-area-inset-left));
}
/* ── 顶栏 ── */
.head{display:flex;align-items:center;gap:24px;border-bottom:1px solid var(--line);padding-bottom:14px;flex-shrink:0}
.brand{font-family:var(--serif);font-size:26px;font-weight:700;letter-spacing:-.035em;white-space:nowrap}
.brand i{display:inline-block;width:9px;height:9px;margin-right:10px;border-radius:2px;background:var(--acc);transform:rotate(45deg)}
.nav{display:flex;gap:24px;margin-left:auto;font-size:13.5px;font-weight:600;color:var(--body)}
.nav a:hover{color:var(--acc)}
.lang{display:flex;gap:2px;border:1px solid var(--line2);border-radius:99px;padding:3px;flex-shrink:0}
.lang button{font:inherit;font-size:12.5px;font-weight:700;color:var(--muted);padding:0 13px;border-radius:99px;cursor:pointer;background:none;border:0;min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center}
.lang button.on{background:var(--ink);color:var(--paper)}
/* ── 主体：单屏居中，不上下滑 ── */
.hero{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0}
.eyebrow{font-family:var(--mono);font-size:12.5px;letter-spacing:.28em;color:var(--acc);text-transform:uppercase}
h1{font-family:var(--serif);font-size:clamp(38px,5.4vw,76px);font-weight:700;letter-spacing:-.055em;line-height:1.14;margin:18px 0 0}
h1 em{font-style:italic;color:var(--acc)}
.sub{margin-top:16px;font-size:clamp(14px,1.4vw,18px);line-height:1.7;color:var(--body);max-width:660px}
/* ── 域名查询框（dnshe.org 式单屏） ── */
.checker{
  width:min(100%,860px);margin-top:clamp(24px,3.4vh,40px);display:flex;align-items:stretch;
  background:var(--card);border:1px solid var(--line2);border-radius:var(--radius);overflow:hidden;
  box-shadow:0 14px 44px rgba(17,19,24,.06);
}
.checker .field{flex:1;min-width:0;display:flex;align-items:center;gap:10px;padding:0 22px}
.field label{font-family:var(--mono);font-size:12px;letter-spacing:.1em;color:var(--muted);white-space:nowrap}
.field input{flex:1;min-width:0;height:64px;border:0;outline:0;background:transparent;font:600 19px/1 var(--mono);color:var(--ink)}
.field input::placeholder{color:var(--muted);font-weight:400}
.suffix{position:relative;flex-shrink:0;border-left:1px solid var(--line);display:flex;align-items:center}
.suffix select{appearance:none;border:0;outline:0;background:transparent;color:var(--acc);font:700 17px/1 var(--mono);padding:0 38px 0 22px;height:64px;cursor:pointer}
.suffix:after{content:"▾";position:absolute;right:16px;color:var(--muted);font-size:13px;pointer-events:none}
.checker button.check{
  flex-shrink:0;border:0;cursor:pointer;background:var(--ink);color:var(--paper);
  padding:0 clamp(20px,3vw,42px);font:700 16px/1 var(--sans);letter-spacing:.01em;
}
.checker button.check:hover{background:var(--acc)}
/* ── 状态条 ── */
.status{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:10px;margin-top:18px;font-size:13px;color:var(--muted)}
.pill{border:1px solid var(--line2);border-radius:99px;padding:6px 15px;font-weight:600}
.pill b{color:var(--acc);font-family:var(--mono)}
.pill.live{color:var(--acc);border-color:var(--acc)}
.pill .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--acc);margin-right:8px}
/* ── 细线指标 ── */
.metrics{width:min(100%,860px);margin-top:clamp(22px,3.2vh,40px);display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.metric{padding:clamp(12px,2vh,20px) 14px;text-align:left;border-right:1px solid var(--line)}
.metric:last-child{border-right:0}
.metric small{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--muted)}
.metric b{display:block;font-family:var(--serif);font-size:clamp(17px,1.9vw,23px);font-weight:700;margin-top:6px;letter-spacing:-.02em}
/* ── 合规声明 ── */
.legal{width:min(100%,860px);margin-top:clamp(14px,2.2vh,26px);font-size:12.5px;line-height:1.75;color:var(--muted);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 14px}
.legal a{border-bottom:1px solid var(--line2);color:var(--body);font-weight:600}
.legal a:hover{color:var(--acc);border-color:var(--acc)}
/* ── 页脚 ── */
.foot{flex-shrink:0;border-top:1px solid var(--line);padding-top:12px;display:flex;justify-content:space-between;gap:12px;font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;color:var(--muted);flex-wrap:wrap}
.foot a:hover{color:var(--acc)}
.foot{flex-wrap:wrap;align-items:center}
.foot a:hover,.icp-slot a:hover,.contact-slot a:hover{color:var(--acc)}
.icp-slot,.contact-slot{display:none;align-items:center;gap:8px;white-space:nowrap;color:inherit;font:inherit;letter-spacing:inherit}
.icp-slot::before,.contact-slot::before{content:'';width:1px;height:10px;background:currentColor;opacity:.3;flex:0 0 auto}
.icp-slot a,.contact-slot a{color:inherit;text-decoration:none;border-bottom:1px solid transparent}
.icp-slot a:hover,.contact-slot a:hover{border-bottom-color:currentColor}

/* ── 交互：与控制台共用同一组缓动，只动颜色 / 边框 / 阴影 / 滤镜 ── */
a,.lang button,.nav a,.legal a,.foot a,.checker button.check,.suffix select,.pill{
  transition:color var(--dur1) var(--easeSoft),background-color var(--dur1) var(--easeSoft),
             border-color var(--dur1) var(--easeSoft),box-shadow var(--dur2) var(--ease),
             filter var(--dur2) var(--ease),opacity var(--dur1) var(--easeSoft);
}
.checker{transition:box-shadow var(--dur2) var(--ease),border-color var(--dur1) var(--easeSoft)}
.checker:focus-within{border-color:var(--acc);box-shadow:0 18px 52px rgba(17,19,24,.10)}
.checker button.check:hover{filter:brightness(1.10)}
.checker button.check:active{filter:brightness(.94)}
.lang button:hover{color:var(--ink)}
.pill.live .dot{animation:tdPulse 2.4s var(--easeSoft) infinite}
@keyframes tdPulse{0%,100%{opacity:.55}50%{opacity:1}}
:focus-visible{outline:2px solid var(--acc);outline-offset:3px;border-radius:6px}
/* ── 入场 ── */
.rise{animation:rise var(--dur4) var(--ease) both;animation-delay:var(--d,0s)}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
/* ── 紧凑屏：压缩间距，仍然一屏 ── */
@media(max-height:760px){
  h1{margin-top:10px;font-size:clamp(32px,4.4vw,58px)}
  .sub{margin-top:10px}
  .checker{margin-top:20px}.field input,.suffix select{height:54px}
  .metrics{margin-top:18px}.metric{padding:10px 14px}
  .legal{margin-top:12px}
}
@media(max-height:560px) and (orientation:landscape){
  .stage{padding-top:10px;padding-bottom:8px}
  .head{padding-bottom:8px}.brand{font-size:20px}.nav{font-size:12px;gap:14px}
  h1{font-size:34px;margin-top:6px}.sub{margin-top:6px;font-size:13px}
  .checker{margin-top:12px}.field input,.suffix select{height:44px}
  .status{margin-top:10px}.metrics{margin-top:12px}.metric{padding:7px 12px}
  .legal{margin-top:8px;font-size:11px}.foot{padding-top:7px}
}
@media(max-width:640px){
  .nav{display:none}.brand{font-size:21px}
  .checker{flex-wrap:wrap}.checker .field{width:100%;flex:1 1 100%;border-bottom:1px solid var(--line)}
  .field input{height:52px}.suffix{flex:1}.suffix select{height:50px;width:100%}
  .checker button.check{height:50px;padding:0 22px}
  .metrics{grid-template-columns:repeat(3,1fr)}.metric{text-align:center;padding:10px 5px}
  .metric b{font-size:14px}.metric small{font-size:9px;letter-spacing:.08em}
  .legal{font-size:11px}.foot{font-size:10px}
}
/* 极矮屏才允许局部滚动，避免内容被切 */
@media(max-height:430px){body{overflow:auto}.stage{min-height:100dvh;height:auto}}
@media(max-aspect-ratio:9/19) and (max-width:520px){h1{font-size:clamp(32px,9vw,44px)}}
@media(prefers-reduced-motion:reduce){
  .rise{animation:none}
  *,*::before,*::after{animation-duration:.001ms!important;animation-delay:0ms!important;
    transition-duration:.001ms!important;transition-delay:0ms!important;scroll-behavior:auto!important}
}
</style>
<style id="td-liquid-glass">
/* Noxc · Liquid Glass（根域名单屏页）
   只换材质与绿色主题，保留 Zerexa 的衬线标题、等宽小标、细线与单屏布局 */
:root{
  --lg-glass:linear-gradient(152deg,rgba(255,255,255,.78) 0%,rgba(255,255,255,.50) 58%,rgba(240,248,242,.46) 100%);
  --lg-soft:linear-gradient(152deg,rgba(255,255,255,.64),rgba(255,255,255,.36));
  --lg-stroke:rgba(255,255,255,.90);
  --lg-blur:blur(30px) saturate(180%);
  --lg-sh:0 24px 60px rgba(17,19,24,.12),0 4px 14px rgba(17,19,24,.06),inset 0 1px 0 rgba(255,255,255,.9);
  --lg-sh-sm:0 10px 26px rgba(17,19,24,.08),inset 0 1px 0 rgba(255,255,255,.8);
  --lg-hair:rgba(27,36,48,.12);
}
@media(prefers-color-scheme:dark){
  :root{
    --lg-glass:linear-gradient(152deg,rgba(17,19,24,.78),rgba(17,19,24,.60) 60%,rgba(17,19,24,.64));
    --lg-soft:linear-gradient(152deg,rgba(17,19,24,.64),rgba(17,19,24,.42));
    --lg-stroke:rgba(226,235,250,.16);
    --lg-sh:0 24px 60px rgba(0,0,0,.48),0 4px 14px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.10);
    --lg-sh-sm:0 10px 26px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.08);
    --lg-hair:rgba(226,235,250,.14);
  }
}
body{
  background-image:
    radial-gradient(1000px 620px at 6% -12%,rgba(91,147,255,.30),transparent 64%),
    radial-gradient(900px 620px at 102% 4%,rgba(226,235,250,.34),transparent 62%),
    radial-gradient(1100px 780px at 76% 112%,rgba(91,147,255,.24),transparent 66%),
    linear-gradient(158deg,#fafcf8 0%,#f2f7f0 56%,#edf4ec 100%);
}
@media(prefers-color-scheme:dark){
  body{background-image:
    radial-gradient(1000px 620px at 6% -12%,rgba(27,36,48,.32),transparent 64%),
    radial-gradient(900px 620px at 102% 4%,rgba(17,19,24,.30),transparent 62%),
    radial-gradient(1100px 780px at 76% 112%,rgba(17,19,24,.26),transparent 66%),
    linear-gradient(158deg,#111318 0%,#0c1410 56%,#0a120e 100%);}
}
.head,.foot{border-color:var(--lg-hair)}
.lang,.pill{
  background:var(--lg-soft);border:1px solid var(--lg-stroke);
  backdrop-filter:var(--lg-blur);-webkit-backdrop-filter:var(--lg-blur);
  box-shadow:var(--lg-sh-sm);
}
.pill.live{border-color:rgba(27,36,48,.40)}
.checker{
  background:var(--lg-glass);border:1px solid var(--lg-stroke);
  border-radius:24px;box-shadow:var(--lg-sh);
  backdrop-filter:var(--lg-blur);-webkit-backdrop-filter:var(--lg-blur);
}
.checker .field{border-bottom-color:var(--lg-hair)}
.suffix{border-left-color:var(--lg-hair)}
.checker button.check{
  background:linear-gradient(150deg,#1b2430,#1b2430);
  color:#fff;border-radius:18px;
  box-shadow:0 12px 26px rgba(27,36,48,.24),inset 0 1px 0 rgba(255,255,255,.30);
}
.metrics{
  background:var(--lg-glass);border:1px solid var(--lg-stroke);
  border-radius:20px;box-shadow:var(--lg-sh);overflow:hidden;
  backdrop-filter:var(--lg-blur);-webkit-backdrop-filter:var(--lg-blur);
}
.metric{border-right-color:var(--lg-hair)}
.field input,.suffix select{background:transparent}
</style>
<style id="td-reverie">
${reverieRootCss}
</style>
${ANNOUNCEMENT_CSS}
</head>
<body>
${ANNOUNCEMENT_BODY}
<div class="stage">
  <header class="head rise" style="--d:.02s">
    <a class="brand" id="brandLink" href="#"><i></i>Noxc</a>
    <nav class="nav">
      <a data-go="/whois" data-i18n="navWhois">WHOIS Lookup</a>
      <a data-go="/showcase" data-i18n="navShowcase">User Showcase</a>
      <a data-go="/terms" data-i18n="navTos">Terms of Service</a>
      <a data-go="/report" data-i18n="navReport">Report Abuse</a>
      <a data-go="/dashboard" data-i18n="navConsole">Console</a>
    </nav>
    <div class="lang" role="group" aria-label="Language">
      <button type="button" data-lang="en" class="on">EN</button>
      <button type="button" data-lang="zh">中</button>
    </div>
  </header>

  <main class="hero">
    <div class="eyebrow rise" style="--d:.06s" data-i18n="eyebrow">FREE PUBLIC SUBDOMAIN · GLOBAL ANYCAST</div>
    <h1 class="rise" style="--d:.1s"><span data-i18n="h1a">A domain</span> <em data-i18n="h1b">to begin with</em></h1>
    <p class="sub rise" style="--d:.14s" data-i18n="sub">Check a prefix, pick a root domain, and put your service online in minutes — free of charge.</p>

    <form class="checker rise" style="--d:.18s" id="checker">
      <div class="field">
        <label for="prefix">PREFIX</label>
        <input id="prefix" type="text" maxlength="63" autocomplete="off" spellcheck="false" placeholder="your-name" data-i18n-ph="prefixPh">
      </div>
      <div class="suffix">
        <select id="root" aria-label="Root domain">
          <option value="meoy.top">.meoy.top</option>
          <option value="v-1.top">.v-1.top</option>
        </select>
      </div>
      <button class="check" type="submit" data-i18n="checkBtn">Check availability →</button>
    </form>

    <div class="status rise" style="--d:.22s">
      <span class="pill"><span data-i18n="rootLabel">Current public domain</span> <b id="curRoot">meoy.top</b></span>
      <span class="pill live"><span class="dot"></span><span data-i18n="liveLabel">Open for registration</span></span>
      <span class="pill" id="rootNote" data-i18n="rootNote">AI auto-review · unlimited DNS records</span>
    </div>

    <div class="metrics rise" style="--d:.26s">
      <div class="metric"><small>01 / DNS</small><b data-i18n="m1">12 record types</b></div>
      <div class="metric"><small>02 / NETWORK</small><b data-i18n="m2">Global Anycast</b></div>
      <div class="metric"><small>03 / PRICE</small><b data-i18n="m3">Free, forever</b></div>
    </div>

    <div class="legal rise" style="--d:.3s">
      <span data-i18n="legal">DNS resolution only. Owners are solely responsible for their content.</span>
      <a id="reportLink" href="#"><span data-i18n="legalReport">Report abuse</span></a>
      <a id="abuseMail" href="#"><span data-i18n="legalMail">abuse@meoy.top</span></a>
      <a data-go="/terms" href="#"><span data-i18n="legalTos">Terms</span></a>
      <a data-go="/docs" href="#"><span data-i18n="legalDocs">Service Docs</span></a>
      <a data-go="/register" href="#"><span data-i18n="legalReg">Register →</span></a>
    </div>
  </main>

  <footer class="foot rise" style="--d:.34s">
    <span>© <span id="yr">2026</span> Noxc</span>
    <a id="siteLink" href="#">nic.299282.xyz</a>
    <span id="icpSlot" class="icp-slot"></span>
    <span id="contactSlot" class="contact-slot"></span>
  </footer>
</div>

<script>
${ANNOUNCEMENT_JS}
/* ── 部署配置：只改这两行 ── */
var PANEL = "https://nic.299282.xyz";   /* 官网 / 控制台地址，不带结尾斜杠 */
var ABUSE_EMAIL = "abuse@v-1.top";     /* 举报邮箱，改成你能收信的地址 */
var ROOT = "v-1.top";                  /* 本页对应的根域名 */
/* 跨域拉不到官网 /api/config 时的兜底清单；新增根域名时请同步加进来 */
var KNOWN_ROOTS = ["meoy.top", "v-1.top"];

var DICT = {
  en: {
    navWhois:"WHOIS Lookup",navShowcase:"User Showcase",navTos:"Terms of Service",navReport:"Report Abuse",navConsole:"Console",
    eyebrow:"FREE PUBLIC SUBDOMAIN · GLOBAL ANYCAST",
    h1a:"A domain",h1b:"to begin with",
    sub:"Check a prefix, pick a root domain, and put your service online in minutes — free of charge.",
    prefixPh:"your-name",checkBtn:"Check availability →",
    rootLabel:"Current public domain",liveLabel:"Open for registration",
    rootNote:"AI auto-review · unlimited DNS records",
    m1:"12 record types",m2:"Global Anycast",m3:"Free, forever",
    legal:"DNS resolution only. Owners are solely responsible for their content.",
    legalReport:"Report abuse",legalMail:"abuse@" + ROOT,legalTos:"Terms",legalDocs:"Service Docs",legalReg:"Register →"
  },
  zh: {
    navWhois:"WHOIS 查询",navShowcase:"用户案例",navTos:"服务条款",navReport:"举报滥用",navConsole:"控制台",
    eyebrow:"免费公共子域名 · 全球 ANYCAST 解析",
    h1a:"属于你的",h1b:"专属子域名",
    sub:"输入前缀、选好根域名，几分钟就能把服务挂上线 —— 完全免费。",
    prefixPh:"输入前缀",checkBtn:"查询可用性 →",
    rootLabel:"当前公共域名",liveLabel:"开放注册中",
    rootNote:"AI 自动审核 · DNS 记录数不限",
    m1:"12 种记录类型",m2:"全球 Anycast",m3:"永久免费",
    legal:"本站仅提供 DNS 解析，各子域名的内容与用途由所有者独立负责。",
    legalReport:"举报滥用",legalMail:"abuse@" + ROOT,legalTos:"服务条款",legalDocs:"服务文档",legalReg:"免费注册 →"
  }
};

function fillLinks(){
  document.getElementById("brandLink").href = PANEL + "/";
  document.getElementById("siteLink").href = PANEL + "/";
  document.querySelectorAll("[data-go]").forEach(function(a){
    a.href = PANEL + a.getAttribute("data-go");
  });
  document.getElementById("reportLink").href = PANEL + "/report";
  document.getElementById("abuseMail").href = "mailto:" + ABUSE_EMAIL;
  document.getElementById("yr").textContent = new Date().getFullYear();
  document.getElementById("curRoot").textContent = ROOT;
  document.getElementById("root").value = ROOT;
  document.title = ROOT + " · Noxc";
}

function apply(lang){
  var d = DICT[lang] || DICT.en;
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach(function(el){
    var v = d[el.getAttribute("data-i18n")]; if (v) el.textContent = v;
  });
  var ph = document.querySelector("[data-i18n-ph]");
  if (ph) ph.placeholder = d.prefixPh;
  document.querySelectorAll("[data-lang]").forEach(function(b){
    b.classList.toggle("on", b.getAttribute("data-lang") === lang);
  });
  try { localStorage.setItem("td_root_lang", lang); } catch(e){}
}

/* 查询框：点提交立即跳站内 WHOIS（过渡层已移除，不再延后 300ms） */
document.getElementById("checker").addEventListener("submit", function(e){
  e.preventDefault();
  var label = document.getElementById("prefix").value.trim().replace(/^https?:\/\//i,"").replace(/\..*$/,"");
  var root = document.getElementById("root").value;
  if (!label) { document.getElementById("prefix").focus(); return; }
  /* 本页后缀被暂停时自动切到主推域名，不带一个不能申请的后缀去 WHOIS */
  if (window.__NOXC_ROOT_PAUSED__) {
    var alt = window.__NOXC_PRIMARY_ROOT__;
    if (!alt) return;
    root = alt;
  }
  location.href = PANEL.replace(/\/$/,"") + "/whois?name=" + encodeURIComponent(label + "." + root) + "&root=" + encodeURIComponent(root);
}, true);

/* 根域名下拉：优先从控制台 /api/config 拉取全部生效后缀，
   跨域被拦或接口不可用时回落到内置的两个，保证静态页永远可用。 */
function loadRoots(){
  var sel = document.getElementById("root");
  /* 服务端清单优先（会反映后台「移除根域名」）；
     只有跨域被拦或接口不可用，才退回 KNOWN_ROOTS，保证静态页永远可选 */
  var fallback = (typeof KNOWN_ROOTS !== "undefined" && KNOWN_ROOTS.length)
    ? KNOWN_ROOTS.slice() : [ROOT];
  function fill(list){
    list = (list && list.length) ? list.slice() : fallback.slice();
    if (list.indexOf(ROOT) < 0) list.unshift(ROOT);
    /* 被暂停申请的根域名不进下拉：不能被点击，也不会显示在列表里。 */
    var paused = window.__NOXC_PAUSED_ROOTS__ || [];
    var seen = {}, out = [];
    list.forEach(function(d){
      d = String(d).trim().toLowerCase().replace(/^\.+|\.+$/g,"");
      if (d && !seen[d] && paused.indexOf(d) < 0) { seen[d] = 1; out.push(d); }
    });
    sel.innerHTML = out.map(function(d){ return '<option value="'+d+'">.'+d+'</option>'; }).join("");
    /* 当前落地页后缀被暂停时自动落到主推域名（noxc.uk 优先），
       不让用户停在一个已经不能申请的后缀上。 */
    var primary = out.indexOf("noxc.uk") >= 0 ? "noxc.uk" : (out[0] || "");
    sel.value = out.indexOf(ROOT) >= 0 ? ROOT : (primary || ROOT);
  }
  fill(fallback);
  try {
    fetch(PANEL.replace(/\/$/,"") + "/api/config", { headers: { "Accept": "application/json" } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        var d = j || {};
        var list = Array.isArray(d.rootDomains) && d.rootDomains.length
          ? d.rootDomains
          : (Array.isArray(d.roots) && d.roots.length ? d.roots
            : (d.rootDomain ? [d.rootDomain] : []));
        /* 按后缀暂停申请：先存名单再重绘下拉，保证 fill() 直接过滤掉它们。
           名单与 /api/config、注册页、首页同源。 */
        var pausedList = Array.isArray(d.pausedRoots)
          ? d.pausedRoots.map(function(x){ return String(x).trim().toLowerCase().replace(/\.+$/,''); })
          : [];
        window.__NOXC_PAUSED_ROOTS__ = pausedList;
        window.__NOXC_PRIMARY_ROOT__ = (function(){
          var open = (Array.isArray(d.rootDomains) ? d.rootDomains : [])
            .map(function(x){ return String(x).trim().toLowerCase().replace(/^\.+|\.+$/g,""); })
            .filter(function(x){ return x && pausedList.indexOf(x) < 0; });
          return open.indexOf("noxc.uk") >= 0 ? "noxc.uk" : (open[0] || "");
        })();
        /* 服务端确实给了清单才覆盖；空清单不覆盖，避免「有些域名没加载出来」 */
        if (list.length) fill(list);
        /* 按后缀暂停申请：当前落地页根域名被暂停时，注册入口直接禁用。
           所有入口最终都落到 /register，那里还有按钮硬锁；这里提前一步，
           不让用户白点一次。 */
        var rootPaused = !!d.applyPaused || pausedList.indexOf(String(ROOT).trim().toLowerCase()) >= 0;
        window.__NOXC_ROOT_PAUSED__ = rootPaused;
        document.querySelectorAll('[data-go="/register"]').forEach(function(a){
          a.style.pointerEvents = rootPaused ? 'none' : '';
          a.style.opacity = rootPaused ? '.5' : '';
          if (rootPaused) a.setAttribute('aria-disabled','true');
          else a.removeAttribute('aria-disabled');
        });
        /* 站点公告：与后缀清单共用同一次请求，不新增往返 */
        renderAnnouncement(d);
        /* 页脚备案号：后台「站点设置」可覆盖；管理员清空则隐藏。
           接口没给这个字段（跨域失败 / 旧后端）时保留首屏默认值 */
        var icp = document.getElementById("icpSlot");
        if (icp && typeof d.footerIcpHtml === "string") {
          var fh = d.footerIcpHtml;
          icp.innerHTML = fh;
          icp.style.display = fh ? "inline-flex" : "none";
        }
        /* 页脚联系方式：后台可覆盖；管理员清空则隐藏。接口没给该字段时保留首屏默认值 */
        var contact = document.getElementById("contactSlot");
        if (contact && typeof d.footerContactHtml === "string") {
          var ch = d.footerContactHtml;
          contact.innerHTML = ch;
          contact.style.display = ch ? "inline-flex" : "none";
        }
      })
      .catch(function(){});
  } catch(e){}
}

fillLinks();
/* 首屏先渲染默认备案号：跨域接口慢或不可用时，审核方打开页面就能看到 */
var DEFAULT_ICP_HTML = '<a href="https://icp.gov.moe/?keyword=20269429" target="_blank" rel="noopener noreferrer" data-no-i18n>萌ICP备20269429号</a>';
var DEFAULT_CONTACT_HTML = '<a href="https://t.me/+cTDEQy_0HqcxZDVl" target="_blank" rel="noopener noreferrer" data-no-i18n>Telegram</a>';
(function(){
  var el = document.getElementById("icpSlot");
  if (el) { el.innerHTML = DEFAULT_ICP_HTML; el.style.display = "inline-flex"; }
  var ct = document.getElementById("contactSlot");
  if (ct) { ct.innerHTML = DEFAULT_CONTACT_HTML; ct.style.display = "inline-flex"; }
})();
loadRoots();
var saved = "en";
try { saved = localStorage.getItem("td_root_lang") || "en"; } catch(e){}
apply(DICT[saved] ? saved : "en");
document.querySelectorAll("[data-lang]").forEach(function(b){
  b.addEventListener("click", function(){ apply(b.getAttribute("data-lang")); });
});
</script>

<!-- 切页过渡（Miku 遮罩 / 气泡 / 300ms 延后跳转）已移除：点链接立即跳，不再预热素材。 -->
</body>
</html>
`;
