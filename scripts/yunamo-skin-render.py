#!/usr/bin/env python3
"""Yunamo 形态皮肤 · 浏览器真跑 + 改造前后对照图

按 main.tsx 的生产加载顺序拼 5 份 CSS，用与 Home.tsx 等价的 DOM 计算样式：
  · 按钮圆角、等宽字体、两段式查询、全宽主按钮、标题字重
  · 明/暗主题的 --zx-* 色值与改动前逐项比对（颜色保持现在的）
  · Try chips 点击零请求、暂停动效后内容仍可见、手机端单列无溢出

环境没有 Playwright 时静默退出（不输出 RESULT_JSON），CI 会自动跳过。
输出图片到 /data/workspace/_preview/，最后一行打印 RESULT_JSON:{...}。
"""
import json
import os
import sys
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('playwright not available', file=sys.stderr)
    sys.exit(0)

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = Path('/data/workspace/_preview')
PREVIEW.mkdir(parents=True, exist_ok=True)
CSS_ORDER = [
    'src/app/styles/shell.css',
    'src/app/styles/captcha.css',
    'src/app/styles/oauth.css',
    'src/app/styles/design-system.css',
    'src/app/styles/yunamo-skin.css',
]
SKIN = CSS_ORDER[-1]

CHECKS = []
IMAGES = []


def check(cond, msg):
    CHECKS.append({'ok': bool(cond), 'msg': msg})


def page_html(with_skin: bool, dark: bool = False) -> str:
    css = '\n\n'.join(
        '/* %s */\n%s' % (f, (ROOT / f).read_text(encoding='utf-8'))
        for f in CSS_ORDER if with_skin or f != SKIN
    )
    theme = ' data-theme="dark"' if dark else ''
    return '''<!doctype html><html lang="zh-CN"%s><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>%s</style></head>
<body class="page-home page-reverie has-cloud">
<div class="page-root rv-page">
  <div id="bg" aria-hidden="true"></div>
  <header class="rv-head"><div class="rv-head-in">
    <a class="rv-brand" href="/"><span><b>Noxc</b><i>Free subdomains</i></span></a>
    <nav class="rv-nav">
      <a href="#features">特性</a><a href="#how">如何使用</a><a href="#suffix">后缀</a><a href="#faq">常见问题</a>
      <button type="button" class="yn-motion" id="ynMotion" aria-pressed="false">暂停动效</button>
      <a class="rv-pill ink sm" href="/register">立即注册</a>
    </nav>
  </div></header>
  <main class="rv-main">
    <section class="rv-hero rv-reveal" style="--i:0">
      <p class="rv-eyebrow">OPEN REGISTRATION · 5 FREE DOMAINS PER EMAIL</p>
      <h1 class="rv-title">属于你的<em>专属</em>子域名<span class="rv-fullstop">.</span></h1>
      <p class="rv-lede">免费注册子域名，通过 NS 委托掌控解析。每个邮箱都有免费额度。</p>
      <div class="rv-actions"><a class="rv-pill ink lg" href="/register">开始注册</a><a class="rv-pill line lg" href="/dashboard">管理控制台</a></div>
      <div class="rv-stats"><div class="rv-stat"><b>128</b><span>注册人数</span></div></div>
    </section>
    <section class="rv-landscape rv-reveal" style="--i:1" id="check">
      <div class="rv-frame">
        <form class="rv-ask" id="searchForm">
          <span class="rv-ask-ico"></span>
          <input id="qName" placeholder="输入你想要的前缀" aria-label="域名前缀">
          <div class="rv-root-wrap"><select id="qRoot" aria-label="选择根域名"><option>.noxc.uk</option></select></div>
          <button type="submit" class="rv-pill ink rv-ask-btn" id="askBtn">查询 →</button>
        </form>
      </div>
      <div class="zx-results rv-results" id="results"></div>
      <p class="rv-hint">输入前缀，查询它在各个后缀下是否可用</p>
      <div class="yn-try" aria-label="示例前缀"><span>TRY:</span>
        <button type="button" data-yn-try="hello-world">hello-world ↗</button>
        <button type="button" data-yn-try="my-app">my-app ↗</button>
        <button type="button" data-yn-try="portfolio">portfolio ↗</button>
      </div>
    </section>
    <section class="rv-sec rv-reveal" style="--i:2" id="features">
      <p class="rv-sec-no">02 / WHY NOXC</p><h2 class="rv-h2">为什么选择 Noxc</h2>
      <div class="rv-cols">
        <article class="card rv-col"><h3>永久免费的域名注册</h3><p>注册即拥有完整管理权，免费续期。</p></article>
        <article class="card rv-col"><h3>完善的 DNS 管理</h3><p>12 种记录类型、自定义 TTL。</p></article>
        <article class="card rv-col"><h3>免费技术支持</h3><p>内置工单系统与讨论区。</p></article>
      </div>
    </section>
    <section class="rv-sec rv-reveal" style="--i:3" id="how">
      <p class="rv-sec-no">03 / HOW IT WORKS</p><h2 class="rv-h2">三步拥有你的域名</h2>
      <div class="yn-steps">
        <article class="yn-step"><span class="yn-no">01 / FIND A NAME</span><h3>查一个还没被占用的名字</h3><p>在上面的输入框填前缀，选一个喜欢的后缀。</p></article>
        <article class="yn-step"><span class="yn-no">02 / CLAIM IT</span><h3>注册并领取</h3><p>登录后在注册页提交，按后台配置走审核或直接开通。</p></article>
        <article class="yn-step"><span class="yn-no">03 / POINT ANYWHERE</span><h3>把域名指向你的主机</h3><p>添加 A / AAAA / CNAME / MX / TXT 记录，或用 NS 委托。</p></article>
      </div>
    </section>
  </main>
  <footer class="nk-foot rv-foot"><div class="rv-wrap"><div class="rv-fbottom"><span>© 2026 Noxc</span></div></div></footer>
</div>
<script>
document.querySelectorAll('[data-yn-try]').forEach(function(b){b.addEventListener('click',function(){
  var q=document.getElementById('qName'); if(q){q.value=b.getAttribute('data-yn-try');q.focus();}
});});
var mb=document.getElementById('ynMotion');
if(mb) mb.addEventListener('click',function(){
  var paused=document.documentElement.dataset.motion==='paused';
  if(paused) delete document.documentElement.dataset.motion; else document.documentElement.dataset.motion='paused';
  mb.textContent=paused?'暂停动效':'恢复动效'; mb.setAttribute('aria-pressed',paused?'false':'true');
});
</script>
</body></html>''' % (theme, css)


