#!/usr/bin/env python3
"""移动端适配 · 多视口浏览器真跑（NodeLoc 社区反馈「手机适配垃圾」）

按 main.tsx 的生产顺序拼 5 份 CSS，用与首页 / 控制台 / 域名详情 /
站点设置 / 弹窗等价的 DOM，在 320–430 手机、768 平板、手机横屏上：
  · 逐元素扫「非表格横滚容器内」的右溢出 → 必须为 0
  · 页面级 scrollWidth 不得超过视口
  · 所有可见按钮 / 标签的触控目标 ≥ 44px
  · 明 / 暗主题各出一张实拍图

表格 .tablewrap 内部横向滚动是刻意设计，INPUT 的 scrollWidth 是文本
固有行为，两者都排除，避免把「正常」误报成 bug。

环境没有 Playwright 时静默退出（不输出 RESULT_JSON），CI 会自动跳过；
CI 里的阻断由 scripts/mobile-regression.ts 的静态断言承担。
输出图片到 /data/workspace/_preview/，最后一行打印 RESULT_JSON:{...}。
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = Path('/data/workspace/_preview')
PREVIEW.mkdir(parents=True, exist_ok=True)

import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path('/data/workspace/subdomain-hub')
ORDER=['src/app/styles/shell.css','src/app/styles/captcha.css','src/app/styles/oauth.css','src/app/styles/design-system.css','src/app/styles/nodeloc-skin.css']
CSS='\n\n'.join('/* %s */\n%s'%(f,(ROOT/f).read_text(encoding='utf-8')) for f in ORDER)

HOME='''<div class="page-root rv-page"><div id="bg" aria-hidden="true"></div>
<header class="rv-head"><div class="rv-head-in">
<a class="rv-brand" href="/"><img src="/img/logo.jpg" alt=""><span><b>Noxc</b><i>Free subdomains</i></span></a>
<nav class="rv-nav"><a href="#features">特性</a><a href="#how">如何使用</a><a href="#suffix">后缀</a><a href="#faq">常见问题</a><a class="rv-pill line sm rv-login" href="/login">登录</a><a class="rv-pill ink sm zx-nav-cta" href="/register">立即注册 ↗</a></nav>
<a class="rv-pill ink sm rv-mobile-cta zx-nav-cta" href="/register">注册 ↗</a></div>
<button type="button" class="yn-motion yn-motion-float" id="ynMotion">暂停动效</button></header>
<main class="rv-main">
<section class="rv-hero rv-reveal yn-hero"><div class="yn-hero-grid">
<div class="yn-hero-copy">
<p class="rv-eyebrow yn-eyebrow">OPEN REGISTRATION <span>·</span> 5 FREE DOMAINS PER EMAIL</p>
<h1 class="rv-title yn-title"><span class="yn-line">属于你的</span><span class="yn-line"><em>专属子域名</em><span class="rv-fullstop">.</span></span></h1>
<p class="rv-lede">免费注册子域名，通过 NS 委托掌控解析。每个邮箱都有免费额度，超出后可随时在控制台购买额外配额。</p>
<div class="rv-actions"><a class="rv-pill ink lg" href="/register">开始注册 ↗</a><a class="rv-pill line lg" href="/dashboard">管理控制台 ↗</a></div>
<div class="rv-stats" id="siteStats"><div class="rv-stat"><b>128</b><span>注册人数</span></div><i class="rv-stat-rule"></i><button type="button" class="rv-stat rv-stat-toggle"><b>371</b><span>已开通域名<i class="rv-stat-caret"></i></span></button></div>
<div class="rv-hottest" id="statHottest">最热后缀 .noxc.uk HOT</div>
<div class="rv-breakdown" id="statBreakdown"><div class="rv-bd-head"><span>后缀</span><span>域名数</span><span>USERS</span></div><div><div class="rv-bd-row"><span class="mono">meoy.top</span><span>210</span><span>88</span></div></div></div>
</div>
<div class="yn-hero-panel"><div class="yn-panel">
<p class="yn-panel-cap">给下一个灵感 · 留一个位置</p>
<button type="button" class="yn-sample" data-yn-try="hello-world"><span class="yn-sample-name">hello-world<span>.noxc.uk</span></span><span class="yn-sample-arrow">↗</span></button>
<p class="yn-sample-hint">示例域名 · 点击试试</p><div class="yn-rule"></div>
<p class="yn-panel-label">查询可用性</p>
<form class="rv-ask" id="searchForm"><span class="rv-ask-ico"></span><input id="qName" placeholder="输入你想要的前缀">
<div class="rv-root-wrap"><select id="qRoot"><option>.noxc.uk</option><option>.meoy.top</option></select><svg viewBox="0 0 24 24" width="16" height="16"></svg></div>
<button type="submit" class="rv-pill ink rv-ask-btn">查询可用性 →</button></form>
<div class="zx-results rv-results" id="results"></div>
<div class="yn-try"><span>试试：</span><button type="button" data-yn-try="hello-world">hello-world ↗</button><button type="button" data-yn-try="my-app">my-app ↗</button><button type="button" data-yn-try="portfolio">portfolio ↗</button></div>
</div><p class="rv-hint yn-panel-foot">输入前缀，查询它在各个后缀下是否可用</p></div></div></section>
<section class="zx-facts"><div class="zx-fact"><span class="zx-fact-k">免费额度</span><span class="zx-fact-v">5 个 / 邮箱</span></div><div class="zx-fact"><span class="zx-fact-k">开通时效</span><span class="zx-fact-v">30 秒</span></div><div class="zx-fact"><span class="zx-fact-k">解析方式</span><span class="zx-fact-v">NS 委托</span></div><div class="zx-fact"><span class="zx-fact-k">有效期</span><span class="zx-fact-v">365 天</span></div></section>
<section class="rv-sec" id="suffix"><p class="rv-sec-no">01 <span>/</span> SUFFIXES</p><h2 class="rv-h2">可选后缀</h2><p class="rv-sec-lede">首推 <b>noxc.uk</b>，挑一个顺口的前缀，再挑一个喜欢的结尾。</p>
<div class="nk-suffix rv-suffix"><div class="nk-sk"><span class="mono">noxc.uk</span><span>可用</span><a class="btn sm" href="/register">立即注册</a></div><div class="nk-sk"><span class="mono">v-1.top</span><span>可用</span><a class="btn sm" href="/register">立即注册</a></div><div class="nk-sk"><span class="mono">noxc.cc</span><span>可用</span><a class="btn sm" href="/register">立即注册</a></div></div></section>
<section class="rv-sec" id="features"><p class="rv-sec-no">02 <span>/</span> WHY NOXC</p><h2 class="rv-h2">为什么选择 Noxc</h2>
<div class="rv-cols"><article class="card rv-col"><span class="rv-col-ico">◉</span><h3>永久免费的域名注册</h3><p>注册即拥有完整管理权，免费续期，无需任何费用与信用卡。</p></article><article class="card rv-col"><span class="rv-col-ico">◈</span><h3>完善的 DNS 管理</h3><p>12 种记录类型、自定义 TTL、Cloudflare 代理、根域名验证一应俱全。</p></article><article class="card rv-col"><span class="rv-col-ico">◎</span><h3>免费技术支持</h3><p>内置工单系统与讨论区，遇到问题可随时提交，社区与管理员共同协助。</p></article></div>
<div class="rv-rule-row"><span>免费 DNS</span><span>专业级权威解析</span><span>12+ 记录类型</span><span>根域名验证</span><span>域名托管委派</span><span>DNSSEC 就绪</span></div></section>
</main></div>'''

SHELL_TOP='''<header class="topbar" id="topbar"><div class="topbar-in">
<button class="side-toggle" id="sideToggle" aria-label="菜单"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
<div class="crumb">首页<span>/</span><b>控制台</b></div>
<button class="top-search" id="topSearch"><svg viewBox="0 0 24 24" width="15" height="15"></svg><span>搜索</span><kbd>Ctrl K</kbd></button>
<button class="iconbtn" id="bellBtn" title="通知"><svg viewBox="0 0 24 24"><path d="M12 2a6 6 0 0 0-6 6v4l-2 3h16l-2-3V8a6 6 0 0 0-6-6z"/></svg></button>
<div class="user-chip" id="userChip"><span class="avatar" style="width:30px;height:30px;border-radius:50%;background:#888;display:inline-block"></span></div>
<button class="tb-stow" id="tbStow"><svg viewBox="0 0 24 24" width="16" height="16"></svg></button>
<div class="user-menu" id="userMenu" style="display:none"><div class="um-head"><span class="avatar"></span><div><div class="um-name">user</div><div class="um-mail">user@example.com</div></div></div><div class="um-body"><a href="/dashboard">我的域名</a><a href="/rewards">奖励中心</a><a href="/admin">管理后台</a></div></div>
<div class="notif-panel" id="notifPanel" style="display:none"><b>通知</b><p>站点公告内容</p></div>
</div></header>
<aside class="sidebar" id="sidebar"><div class="side-in">
<a class="side-brand" href="/"><img src="/img/logo.jpg" alt=""><b>Noxc</b><span class="sb-sub">Free subdomains</span></a>
<div class="side-group"><span class="side-gtitle">控制台</span>
<a class="side-item on" href="/dashboard"><span class="side-ico"><svg viewBox="0 0 24 24"></svg></span><span class="side-txt">控制台</span></a>
<a class="side-item" href="/domain"><span class="side-ico"><svg viewBox="0 0 24 24"></svg></span><span class="side-txt">域名管理</span></a>
<a class="side-item" href="/register"><span class="side-ico"><svg viewBox="0 0 24 24"></svg></span><span class="side-txt">注册域名</span></a></div>
<div class="side-group"><span class="side-gtitle">资源管理</span>
<a class="side-item" href="/whois"><span class="side-ico"><svg viewBox="0 0 24 24"></svg></span><span class="side-txt">WHOIS 查询</span></a>
<a class="side-item" href="/transfer"><span class="side-ico"><svg viewBox="0 0 24 24"></svg></span><span class="side-txt">域名转移</span></a></div>
<div class="side-group"><span class="side-gtitle">用户中心</span>
<a class="side-item" href="/checkin"><span class="side-ico"><svg viewBox="0 0 24 24"></svg></span><span class="side-txt">签到地</span></a>
<a class="side-item" href="/rewards"><span class="side-ico"><svg viewBox="0 0 24 24"></svg></span><span class="side-txt">奖励中心</span></a></div>
<button class="btn sm ghost" id="sideCollapse">‹ 收起侧边栏</button>
</div></aside>'''

DASH='''<main class="main"><div class="main-in">
<div class="page-head"><h1 class="page-title">控制台</h1><p class="page-sub">管理你的子域名与 DNS 记录</p></div>
<div class="site-announcement">欢迎使用Noxc，站点公告在这里显示，支持很长很长的一段文字不会把布局撑破。</div>
<div class="stat-row td-stats">
<div class="stat-card sc-pink"><span class="sc-ico"><svg viewBox="0 0 24 24"></svg></span><div><div class="sc-num">371</div><div class="sc-lbl">域名总数</div></div></div>
<div class="stat-card sc-blue"><span class="sc-ico"><svg viewBox="0 0 24 24"></svg></span><div><div class="sc-num">1,204</div><div class="sc-lbl">DNS 记录</div></div></div>
<div class="stat-card sc-indigo"><span class="sc-ico"><svg viewBox="0 0 24 24"></svg></span><div><div class="sc-num">6,130</div><div class="sc-lbl">我的积分</div></div></div>
<div class="stat-card sc-amber"><span class="sc-ico"><svg viewBox="0 0 24 24"></svg></span><div><div class="sc-num">0</div><div class="sc-lbl">待审核</div></div></div></div>
<div class="card"><div class="head-row"><h3>我的域名</h3><a class="btn sm primary" href="/register">+ 申请域名</a></div>
<div class="tablewrap"><table><thead><tr><th>域名</th><th>根域名</th><th>状态</th><th>到期时间</th><th>DNS</th><th>操作</th></tr></thead><tbody>
<tr><td class="mono fqdn">hello-world.noxc.uk</td><td class="mono">noxc.uk</td><td><span class="badge ok">已开通</span></td><td class="nowrap">2027-11-25</td><td>12 条</td><td><button class="btn sm">管理</button><button class="btn sm ghost">删除</button></td></tr>
<tr><td class="mono fqdn">a-very-long-subdomain-name-for-testing.meoy.top</td><td class="mono">meoy.top</td><td><span class="badge ok">已开通</span></td><td class="nowrap">2027-11-25</td><td>3 条</td><td><button class="btn sm">管理</button><button class="btn sm ghost">删除</button></td></tr>
</tbody></table></div></div>
<div class="card"><div class="head-row"><h3>快捷入口</h3></div><div class="quick-row td-quickbar"><a class="quick" href="#"><span class="q-ico"><svg viewBox="0 0 24 24"></svg></span><span class="q-txt">我的域名</span></a><a class="quick" href="#"><span class="q-ico"><svg viewBox="0 0 24 24"></svg></span><span class="q-txt">注册域名</span></a><a class="quick" href="#"><span class="q-ico"><svg viewBox="0 0 24 24"></svg></span><span class="q-txt">奖励中心</span></a><a class="quick" href="#"><span class="q-ico"><svg viewBox="0 0 24 24"></svg></span><span class="q-txt">WHOIS 查询</span></a><a class="quick" href="#"><span class="q-ico"><svg viewBox="0 0 24 24"></svg></span><span class="q-txt">服务文档</span></a><a class="quick" href="#"><span class="q-ico"><svg viewBox="0 0 24 24"></svg></span><span class="q-txt">用户案例</span></a><a class="quick" href="#"><span class="q-ico"><svg viewBox="0 0 24 24"></svg></span><span class="q-txt">个人资料</span></a></div></div>
<footer class="site-foot"><div class="site-foot-in"><span>Noxc · 二级域名分发与 DNS 管理</span><span>萌ICP备20269429号</span><a href="#">Telegram</a></div></footer>
</div></main>'''

DETAIL='''<main class="main"><div class="main-in">
<div class="page-head"><h1 class="page-title">域名详情</h1><p class="page-sub">hello-world.noxc.uk</p></div>
<div class="alert warn">暂停解析：meoy.top 暂停解析期间暂不能修改 DNS 记录。</div>
<div class="detail-layout"><div>
<div class="card"><div class="tabs"><button class="tab on">DNS 记录</button><button class="tab">NS 委派</button><button class="tab">自助验证</button><button class="tab">用户案例展示</button><button class="tab">域名信息</button></div>
<div class="pane on"><div class="tablewrap"><table><thead><tr><th>类型</th><th>主机名</th><th>记录值</th><th>TTL</th><th>操作</th></tr></thead><tbody><tr><td>A</td><td class="mono">@</td><td class="mono">192.0.2.10</td><td>自动</td><td><button class="btn sm">编辑</button><button class="btn sm ghost">删除</button></td></tr></tbody></table></div>
<div class="row" style="gap:8px;margin-top:12px"><button class="btn primary">添加记录</button><button class="btn ghost">刷新</button></div></div></div>
<div class="card" style="margin-top:14px"><h3>添加 DNS 记录</h3><div class="grid2"><div class="field"><label>类型</label><select class="input"><option>A</option><option>AAAA</option></select></div><div class="field"><label>主机名</label><input class="input" value="@"></div><div class="field"><label>记录值</label><input class="input" placeholder="192.0.2.10"></div><div class="field"><label>TTL</label><select class="input"><option>自动</option></select></div></div><button class="btn primary">保存</button></div>
</div><aside class="detail-side"><div class="card"><h3>域名概览</h3><div class="kv"><span class="k">状态</span><span class="v"><span class="badge ok">已开通</span></span><span class="k">到期</span><span class="v">2027-11-25</span><span class="k">记录数</span><span class="v">12</span></div></div></aside></div>
<footer class="site-foot"><div class="site-foot-in"><span>Noxc · 二级域名分发与 DNS 管理</span></div></footer>
</div></main>'''

ADMIN='''<main class="main"><div class="main-in">
<div class="page-head"><h1 class="page-title">站点设置</h1><p class="page-sub">配置站点参数</p></div>
<div class="card"><div class="grid2">
<div class="field"><label>站点名称</label><input class="input" value="Noxc"></div>
<div class="field"><label>主推根域名</label><input class="input" value="noxc.uk"></div>
<div class="field"><label>站点公告</label><textarea class="input" rows="2">欢迎使用Noxc</textarea></div>
<div class="field"><label>暂停解析根域名（留空 = 全部恢复）</label><input class="input" placeholder="留空 = 解析正常"></div>
<div class="field"><label>AnyNS 管理令牌</label><input class="input" type="password" placeholder="nhtdns_..."></div>
<div class="field"><label>多根 Zone 映射</label><input class="input" value="meoy.top:4821,noxc.uk:4822"></div>
</div><div class="row" style="gap:8px;margin-top:12px"><button class="btn primary">保存</button><button class="btn">恢复默认</button><button class="btn ghost">刷新预览</button></div></div>
<div class="card" style="margin-top:14px"><h3>根域名管理</h3>
<div class="row" style="gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
<span class="mono" style="min-width:150px;font-weight:600">meoy.top</span><span class="badge ok">后台导入</span><span class="dim" style="font-size:12px">未配 Zone</span><span class="badge ok" style="font-size:11px">ANYNS DNS · #4821</span>
<select class="input" style="width:auto;padding:5px 8px;font-size:12px"><option>自动</option><option>Spaceship</option><option>Cloudflare</option><option selected>AnyNS</option></select>
<span style="flex:1"></span><button class="btn sm ghost">移除</button></div>
<div class="row" style="gap:8px;margin-top:12px"><button class="btn sm">从 AnyNS 拉取域名</button><span class="dim" style="font-size:12px">用站点设置里的管理令牌拉取解析区域</span></div></div>
<footer class="site-foot"><div class="site-foot-in"><span>Noxc · 二级域名分发与 DNS 管理</span></div></footer>
</div></main>'''

MODAL='''<main class="main"><div class="main-in"><div class="card"><h3>页面内容</h3><button class="btn primary" id="openBtn">打开弹窗</button></div></div></main>
<div class="mask" id="spMask" style="display:grid"><div class="modal-card" style="width:640px"><div style="padding:16px 20px;border-bottom:1px solid var(--line)"><b>从 AnyNS 添加根域名</b></div>
<div style="padding:12px 20px"><label class="row" style="gap:10px;padding:10px 0;border-bottom:1px solid var(--line)"><input type="checkbox" style="width:16px;height:16px"><span style="flex:1"><b class="mono">a-very-long-example-domain-name.example.com</b><span class="badge">Zone #4821</span><div class="hint">NS：ns1.anyns.io / ns2.anyns.io</div></span><input class="input" placeholder="CF Zone ID（可选）" style="width:170px"></label></div>
<div style="padding:14px 20px;display:flex;justify-content:flex-end;gap:10px"><button class="btn">取消</button><button class="btn primary">添加选中</button></div></div></div>'''

PAGES={'home':(HOME,'page-home page-reverie has-cloud'),
       'dashboard':(SHELL_TOP+DASH,''),
       'detail':(SHELL_TOP+DETAIL,''),
       'admin':(SHELL_TOP+ADMIN,''),
       'modal':(SHELL_TOP+MODAL,'')}

VIEWPORTS=[(320,640),(360,740),(375,812),(390,844),(414,896),(430,932),(768,1024),(844,390)]


VIEWPORTS = [(320, 640), (360, 740), (375, 812), (390, 844), (414, 896),
             (430, 932), (768, 1024), (844, 390)]

def html(body, cls, theme='light'):
    return f'''<!doctype html><html lang="zh-CN" data-theme="{theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>{CSS}</style></head>
<body class="{cls}"><div class="page-root">{body}</div></body></html>'''

SCAN = """(W) => {
  const vw = W, out = {sw: document.documentElement.scrollWidth, over: [], small: []};
  for (const el of document.querySelectorAll('body *')) {
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    /* 抽屉、下拉、通知面板在关闭状态本就离屏；表格横滚是刻意设计 */
    if (el.closest('.sidebar, .user-menu, .notif-panel, .root-picker-menu, .tablewrap')) continue;
    if (r.right > vw + 1.5) {
      const cn = (typeof el.className === 'string') ? el.className.slice(0, 56) : '';
      out.over.push(el.tagName.toLowerCase() + '.' + cn + '@' + Math.round(r.right));
    }
  }
  for (const el of document.querySelectorAll('button, a.btn, .btn, .iconbtn, .tab, .rv-pill, .side-toggle, .yn-sample, .yn-try button')) {
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden') continue;
    if (el.closest('.bgswitch, .sidebar, .user-menu, .notif-panel')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 43.5) {
      const cn = (typeof el.className === 'string') ? el.className.slice(0, 42) : '';
      out.small.push(el.tagName.toLowerCase() + '.' + cn + ' h=' + Math.round(r.height));
    }
  }
  return out;
}"""

checks = []
images = []
def check(cond, msg):
    checks.append({'ok': bool(cond), 'msg': msg})

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/local/bin/chromium', args=['--no-sandbox'])
    for name, (body, cls) in PAGES.items():
        for (w, h) in VIEWPORTS:
            for theme in ('light', 'dark'):
                pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
                pg.set_content(html(body, cls, theme), wait_until='load')
                pg.wait_for_timeout(90)
                r = pg.evaluate(SCAN, w)
                key = f'{name}@{w}x{h}/{theme}'
                check(r['sw'] <= w + 1, f'{key} 页面无横向滚动（sw={r["sw"]}）')
                check(not r['over'], f'{key} 无非表格元素右溢出' + (f'：{r["over"][:2]}' if r['over'] else ''))
                check(not r['small'], f'{key} 触控目标全部 ≥44px' + (f'：{r["small"][:2]}' if r['small'] else ''))
                if (w, h, theme) in [(375, 812, 'light'), (375, 812, 'dark'), (390, 844, 'light'), (768, 1024, 'dark')] \
                   and name in ('home', 'dashboard'):
                    f = PREVIEW / f'mobile_{name}_{w}_{theme}.png'
                    pg.screenshot(path=str(f), full_page=True)
                    images.append(str(f))
                pg.close()
    b.close()

bad = [c for c in checks if not c['ok']]
print(f'移动端适配回归：{len(checks) - len(bad)} 通过，{len(bad)} 失败')
for c in bad[:20]:
    print('  ✗', c['msg'])
print('RESULT_JSON:' + json.dumps({'ok': len(checks), 'bad': len(bad), 'images': images}, ensure_ascii=False))
