/**
 * TerraDomain 服务文档（/docs、/docs.html）—— Worker 直出的 TypeScript 模板。
 *
 * 仓库不跟踪 .html：这份字符串由 src/index.ts 按路径 c.html() 直出，
 * 也能用 npm run emit:root-pages 导出 docs.html 挂任意静态托管。
 * 纯阅读页：零框架、零外部字体、零首屏接口，8 张截图全部 lazy + picture webp。
 * 中英、深浅色、手机目录与表格横滑都在本文件内自洽，不依赖 SPA 运行时。
 */
export const docsHtml = String.raw`<!doctype html>
<html lang="zh-CN" data-lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f6f2e8">
<title>服务文档 · TerraDomain</title>
<meta name="description" content="TerraDomain 服务文档：软件介绍、快速开始、账号与额度、DNS 记录、DNSHE 托管接入、站点设置与已知限制。">
<meta property="og:title" content="服务文档 · TerraDomain">
<meta property="og:description" content="二级域名分发与 DNS 管理系统的完整使用说明。">
<style>
/* ── Reverie tokens（与 src/html/reverieRootCss.ts / src/app/styles/reverie.css 同一套） ── */
.td-doc{
  --paper:#f6f2e8;--paper2:#efe8da;--card:rgba(255,253,247,.82);
  --ink:#1c221d;--body:#4a5148;--muted:#8a8f83;
  --line:rgba(38,58,44,.16);--line2:rgba(38,58,44,.09);
  --acc:#2f5d45;--accSoft:#e6efe6;--red:#a8464e;--warn:#8a6a24;--warnSoft:#fbf3dd;
  --radius:18px;
  --serif:"Redaction 35","Noto Serif CJK SC","Songti SC","STSong",Georgia,"Times New Roman",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.22,1,.36,1);--dur2:280ms;--dur3:420ms;
}
html[data-theme="dark"] .td-doc{
  --paper:#121713;--paper2:#1a211b;--card:rgba(28,36,29,.82);
  --ink:#f1eee3;--body:#bfc7ba;--muted:#8b9689;
  --line:rgba(214,232,216,.16);--line2:rgba(214,232,216,.09);
  --acc:#9dc9a8;--accSoft:#1c3024;--red:#ef8b90;--warn:#e6c886;--warnSoft:#332b18;
}
@media (prefers-color-scheme: dark){
  html:not([data-theme="light"]):not([data-theme="dark"]) .td-doc{
    --paper:#121713;--paper2:#1a211b;--card:rgba(28,36,29,.82);
    --ink:#f1eee3;--body:#bfc7ba;--muted:#8b9689;
    --line:rgba(214,232,216,.16);--line2:rgba(214,232,216,.09);
    --acc:#9dc9a8;--accSoft:#1c3024;--red:#ef8b90;--warn:#e6c886;--warnSoft:#332b18;
  }
}
.td-doc,.td-doc *{box-sizing:border-box}
.td-doc{max-width:100%;overflow-x:clip}
.td-doc{
  margin:0;color:var(--ink);background:var(--paper);font-family:var(--sans);
  -webkit-font-smoothing:antialiased;line-height:1.75;
  background-image:radial-gradient(900px 560px at 12% -10%,var(--accSoft),transparent 66%),
                   radial-gradient(760px 520px at 100% 110%,var(--paper2),transparent 70%);
  background-attachment:fixed;
}
.td-doc a{color:inherit;text-decoration:none}
.td-doc button{font:inherit}
.td-doc code,.td-doc .mono{font-family:var(--mono);font-size:.92em;background:var(--accSoft);color:var(--acc);
  padding:1px 6px;border-radius:6px;word-break:break-word}
.td-doc h1,.td-doc h2,.td-doc h3,.td-doc .brand,.td-doc .doc-sec-no{font-family:var(--serif);letter-spacing:-.035em}
.td-doc h1 em,.td-doc h2 em{font-style:italic;color:var(--acc);font-weight:400}
.td-doc :focus-visible{outline:2px solid var(--acc);outline-offset:3px}

/* ── 顶栏 ── */
.doc-top{
  display:flex;align-items:center;gap:18px;flex-wrap:wrap;
  max-width:1160px;margin:0 auto;padding:calc(22px + env(safe-area-inset-top)) 24px 18px;
  border-bottom:1px solid var(--line2);
}
.brand{display:inline-flex;align-items:center;gap:10px;font-size:23px;font-weight:700;white-space:nowrap}
.brand i{width:9px;height:9px;border-radius:2px;background:var(--acc);transform:rotate(45deg);display:inline-block}
.brand small{font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--muted);font-weight:400;margin-left:6px}
.doc-top-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pill{
  display:inline-flex;align-items:center;justify-content:center;gap:7px;
  min-height:44px;padding:0 18px;border-radius:999px;border:1px solid var(--line);
  background:var(--card);color:var(--body);cursor:pointer;font-size:13px;font-weight:600;
  transition:transform var(--dur2) var(--ease),background var(--dur2) var(--ease),color var(--dur2) var(--ease);
}
.pill:hover{transform:translateY(-2px);color:var(--acc)}
.pill.ink{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.pill.ink:hover{background:var(--acc);border-color:var(--acc);color:var(--paper)}
.pill.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}

/* ── 两栏骨架 ── */
.doc-shell{
  max-width:1160px;margin:0 auto;padding:38px 24px 80px;
  display:grid;grid-template-columns:236px minmax(0,1fr);gap:56px;align-items:start;
}
.doc-toc{position:sticky;top:24px;max-height:calc(100dvh - 48px);overflow:auto;scrollbar-width:thin}
.toc-title{font-family:var(--mono);font-size:11px;letter-spacing:.22em;color:var(--acc);text-transform:uppercase;margin:0 0 16px}
.doc-toc nav{display:flex;flex-direction:column;gap:2px;border-left:1px solid var(--line2)}
.doc-toc nav a{
  display:block;padding:8px 14px;margin-left:-1px;border-left:2px solid transparent;
  font-size:13px;color:var(--body);line-height:1.5;
}
.doc-toc nav a:hover{color:var(--acc)}
.doc-toc nav a.active{border-left-color:var(--acc);color:var(--acc);font-weight:700;background:var(--accSoft);border-radius:0 8px 8px 0}
.toc-note{margin-top:22px;padding-top:18px;border-top:1px solid var(--line2);font-size:12px;color:var(--muted);line-height:1.7}
.doc-body{min-width:0}

/* ── 正文 ── */
.doc-hero{padding-bottom:34px;border-bottom:1px solid var(--line2);margin-bottom:44px}
.eyebrow{font-family:var(--mono);font-size:11.5px;letter-spacing:.24em;color:var(--acc);text-transform:uppercase;margin:0 0 14px}
.doc-hero h1{font-size:clamp(36px,5.4vw,62px);line-height:1.12;font-weight:700;margin:0}
.doc-hero h1 em{position:relative}
.lede{font-size:clamp(15px,1.6vw,18px);color:var(--body);line-height:1.85;margin:20px 0 0;max-width:680px}
.doc-meta{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:22px;font-family:var(--mono);font-size:11.5px;color:var(--muted)}
.doc-sec{scroll-margin-top:24px;padding-bottom:48px;margin-bottom:48px;border-bottom:1px solid var(--line2)}
.doc-sec:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}
.doc-sec-head{display:flex;align-items:baseline;gap:14px;margin-bottom:18px}
.doc-sec-no{font-family:var(--mono);font-size:12px;letter-spacing:.14em;color:var(--acc);flex-shrink:0}
.doc-sec h2{font-size:clamp(24px,3vw,34px);line-height:1.3;font-weight:700;margin:0}
.doc-sec h3{font-size:19px;margin:30px 0 10px;font-weight:700}
.doc-sec p{margin:0 0 14px;color:var(--body)}
.doc-sec p strong,.doc-sec li strong{color:var(--ink)}
.doc-sec ul,.doc-sec ol{margin:0 0 16px;padding-left:22px;color:var(--body)}
.doc-sec li{margin-bottom:8px;padding-left:4px}
.doc-sec li::marker{color:var(--acc)}
.doc-sec a.link{color:var(--acc);border-bottom:1px solid var(--line);text-underline-offset:3px}
.doc-sec a.link:hover{border-color:var(--acc)}

/* ── 卡片 / 网格 ── */
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:22px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.card h3{margin:0 0 8px;font-size:17px}
.card p{margin:0;font-size:13.5px;line-height:1.7}
.card .ico{font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--acc);display:block;margin-bottom:12px}
.callout{
  background:var(--accSoft);border:1px solid var(--line);border-left:3px solid var(--acc);
  border-radius:0 var(--radius) var(--radius) 0;padding:18px 20px;margin:22px 0;
}
.callout.warn{background:var(--warnSoft);border-left-color:var(--warn)}
.callout.star{background:var(--accSoft);border-left-color:var(--acc)}
.callout p{margin:0;color:var(--ink);font-size:14.5px;line-height:1.8}
.callout .tag{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.18em;color:var(--acc);margin-bottom:8px}
.callout.warn .tag{color:var(--warn)}
.callout.warn p{color:var(--ink)}

/* ── 表格：手机横滑，不撑破整页 ── */
.table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:20px 0;border:1px solid var(--line);border-radius:var(--radius)}
table{border-collapse:collapse;width:100%;min-width:540px;font-size:13.5px}
th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line2);vertical-align:top;line-height:1.65}
th{background:var(--accSoft);color:var(--ink);font-weight:700;white-space:nowrap}
tr:last-child td{border-bottom:0}
td .mono,td code{white-space:nowrap;font-size:12px}

/* ── 图 ── */
.doc-fig{margin:24px 0}
.doc-fig img{
  display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:var(--radius);
  background:var(--card);
}
.doc-fig figcaption{font-size:12.5px;color:var(--muted);margin-top:10px;line-height:1.7}
.fig-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.fig-grid .doc-fig{margin:0}
.step{display:flex;gap:16px;margin:26px 0}
.step-no{
  flex:0 0 34px;height:34px;border-radius:999px;background:var(--ink);color:var(--paper);
  display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:13px;font-weight:700;
}
.step-body{min-width:0;flex:1}
.step-body h3{margin:2px 0 8px}

/* ── 页脚 ── */
.doc-foot{border-top:1px solid var(--line2);padding:26px 24px calc(34px + env(safe-area-inset-bottom));}
.doc-foot-in{max-width:1160px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:10px 20px;font-size:12.5px;color:var(--muted)}
.doc-foot a{color:var(--muted);border-bottom:1px solid var(--line)}
.doc-foot a:hover{color:var(--acc);border-color:var(--acc)}
.doc-foot .sep{width:1px;height:13px;background:var(--line)}

/* ── 入场：只有「跳转进来」才淡入，刷新保持静止 ── */
@keyframes docFade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

/* ── 手机 / 平板 / 长屏 ── */
@media (max-width: 860px){
  .doc-shell{grid-template-columns:minmax(0,1fr);gap:28px;padding-top:24px}
  .doc-toc{position:static;max-height:none;overflow:visible}
  .doc-toc nav{
    flex-direction:row;overflow-x:auto;border-left:0;border-bottom:1px solid var(--line2);
    gap:6px;padding-bottom:8px;scrollbar-width:none;
  }
  .doc-toc nav::-webkit-scrollbar{display:none}
  .doc-toc nav a{
    flex:0 0 auto;white-space:nowrap;margin-left:0;border-left:0;border:1px solid var(--line);
    border-radius:999px;padding:9px 15px;min-height:44px;display:inline-flex;align-items:center;background:var(--card);
  }
  .doc-toc nav a.active{border-color:var(--acc);border-radius:999px}
  .toc-note{display:none}
  .cards{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:640px){
  .doc-top{padding-left:calc(16px + env(safe-area-inset-left));padding-right:calc(16px + env(safe-area-inset-right));gap:10px}
  .brand{font-size:20px}
  .brand small{display:none}
  .doc-top-actions{gap:6px}
  .pill{padding:0 14px;font-size:12.5px;min-height:44px}
  .doc-shell{padding:22px calc(16px + env(safe-area-inset-right)) 56px calc(16px + env(safe-area-inset-left))}
  .doc-hero{padding-bottom:24px;margin-bottom:32px}
  .doc-sec{padding-bottom:34px;margin-bottom:34px}
  .cards,.fig-grid{grid-template-columns:minmax(0,1fr)}
  .doc-sec-head{gap:10px}
  .step{gap:12px}
  .step-no{flex-basis:30px;height:30px;font-size:12px}
  .doc-foot{padding-left:calc(16px + env(safe-area-inset-left));padding-right:calc(16px + env(safe-area-inset-right))}
  .doc-foot .sep{display:none}
}
@media(max-width:360px){
  .doc-top-actions .pill.txt{display:none}
  .doc-hero h1{font-size:34px}
}
@media (prefers-reduced-motion: reduce){
  .pill:hover{transform:none}
}
/* 只有「跳转进来」才淡入；刷新 / 直接打开保持静止 */
@keyframes docFade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
body.doc-arrived .doc-shell,body.doc-arrived .doc-hero{animation:docFade 420ms cubic-bezier(.22,1,.36,1) both}
@media (prefers-reduced-motion: reduce){body.doc-arrived .doc-shell,body.doc-arrived .doc-hero{animation:none}}

</style>
</head>
<body class="td-doc">

<header class="doc-top">
  <a class="brand" href="/"><i aria-hidden="true"></i>TerraDomain<small>SERVICE DOCS</small></a>
  <div class="doc-top-actions">
    <a class="pill txt" href="/" data-en="Home">返回首页</a>
    <a class="pill txt" href="/dashboard" data-en="Console">控制台</a>
    <button class="pill" type="button" id="langBtn" aria-label="切换语言" data-en="EN">EN</button>
    <button class="pill" type="button" id="themeBtn" aria-label="切换深浅色">◐</button>
  </div>
</header>

<div class="doc-shell">
  <aside class="doc-toc">
    <p class="toc-title" data-en="Contents">目录</p>
    <nav aria-label="文档目录">
      <a href="#about" data-en="01 · About TerraDomain">01 · 关于 TerraDomain</a>
      <a href="#start" data-en="02 · Quick start">02 · 快速开始</a>
      <a href="#account" data-en="03 · Accounts & quota">03 · 账号与额度</a>
      <a href="#dns" data-en="04 · DNS records">04 · DNS 记录</a>
      <a href="#dnshe" data-en="05 · DNSHE hosting">05 · DNSHE 托管接入</a>
      <a href="#admin" data-en="06 · Site settings">06 · 站点设置</a>
      <a href="#limits" data-en="07 · Limits & FAQ">07 · 已知限制 / FAQ</a>
    </nav>
    <p class="toc-note" data-en="This page is a standalone TypeScript template — no framework, no external fonts, no extra API calls.">本页由 TypeScript 模板直出：无框架、无外部字体、不多发一个接口请求，刷新也不会误播跳页动画。</p>
  </aside>

  <main class="doc-body">
    <div class="doc-hero">
      <p class="eyebrow">TERRADOMAIN · SERVICE DOCUMENTATION</p>
      <h1>TerraDomain <em data-en="Service docs">服务文档</em><span aria-hidden="true">.</span></h1>
      <p class="lede" data-en="Everything about the software: what it does, how to register a subdomain, how DNS records work, and how to delegate a name to DNSHE — written from the actual product, including the parts that are still rough.">关于这套软件的全部说明：它能做什么、怎么申请子域名、DNS 记录怎么管、怎样把名字委派给 DNSHE。按站点实际功能写，也如实写出还不完善的地方。</p>
      <div class="doc-meta">
        <span data-en="Applies to: nic.299282.xyz">适用站点：nic.299282.xyz</span>
        <span data-en="Language: 中文 / EN">语言：中文 / EN</span>
        <span data-en="Mobile ready">手机适配</span>
      </div>
    </div>

    <!-- 01 -->
    <section class="doc-sec" id="about">
      <div class="doc-sec-head"><span class="doc-sec-no">01</span><h2 data-en="About TerraDomain">关于 TerraDomain</h2></div>
      <p data-en="TerraDomain is a subdomain distribution and DNS management system running on Cloudflare Workers + D1. It takes a root domain, splits it into names people can apply for, and hands DNS control of each name back to its owner.">TerraDomain 是一套跑在 Cloudflare Workers + D1 上的<strong>二级域名分发与 DNS 管理系统</strong>：把一个根域名切成很多可申请的子域名，审核通过后把该名字的 DNS 管理权交还给申请人。</p>
      <p data-en="It manages names and their DNS records. It does not host websites, provide an SLA, or act as a registrar for arbitrary TLDs.">它只负责「名字 + 解析记录」，<strong>不托管网站内容、不提供 SLA、也不是通用顶级域注册商</strong>。这一点写在最前面，免得后面产生误会。</p>
      <div class="cards">
        <div class="card"><span class="ico">APPLY</span><h3 data-en="Applications & review">申请与审核</h3><p data-en="Name availability check, AI review, hourly re-check of pending applications, email allowlist and third-party email request flow, slider captcha before submit.">名称可用性检查、AI 审核、待审每小时复核、邮箱白名单与第三方邮箱申请、提交注册时的滑块拼图验证。</p></div>
        <div class="card"><span class="ico">DNS</span><h3 data-en="DNS management">DNS 管理</h3><p data-en="A / AAAA / CNAME / MX / TXT / NS and more, editable and deletable, with one-click presets for Vercel, Netlify, Cloudflare Pages, GitHub Pages and DNSHE.">A / AAAA / CNAME / MX / TXT / NS 等记录可增删改，附 Vercel、Netlify、Cloudflare Pages、GitHub Pages、DNSHE 一键模板。</p></div>
        <div class="card"><span class="ico">ACCOUNT</span><h3 data-en="Accounts">账号体系</h3><p data-en="Email sign-up, NodeLoc OAuth, per-user quota, check-in points, transfers, tickets, WHOIS lookup, abuse reports, bilingual UI.">邮箱注册、NodeLoc OAuth、用户配额、签到积分、域名转移、工单、WHOIS 查询、滥用举报、中英双语。</p></div>
      </div>
      <h3 data-en="How it is built">技术构成</h3>
      <p data-en="TypeScript end to end: React 18 + Vite for the console, Hono on Cloudflare Workers for the API, D1 for data, R2 for avatars. The repository tracks no .html source — the SPA shell and both root-domain landing pages are emitted from TypeScript templates, and this page is one of them.">全栈 TypeScript：控制台是 React 18 + Vite，接口层是 Cloudflare Workers 上的 Hono，数据存 D1、头像存 R2。仓库里不跟踪任何 <code>.html</code> 源文件 —— SPA 外壳、两个根域名落地页、以及你正在看的这一页，都由 TypeScript 模板输出。</p>
      <p data-en="Visual language is the Reverie pass: warm paper, deep fern green, ink pills, hairline rules, one italic serif accent, a full-page wallpaper, and a Miku page-transition that only appears on real navigation (never on refresh).">视觉语言沿用 Reverie 重构：暖纸色、深蕨绿、墨黑药丸、发丝线、只有一处衬线绿斜体、满铺壁纸，以及只在真正跳转时出现的 Miku 过渡动画（刷新不播）。</p>
    </section>

    <!-- 02 -->
    <section class="doc-sec" id="start">
      <div class="doc-sec-head"><span class="doc-sec-no">02</span><h2 data-en="Quick start">快速开始</h2></div>
      <p data-en="Five steps from a fresh account to a working record.">从新账号到一条生效的解析记录，一共五步。</p>
      <ol>
        <li data-en="Create an account with an allowed email, or sign in with NodeLoc. Already signed in? The header shows a link straight to the console instead of a login button.">用允许的邮箱注册，或用 NodeLoc 登录。已登录时首页顶栏会直接显示「→ 去往控制台」，不再出现登录按钮。</li>
        <li data-en="If your email is not on the allowlist, use the request link on the sign-up page. An admin approves it in the console and the email is added to the allowlist automatically.">邮箱不在允许范围？注册页有「申请使用此邮箱注册」入口，填邮箱与理由提交；管理员在后台通过后，该邮箱会自动加入白名单。</li>
        <li data-en="Go to Register, check the name, then submit. The slider captcha appears as a dialog only after you press submit; pass it and the application continues automatically.">进入注册页检查名称是否可用，点提交注册。滑块拼图<strong>只在提交后以弹窗出现</strong>，通过后自动接着提交，不会卡在「子域名不存在」的循环里。</li>
        <li data-en="AI review runs immediately on submission and pending applications are re-checked hourly. Once approved, the name shows up in My Domains.">提交即刻跑一次 AI 审核，待审申请每小时还会复核一次；通过后名字出现在「我的域名」。</li>
        <li data-en="Open DNS records, add A / CNAME / MX … or use a one-click template. NS records are ordinary DNS records too — see section 05 for full delegation.">打开「DNS 记录」添加 A / CNAME / MX 等，或用一键模板；把整个名字交给第三方解析，见第 05 节。</li>
      </ol>
      <div class="callout"><p data-en="Reserved labels such as ai, dash and nic are blocked for regular applications. Admins can still create them manually, and the baseline list cannot be removed from settings.">系统保留名称（<code>ai</code> / <code>dash</code> / <code>nic</code> 等）普通用户不可申请；管理员仍可手动开通，且后台设置无法删掉这份基线名单。</p></div>
    </section>

    <!-- 03 -->
    <section class="doc-sec" id="account">
      <div class="doc-sec-head"><span class="doc-sec-no">03</span><h2 data-en="Accounts & quota">账号与额度</h2></div>
      <p data-en="The per-user quota is decided in Site settings. -1 means unlimited, 0 blocks applications, and the default is 5. Sync to all users overwrites existing regular users; admins are always unlimited.">每个用户的可申请数量由「站点设置 → 新用户默认配额」决定：<code>-1</code> 不限量、<code>0</code> 禁止申请、默认 5。勾选「一键同步」会覆盖已有普通用户，管理员始终不限量；用户列表里也能单独给某个人改，或「填入全局默认」。</p>
      <p data-en="Binding a NodeLoc account grants +5 quota once per account. Unbinding and re-binding, switching provider accounts, or replaying the OAuth callback will not stack the bonus.">绑定 NodeLoc 账号会<strong>一次性</strong>增加 5 个配额；解绑再绑、换号、重复回调都不会叠加。首次用 NodeLoc 登录建号与旧账号补领同样发放，管理员与不限量账号跳过。</p>
      <p data-en="The OAuth integration only needs the email from the provider profile; the id is derived from the email when the provider omits it. A third-party email can never be used to take over an existing local account.">NodeLoc 资料只读取 email；对方没给 id 时用邮箱派生稳定标识。第三方邮箱不会被用来冒领已有本地账号。</p>
      <p data-en="Other account features: check-in points and the rewards centre, domain transfer, support tickets, profile/avatar, notifications, and an abuse report form.">其余配套：签到积分与奖励中心、域名转移、工单系统、个人资料与头像、通知中心、滥用举报。</p>
    </section>

    <!-- 04 -->
    <section class="doc-sec" id="dns">
      <div class="doc-sec-head"><span class="doc-sec-no">04</span><h2 data-en="DNS records">DNS 记录</h2></div>
      <p data-en="Every approved name gets its own record list. Supported types share one validation path, one TTL list and one editable table.">每个已开通的名字都有独立记录列表；所有记录类型共用同一套校验、TTL 选项与可编辑表格。</p>
      <div class="callout star"><span class="tag">KEY RULE</span><p data-en="An NS record is an ordinary DNS record. It appears in the same list, can be edited and deleted like any other row, and no separate hosting table or API is involved.">NS 记录<strong>也是普通 DNS 记录</strong>：添加后出现在同一张列表里，能编辑、能删除，不存在另一套「托管表」或独立接口。把子域名交给第三方解析，本质就是在父区写两条 NS。</p></div>
      <p data-en="One-click presets: Vercel CNAME, Netlify CNAME, Cloudflare Pages, GitHub Pages A, www alias, SPF reject-all, DMARC reject, and DNSHE hosting NS. Clicking a preset is idempotent — repeating it will not create duplicate rows.">常用模板：Vercel CNAME、Netlify CNAME、Cloudflare Pages、GitHub Pages A、www 别名、SPF 拒绝全部、DMARC 拒绝、DNSHE 托管 NS。重复点不会生成重复记录。</p>
      <p data-en="WHOIS lookup is public and needs no login. The abuse report and terms pages are public too.">WHOIS 查询、服务条款、滥用举报均公开，不需要登录。</p>
    </section>

    <!-- 05 -->
    <section class="doc-sec" id="dnshe">
      <div class="doc-sec-head"><span class="doc-sec-no">05</span><h2 data-en="Service guide · DNSHE hosting">服务文档 · DNSHE 托管接入</h2></div>
      <p data-en="Delegate a TerraDomain subdomain to DNSHE, using ksdk.noxc.uk as the running example. The eight screenshots correspond to figures 1–8 below.">把 TerraDomain 子域名交给 DNSHE 解析，以 <code>ksdk.noxc.uk</code> 为例；下面 8 张图与文内编号一一对应。</p>
      <div class="callout"><span class="tag">ONE SENTENCE</span><p data-en="Delegation means writing two NS records in the parent zone (TerraDomain). After that, every A / AAAA / CNAME / MX / TXT under this name is managed inside DNSHE.">托管 = <strong>在父区（TerraDomain）写两条 NS 记录</strong>，把解析权交出去；之后该名字下所有 A / AAAA / CNAME / MX / TXT 都在 DNSHE 里管。</p></div>

      <h3 data-en="Two sets of nameservers — do not mix them up">两套 NS 别搞混（最容易错的地方）★</h3>
      <div class="table-scroll"><table>
        <thead><tr><th data-en="Use case">用途</th><th data-en="Correct NS">正确的 NS</th></tr></thead>
        <tbody>
          <tr><td data-en="Adding a domain from TerraDomain (or elsewhere) into DNSHE DNS Management">从 TerraDomain 等外部把域名「添加」进 DNSHE DNS Management 托管</td><td><code>ns1.dnshe.org</code> / <code>ns2.dnshe.org</code></td></tr>
          <tr><td data-en="Nameservers of domains registered directly at DNSHE">直接在 DNSHE <strong>注册的域名</strong>自带的 NS 伺服器</td><td><code>ns1.dnshe.com</code> / <code>ns2.dnshe.com</code></td></tr>
        </tbody>
      </table></div>
      <div class="callout warn"><span class="tag">IMPORTANT</span><p data-en="ns1/ns2.dnshe.com belong exclusively to domains registered at DNSHE; they do not apply to subdomains delegated from TerraDomain. This whole guide uses .org only. api005.dnshe.com and similar hosts are API / console gateways, not authoritative nameservers — never put them in a record."><code>ns1.dnshe.com</code> / <code>ns2.dnshe.com</code> <strong>专属于在 DNSHE 注册的域名</strong>，不适用于从 TerraDomain 委派出去的子域名。本文全流程只用 <code>.org</code>：图 6（TerraDomain 写入）与图 7（DNSHE 分配）都是它。<code>api005.dnshe.com</code> 之类是 API / 控制台网关，不是权威 NS，别填进记录里。</p></div>
      <p data-en="Order matters: add the domain at DNSHE and get the NS first, write the NS in the parent zone, then go back and add records.">顺序别反：先在 DNSHE 加域名拿到 NS → 再去父区写 NS → 最后回 DNSHE 加记录。</p>

      <div class="step"><div class="step-no">1</div><div class="step-body">
        <h3 data-en="Add the domain at DNSHE">DNSHE 侧添加域名</h3>
        <p data-en="In the left menu choose DNS 解析 (DNS Management, marked Free), then click Add domain on the right. API keys and Activity log are not needed here.">左侧菜单点「DNS 解析」（进入 <em>DNS Management</em>，标了 <em>Free</em>），右侧点 <em>Add domain</em>。旁边的 <em>API keys</em>、<em>Activity log</em> 本次用不到。</p>
        <div class="fig-grid">
          <figure class="doc-fig"><picture><source srcset="/img/docs/fig1.webp" type="image/webp"><img src="/img/docs/fig1.png" width="461" height="1378" loading="lazy" alt="图 1 DNSHE 左侧菜单 DNS 解析"></picture><figcaption data-en="Fig 1 · Left menu: DNS 解析">图 1 · 左侧菜单「DNS 解析」</figcaption></figure>
          <figure class="doc-fig"><picture><source srcset="/img/docs/fig2.webp" type="image/webp"><img src="/img/docs/fig2.png" width="1830" height="259" loading="lazy" alt="图 2 DNS Management 的 Add domain 按钮"></picture><figcaption data-en="Fig 2 · Add domain button in DNS Management">图 2 · DNS Management 的 <em>Add domain</em></figcaption></figure>
        </div>
        <figure class="doc-fig"><picture><source srcset="/img/docs/fig3.webp" type="image/webp"><img src="/img/docs/fig3.png" width="2666" height="1440" loading="lazy" alt="图 3 填写域名的 Add domain 弹窗"></picture><figcaption data-en="Fig 3 · Add domain dialog: enter a bare domain name">图 3 · <em>Add domain</em> 弹窗：Domain name 填纯域名，如 <code>ksdk.noxc.uk</code>；不要带 <code>https://</code>、路径或末尾斜杠，然后点右下角 <em>Add domain</em>。</figcaption></figure>
      </div></div>

      <div class="step"><div class="step-no">2</div><div class="step-body">
        <h3 data-en="Get the assigned nameservers (see Fig 7)">拿到分配的 NS（先看图 7）</h3>
        <p data-en="A New domain setup dialog appears with three steps: 1. Add domain (done), 2. Add DNS records (current), 3. Update nameservers. It lists ns1.dnshe.org and ns2.dnshe.org with Copy / Copy all. The yellow notice says the nameserver change has not been detected yet — that is normal until you update the parent zone and wait.">创建后弹出 <em>New domain setup</em>，步骤条为 <code>1. Add domain</code>（已完成）→ <code>2. Add DNS records</code>（当前）→ <code>3. Update nameservers</code>；正文列出 <code>ns1.dnshe.org</code> / <code>ns2.dnshe.org</code>，右侧有 <em>Copy</em>、<em>Copy all</em>。黄色提示「尚未检测到 NS 变更」是正常的，改完等一会儿再复查。</p>
        <p data-en="Update nameservers here means go to your registrar / parent zone and change NS — for TerraDomain users that is the one-click preset in step 3, not something you do inside DNSHE. Do NOT click any bottom button yet; switch to TerraDomain first.">⚠️ 步骤条里的 <em>Update nameservers</em> 指「到上级去改 NS」，对 TerraDomain 用户就是下面第 3 步的一键模板，不是在 DNSHE 里改。<strong>先别点底部任何按钮</strong>，切到 TerraDomain 把 NS 写进去再回来。</p>
        <figure class="doc-fig"><picture><source srcset="/img/docs/fig7.webp" type="image/webp"><img src="/img/docs/fig7.png" width="2666" height="1624" loading="lazy" alt="图 7 New domain setup 给出两条 ns.dnshe.org"></picture><figcaption data-en="Fig 7 · New domain setup with the two .org NS and the three bottom buttons">图 7 · <em>New domain setup</em>：两条 <code>.org</code> NS + 底部三个按钮（<em>Check again</em> / <em>Add DNS records</em> / <em>Cancel</em>）</figcaption></figure>
      </div></div>

      <div class="step"><div class="step-no">3</div><div class="step-body">
        <h3 data-en="Write the NS records in TerraDomain">TerraDomain 侧写入 NS 记录</h3>
        <p data-en="Domain management → My Domains, find the name (record count is 0 at this point) and click DNS 记录. In 常用模板 press DNSHE 托管 NS（一键）. Two NS rows appear, each editable and deletable; check that both values are .org and both are healthy.">域名管理 →「我的域名」，找到该名字（此时记录数为 0），点右侧「DNS 记录」；页面下方「常用模板」点「DNSHE 托管 NS（一键）」，重复点不会生成重复记录。列表出现两条 NS，每行都有「编辑 / 删除」—— 核对<strong>值是 .org 不是 .com</strong>、两条都在且状态正常。</p>
        <div class="fig-grid">
          <figure class="doc-fig"><picture><source srcset="/img/docs/fig4.webp" type="image/webp"><img src="/img/docs/fig4.png" width="2266" height="1378" loading="lazy" alt="图 4 我的域名列表里的 DNS 记录按钮"></picture><figcaption data-en="Fig 4 · My Domains → DNS 记录">图 4 · 我的域名 →「DNS 记录」</figcaption></figure>
          <figure class="doc-fig"><picture><source srcset="/img/docs/fig5.webp" type="image/webp"><img src="/img/docs/fig5.png" width="1155" height="534" loading="lazy" alt="图 5 常用模板 DNSHE 托管 NS 一键"></picture><figcaption data-en="Fig 5 · Preset: DNSHE 托管 NS（一键）">图 5 · 常用模板「DNSHE 托管 NS（一键）」</figcaption></figure>
        </div>
        <figure class="doc-fig"><picture><source srcset="/img/docs/fig6.webp" type="image/webp"><img src="/img/docs/fig6.png" width="1254" height="422" loading="lazy" alt="图 6 生成的两条 NS 记录"></picture><figcaption data-en="Fig 6 · Two NS rows: ns1.dnshe.org / ns2.dnshe.org">图 6 · 两条 NS 记录已生成，主机名 <code>ksdk.noxc.uk</code>、值分别为 <code>ns1.dnshe.org</code> / <code>ns2.dnshe.org</code>，TTL 自动、状态正常</figcaption></figure>
      </div></div>

      <div class="step"><div class="step-no">4</div><div class="step-body">
        <h3 data-en="Fig 7 → Fig 8: the button you must press">图 7 → 图 8 的关键一步 ★★</h3>
        <p data-en="Back in the New domain setup dialog (if closed, open Manage → on that row in the domain list). The three bottom buttons do completely different things:">回到 <em>New domain setup</em> 弹窗（若已关掉，在域名列表该行点 <em>Manage →</em> 重新进入）。底部三个按钮作用完全不同：</p>
        <div class="table-scroll"><table>
          <thead><tr><th data-en="Button">按钮</th><th data-en="What it does">作用</th><th data-en="Opens Fig 8?">会不会跳到图 8</th></tr></thead>
          <tbody>
            <tr><td><code>Check again</code></td><td data-en="Re-checks whether the parent-zone NS is live">重新检测父区 NS 是否已生效</td><td data-en="No — only refreshes the yellow notice in place">❌ 只原地刷新那句黄色提示</td></tr>
            <tr><td><code>Add DNS records</code></td><td data-en="Opens the DNS records page for this domain">进入该域名的 DNS records 管理页</td><td data-en="YES — this is the one">✅ 就是它</td></tr>
            <tr><td><code>Cancel</code></td><td data-en="Closes the guide and returns to the domain list">关闭引导，回域名列表</td><td data-en="No">❌</td></tr>
          </tbody>
        </table></div>
        <div class="callout star"><span class="tag">MUST READ</span><p data-en="You MUST click the blue Add DNS records button to see the Fig 8 screen. Check again only re-checks, Cancel exits the guide. Fig 7 gives you the NS and tells you to change them; Fig 8 is where you add records — the bridge between them is Add DNS records."><strong>必须点中间蓝色的 <code>Add DNS records</code>，才会看到图 8 的界面。</strong>点 <em>Check again</em> 只会重新检测、不会跳转；点 <em>Cancel</em> 直接退出引导。记住：图 7 是「给你 NS、让你去改 NS」，图 8 是「进来加记录」，中间那座桥就是 <em>Add DNS records</em>。</p></div>
        <figure class="doc-fig"><picture><source srcset="/img/docs/fig8.webp" type="image/webp"><img src="/img/docs/fig8.png" width="2666" height="1744" loading="lazy" alt="图 8 点击 Add DNS records 后进入的 DNS records 空记录页"></picture><figcaption data-en="Fig 8 · DNS records page reached only by clicking Add DNS records in Fig 7">图 8 · <strong>点图 7 的 <em>Add DNS records</em> 后</strong>才出现的 DNS records 页：域名标记 <em>Active</em>，停在 <em>DNS records</em> 标签，显示「0 records / No DNS records found.」—— 这是新区域刚建好的<strong>正常状态</strong>，不是报错、也不是 NS 没生效。点「Add the first DNS record」或右上「+ Add record」开始加记录。</figcaption></figure>
      </div></div>

      <h3 data-en="Propagation & verification">生效与验证</h3>
      <ul>
        <li data-en="Back on Fig 7, press Check again; once the yellow notice disappears, DNSHE has detected the delegation.">回图 7 点 <em>Check again</em>，黄色提示消失即代表 DNSHE 检测到委派。</li>
        <li data-en="DNS propagation takes minutes, up to 24–48 hours. Do not keep deleting and re-adding records while waiting.">DNS 传播通常几分钟，最长可能到 24–48 小时；期间别反复删改。</li>
        <li data-en="Once live, Fig 8 in DNSHE is authoritative for all records under that name; the two NS rows in TerraDomain no longer manage concrete records.">生效后，该名字下的所有记录<strong>以 DNSHE 图 8 页面为准</strong>，TerraDomain 里那两条 NS 不再管具体解析。</li>
        <li data-en="Verify with: dig ksdk.noxc.uk NS (should return ns1/ns2.dnshe.org), then dig <host> A for your expected IP.">验证：<code>dig ksdk.noxc.uk NS</code> 看是否返回 <code>ns1/ns2.dnshe.org</code>，再 <code>dig &lt;主机名&gt; A</code> 看预期 IP。</li>
      </ul>

      <h3 data-en="Troubleshooting">常见误区 / 排错</h3>
      <div class="table-scroll"><table>
        <thead><tr><th data-en="Symptom">现象</th><th data-en="Fix">原因 / 处理</th></tr></thead>
        <tbody>
          <tr><td data-en="Wrote ns1.dnshe.com / ns2.dnshe.com">写成 <code>ns1.dnshe.com</code> / <code>ns2.dnshe.com</code></td><td data-en="Those are for domains registered at DNSHE; edit both rows back to .org in Fig 6">那是 DNSHE 自家注册域名专用 NS；托管一律改回 <code>.org</code>，在图 6 直接「编辑」</td></tr>
          <tr><td data-en="Used api005.dnshe.com as NS">把 <code>api005.dnshe.com</code> 当 NS</td><td data-en="It is an API gateway, not an authoritative nameserver">那是 API 网关，不是权威 NS</td></tr>
          <tr><td data-en="An older build already wrote .com">旧版「托管到 DNSHE」已写入 <code>.com</code></td><td data-en="Edit the two rows to .org, or delete them and press the one-click preset again; old values are not migrated automatically">到「DNS 记录」把两条编辑成 <code>.org</code>，或删除后重点一键模板；已写入的旧值不会自动改</td></tr>
          <tr><td data-en="Check again never passes"><code>Check again</code> 一直不通过</td><td data-en="Verify both rows in Fig 6 exist, are spelled correctly and healthy, then wait for propagation">核对图 6 两条都在、拼写无误、状态正常，再等传播</td></tr>
          <tr><td data-en="Fig 8 shows 0 records">图 8 显示 0 records</td><td data-en="Normal — press Add the first DNS record">正常，点 <em>Add the first DNS record</em></td></tr>
          <tr><td data-en="Cannot find the Fig 7 dialog">找不到图 7 弹窗</td><td data-en="Open Manage → on the domain row to re-enter">域名列表该行 <em>Manage →</em> 重新进入</td></tr>
          <tr><td data-en="Want to cancel hosting">想取消托管</td><td data-en="Delete the two NS rows in TerraDomain; leaving the DNSHE zone in place is harmless">在 TerraDomain 删掉那两条 NS 即可，DNSHE 侧区域留着不影响</td></tr>
        </tbody>
      </table></div>

      <h3 data-en="Button glossary">界面英文按钮对照</h3>
      <div class="table-scroll"><table>
        <thead><tr><th data-en="On screen">界面原文</th><th data-en="Meaning">中文</th></tr></thead>
        <tbody>
          <tr><td>DNS 解析 / DNS Management</td><td data-en="DNS management">DNS 解析管理</td></tr>
          <tr><td>Add domain</td><td data-en="Add a domain">添加域名</td></tr>
          <tr><td>New domain setup</td><td data-en="New domain setup guide">新域名设置引导</td></tr>
          <tr><td>Copy / Copy all</td><td data-en="Copy one / copy both">复制 / 复制全部</td></tr>
          <tr><td>Check again</td><td data-en="Re-check NS detection">重新检测 NS 是否生效</td></tr>
          <tr><td>Add DNS records</td><td data-en="Open the DNS records page (Fig 7 → Fig 8)">进入 DNS 记录页（图 7 → 图 8）</td></tr>
          <tr><td>Update nameservers</td><td data-en="Change NS at the registrar / parent zone">到注册商 / 上级改 NS</td></tr>
          <tr><td>Overview / Nameservers / DNSSEC / Domain settings</td><td data-en="Overview / NS / DNSSEC / domain settings">概览 / NS / DNSSEC / 域名设置</td></tr>
          <tr><td>Manage → / Active</td><td data-en="Manage this domain / Activated">管理该域名 / 已激活</td></tr>
        </tbody>
      </table></div>
      <p data-en="Written from the screenshots; if the DNSHE console changes later, follow the live interface.">本文按截图实写；DNSHE 控制台界面若后续更新，以实际页面为准。</p>
    </section>

    <!-- 06 -->
    <section class="doc-sec" id="admin">
      <div class="doc-sec-head"><span class="doc-sec-no">06</span><h2 data-en="Site settings (admins)">站点设置（管理员）</h2></div>
      <p data-en="Everything below is changed in the console and takes effect on save — no redeploy needed.">以下都在后台「站点设置」里改，保存即生效，不用重新部署。</p>
      <ul>
        <li data-en="Default quota and sync-to-all; reserved labels are appended to a built-in baseline (ai / dash / nic) that cannot be removed.">新用户默认配额、一键同步；保留域名是在内置基线（<code>ai</code>/<code>dash</code>/<code>nic</code>）上追加，基线删不掉。</li>
        <li data-en="Registration captcha: enable/disable and pick the image set. The dialog only opens on submit; admins creating a name manually are exempt.">注册滑块验证：开关与图库子集；弹窗只在提交时出现，管理员手动开通豁免。</li>
        <li data-en="Footer ICP number and footer contact link — paste an <a> anchor, empty hides it. Both are rendered server-side on first paint.">页脚备案号、页脚联系方式：贴 <code>&lt;a&gt;</code> 链接即可，留空隐藏；两者首屏直出，不等接口。</li>
        <li data-en="AI review channel, root domain list, public stats, email allowlist and third-party email requests, DNSHE NS presets.">AI 审核通道、根域名列表、首页公开统计、邮箱白名单与第三方邮箱申请、DNSHE NS 预设。</li>
      </ul>
    </section>

    <!-- 07 -->
    <section class="doc-sec" id="limits">
      <div class="doc-sec-head"><span class="doc-sec-no">07</span><h2 data-en="Known limits & FAQ">已知限制 / FAQ</h2></div>
      <p data-en="These are real constraints, not polish notes.">以下是真实边界，不是「待优化」的客套话。</p>
      <ul>
        <li data-en="Nameservers for the root domains are spread across Spaceship and Cloudflare; there is no wildcard record issued for every subdomain. Only names that were explicitly created or delegated resolve.">两个根域名的 NS 分散在 Spaceship 与 Cloudflare，<strong>没有下发通配记录</strong>：只有显式创建或委派过的名字才解析，后台审核通过不等于 DNS 已生效。</li>
        <li data-en="A few subdomains are NS-delegated to third parties (for example Vercel); those never pass through this Worker and its settings cannot manage them.">少数子域是 NS 委派给第三方的（例如 Vercel 项目），完全不经过本站 Worker，后台管不到。</li>
        <li data-en="Some carrier-to-overseas links are unstable; a proxy may be needed for those third-party projects. This is a network path issue, not DNS failure.">部分运营商到海外链路不稳，访问第三方项目可能需要代理；这是链路问题，不是 DNS 解析失败。</li>
        <li data-en="No SLA, no website hosting, no automatic email notification to admins when a third-party email request arrives — check the console tab.">没有 SLA、不托管网站内容；第三方邮箱申请提交后不会主动发邮件通知管理员，需进后台页签查看。</li>
      </ul>
      <h3 data-en="FAQ">常见问题</h3>
      <div class="table-scroll"><table>
        <thead><tr><th data-en="Question">问题</th><th data-en="Answer">回答</th></tr></thead>
        <tbody>
          <tr><td data-en="Why is there no transition animation on refresh?">为什么刷新没有过渡动画？</td><td data-en="By design: the Miku transition is triggered only by detected navigation. Reload, direct URL entry and external visits stay still.">刻意如此：Miku 过渡只在侦测到跳转时出现；刷新、地址栏直接打开、外部进入都不播。</td></tr>
          <tr><td data-en="Why does a slow page take longer to switch?">为什么慢页面切换会等更久？</td><td data-en="Target-page data is prefetched the moment you click; the page switches only when data is ready (or at the timeout), so you never land on a half-empty shell.">点击瞬间并行预取目标页数据，资料到手才换页，不会让你看到空壳慢慢填；快页约 0.7 秒，慢页才真的等。</td></tr>
          <tr><td data-en="The captcha used to say the subdomain does not exist">以前滑块验证会说「子域名不存在」</td><td data-en="Fixed: the verify route has its own prefix and no longer collides with /subdomains/:id. Pass and the application continues automatically.">已修：验证走独立前缀，不再被域名 id 路由吃掉；通过后自动接着提交。</td></tr>
          <tr><td data-en="Where do I find the DNSHE guide with all eight screenshots?">八张图的 DNSHE 完整文档在哪？</td><td data-en="Section 05 above is the full guide; figures 1–8 are embedded in order, including the Fig 7 → Fig 8 step.">上面第 05 节就是完整版，图 1–图 8 按顺序内嵌，含图 7 → 图 8 那一步。</td></tr>
        </tbody>
      </table></div>
    </section>
  </main>
</div>

<footer class="doc-foot">
  <div class="doc-foot-in">
    <span>© <span id="yr">2026</span> TerraDomain · <span data-en="Service documentation">服务文档</span></span>
    <span class="sep"></span>
    <a href="/" data-en="Home">返回首页</a>
    <a href="https://github.com/wcvjk8tnz8-create/MeoyDomain" target="_blank" rel="noopener noreferrer">GitHub</a>
    <a href="https://icp.gov.moe/?keyword=20269429" target="_blank" rel="noopener noreferrer">萌ICP备20269429号</a>
    <a href="https://t.me/+cTDEQy_0HqcxZDVl" target="_blank" rel="noopener noreferrer">Telegram</a>
  </div>
</footer>


<script>
(function(){
  var root = document.documentElement;
  var yr = document.getElementById('yr'); if (yr) yr.textContent = new Date().getFullYear();

  /* 与 SPA 的 pageTransition 共用导航意图：刷新不淡入，跳转才淡入；
     点站内链接再留标记，让目标 SPA 页正常播 Miku 过渡。 */
  var KEY = 'td:nav-intent';
  var had = false;
  try { had = sessionStorage.getItem(KEY) !== null; sessionStorage.removeItem(KEY); } catch (e) {}
  var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
  if (had && nav.type !== 'reload') document.body.classList.add('doc-arrived');
  document.addEventListener('click', function (e) {
    var t = e.target, a = t && t.closest ? t.closest('a[href]') : null;
    if (!a || a.target === '_blank' || e.defaultPrevented) return;
    var h = a.getAttribute('href') || '';
    if (h.charAt(0) === '#' || /^(https?:|mailto:|tel:|javascript:)/i.test(h)) return;
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch (err) {}
  });

  /* 主题：与全站共用 meoy_theme，浅色显式存 light 以压过系统深色 */
  var tb = document.getElementById('themeBtn');
  tb.addEventListener('click', function () {
    var dark = root.getAttribute('data-theme') === 'dark' ||
      (!root.getAttribute('data-theme') && window.matchMedia &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('meoy_theme', next); } catch (e) {}
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#0a1220' : '#ffffff');
    tb.title = next === 'dark' ? '切换到浅色' : '切换到深色';
    tb.setAttribute('aria-label', tb.title);
  });

  /* 中英：中文直接写在 DOM 里作为无 JS 兜底，切换时整体替换 innerHTML */
  var nodes = [].slice.call(document.querySelectorAll('[data-en]'));
  nodes.forEach(function (el) { el.setAttribute('data-zh', el.innerHTML); });
  var lb = document.getElementById('langBtn');
  function setLang(l) {
    root.setAttribute('data-lang', l);
    root.lang = l === 'en' ? 'en' : 'zh-CN';
    nodes.forEach(function (el) {
      el.innerHTML = l === 'en' ? el.getAttribute('data-en') : el.getAttribute('data-zh');
    });
    lb.textContent = l === 'en' ? '中文' : 'EN';
    lb.classList.toggle('on', l === 'en');
    document.title = l === 'en' ? 'Service Docs · TerraDomain' : '服务文档 · TerraDomain';
  }
  lb.addEventListener('click', function () {
    var next = root.getAttribute('data-lang') === 'en' ? 'zh' : 'en';
    setLang(next);
    try { localStorage.setItem('td:doc-lang', next); } catch (e) {}
  });
  try { if (localStorage.getItem('td:doc-lang') === 'en') setLang('en'); } catch (e) {}

  /* 目录高亮 */
  if ('IntersectionObserver' in window) {
    var links = [].slice.call(document.querySelectorAll('.doc-toc nav a'));
    var byId = {}; links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove('active'); });
        var a = byId[en.target.id]; if (a) a.classList.add('active');
      });
    }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
    [].slice.call(document.querySelectorAll('.doc-sec')).forEach(function (s) { io.observe(s); });
  }
})();
</script>

</body>
</html>
`;