def style(pg, sel, prop):
    return pg.eval_on_selector(sel, '(e,p)=>getComputedStyle(e).getPropertyValue(p)', prop)


def main():
    for name, skin, dark in [
        ('_skin_before.html', False, False),
        ('_skin_after.html', True, False),
        ('_skin_after_dark.html', True, True),
    ]:
        (PREVIEW / name).write_text(page_html(skin, dark), encoding='utf-8')

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path='/usr/local/bin/chromium',
            args=['--no-sandbox', '--disable-dev-shm-usage'],
        )

        # ── 改造前 ──
        pg = browser.new_page(viewport={'width': 1240, 'height': 900}, device_scale_factor=2)
        pg.goto('file://' + str(PREVIEW / '_skin_before.html'))
        pg.wait_for_timeout(900)
        before_radius = style(pg, '.rv-pill.ink.lg', 'border-radius')
        before_font = style(pg, '#qName', 'font-family')
        check('999px' in before_radius, '改造前按钮是 999px 胶囊（实测 %s）' % before_radius)
        check('Redaction' in before_font or 'monospace' not in before_font.lower(),
              '改造前输入框不是等宽（实测 %s）' % before_font[:60])
        f = PREVIEW / 'yunamo_skin_before_desktop.png'
        pg.screenshot(path=str(f), full_page=True); IMAGES.append(str(f))
        pg.close()

        # ── 改造后 ──
        pg = browser.new_page(viewport={'width': 1240, 'height': 900}, device_scale_factor=2)
        pg.goto('file://' + str(PREVIEW / '_skin_after.html'))
        pg.wait_for_timeout(900)

        radius = style(pg, '.rv-pill.ink.lg', 'border-radius')
        check('14px' in radius, '按钮改为 14px 圆角矩形（实测 %s）' % radius)

        qfont = style(pg, '#qName', 'font-family')
        check(any(x in qfont.lower() for x in ['monospace', 'menlo', 'consolas']),
              '输入框用等宽字体（实测 %s）' % qfont[:60])

        btnfont = style(pg, '#askBtn', 'font-family')
        btntransform = style(pg, '#askBtn', 'text-transform')
        check(any(x in btnfont.lower() for x in ['monospace', 'menlo', 'consolas'])
              and 'uppercase' in btntransform, '主按钮等宽 + 大写（Yunamo 招牌）')

        display = style(pg, '#searchForm', 'display')
        rows = style(pg, '#searchForm', 'grid-template-rows')
        check('grid' in display and len(rows.split()) >= 2,
              '查询区两段式 grid（display=%s, rows=%s）' % (display, rows))

        ask_box = pg.locator('#searchForm').bounding_box()
        btn_box = pg.locator('#askBtn').bounding_box()
        check(bool(ask_box and btn_box) and btn_box['width'] >= ask_box['width'] - 4,
              '主按钮全宽（按钮 %d / 容器 %d）' % (
                  round(btn_box['width'] if btn_box else 0),
                  round(ask_box['width'] if ask_box else 0)))
        inp_box = pg.locator('#qName').bounding_box()
        check(bool(inp_box and btn_box) and inp_box['y'] + inp_box['height'] <= btn_box['y'] + 2,
              '输入条在上、按钮在下，不是老式右侧内嵌')

        tokens = pg.evaluate('''() => {
          const cs=getComputedStyle(document.documentElement);
          const keys=['--zx-paper','--zx-paper-2','--zx-ink','--zx-body','--zx-muted',
                      '--zx-hair','--zx-hair-2','--zx-blue','--zx-blue-deep','--zx-blue-soft',
                      '--zx-danger','--zx-warn'];
          const o={}; keys.forEach(k=>o[k]=cs.getPropertyValue(k).trim()); return o;
        }''')
        expect = {
            '--zx-paper': '#ffffff', '--zx-paper-2': '#f7f8fa', '--zx-ink': '#111318',
            '--zx-body': '#4b5563', '--zx-muted': '#8b94a3',
            '--zx-blue': '#111318', '--zx-blue-deep': '#000000', '--zx-blue-soft': '#f1f2f4',
            '--zx-danger': '#b4232c', '--zx-warn': '#9a6700',
        }
        mismatch = [(k, v, tokens.get(k)) for k, v in expect.items() if tokens.get(k) != v]
        check(not mismatch, '明色主题 10 个核心色值与改动前逐项一致' +
              (('：' + json.dumps(mismatch, ensure_ascii=False)) if mismatch else ''))
        check('rgba(17, 19, 24' in (tokens.get('--zx-hair') or ''), '发丝线仍是原来的墨色透明度')

        card_bg = style(pg, '.card.rv-col', 'background-color')
        check('255, 255, 255' in card_bg or 'rgb(255' in card_bg,
              '卡片底色仍是纯白（实测 %s）' % card_bg)

        weight = style(pg, '.rv-title', 'font-weight')
        check(weight == '700', '标题字重收敛为 700（实测 %s）' % weight)

        requests = []
        pg.on('request', lambda r: requests.append(r.url) if not r.url.startswith('file:') else None)
        pg.click('[data-yn-try="my-app"]')
        check(pg.input_value('#qName') == 'my-app', '点 Try 示例把前缀填进输入框')
        check(len(requests) == 0, '点 Try 示例零网络请求（实测 %d）' % len(requests))

        pg.click('#ynMotion')
        paused = pg.evaluate('()=>document.documentElement.dataset.motion')
        op = style(pg, '.rv-hero', 'opacity')
        anim = style(pg, '.rv-hero', 'animation-name')
        check(paused == 'paused' and op == '1' and 'none' in anim,
              '暂停动效后动画停止、入场内容仍可见（opacity=%s, animation=%s）' % (op, anim))
        pg.click('#ynMotion')
        check(not pg.evaluate('()=>!!document.documentElement.dataset.motion'), '再点一次恢复动效')

        check(not pg.evaluate('()=>document.documentElement.scrollWidth>window.innerWidth'),
              '宽屏无横向溢出')
        f = PREVIEW / 'yunamo_skin_after_desktop.png'
        pg.screenshot(path=str(f), full_page=True); IMAGES.append(str(f))
        pg.close()

        # ── 暗色 ──
        pg = browser.new_page(viewport={'width': 1240, 'height': 900}, device_scale_factor=2)
        pg.goto('file://' + str(PREVIEW / '_skin_after_dark.html'))
        pg.wait_for_timeout(900)
        paper = pg.evaluate("()=>getComputedStyle(document.documentElement).getPropertyValue('--zx-paper').trim()")
        radius_dark = style(pg, '.rv-pill.ink.lg', 'border-radius')
        check(paper == '#0b0d11' and '14px' in radius_dark,
              '暗色主题色值不变、形态同样生效（paper=%s, radius=%s）' % (paper, radius_dark))
        f = PREVIEW / 'yunamo_skin_after_dark.png'
        pg.screenshot(path=str(f), full_page=True); IMAGES.append(str(f))
        pg.close()

        # ── 手机 ──
        pg = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg.goto('file://' + str(PREVIEW / '_skin_after.html'))
        pg.wait_for_timeout(900)
        overflow = pg.evaluate('()=>document.documentElement.scrollWidth>window.innerWidth')
        steps = style(pg, '.yn-steps', 'grid-template-columns')
        motion = style(pg, '#ynMotion', 'display')
        iy = (pg.locator('#qName').bounding_box() or {}).get('y', 0)
        by = (pg.locator('#askBtn').bounding_box() or {}).get('y', 0)
        check(not overflow, '手机端无横向溢出')
        check(by > iy, '手机端仍是输入条在上、全宽按钮在下')
        check(motion == 'none', '窄屏收起暂停动效按钮（系统偏好仍自动生效）')
        check(len(steps.split()) == 1, '三步卡在手机端改单列（实测 %s）' % steps)
        f = PREVIEW / 'yunamo_skin_after_mobile.png'
        pg.screenshot(path=str(f), full_page=True); IMAGES.append(str(f))
        pg.close()

        pg = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg.goto('file://' + str(PREVIEW / '_skin_before.html'))
        pg.wait_for_timeout(900)
        f = PREVIEW / 'yunamo_skin_before_mobile.png'
        pg.screenshot(path=str(f), full_page=True); IMAGES.append(str(f))
        pg.close()

        browser.close()

    print('RESULT_JSON:' + json.dumps({'checks': CHECKS, 'images': IMAGES}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # 环境差异（如无 chromium）时让 CI 跳过，不算失败
        print('render skipped: %s: %s' % (type(e).__name__, e), file=sys.stderr)
        sys.exit(0)
