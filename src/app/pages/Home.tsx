import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { mountHome } from '../legacy/home';
import { refreshRuntime, cleanupPage, readUserCache, authProbe } from '../lib/runtime';
import { ICON_PATHS, type IconName } from '../lib/icons';
import { currentLang } from '../lib/i18n';

/**
 * Home · Noxc「Node」设计系统（由主 logo 反推）
 *
 *  · 冷白底 + 墨黑几何无衬线 + 一颗 Noxc 蓝点作唯一强调
 *  · 单列居中、发丝细线、大量留白，不做卡片阴影堆叠
 *  · 墨黑圆头胶囊按钮，圆点徽记与圆头粗线呼应 logo 的节点连线
 *  · 节点面板里放淡化的去字 N 图形，查询框浮在面板之上
 *
 * 仍保留浮岛骨架与「壁纸满铺整页」：#bg 铺满但退成极淡冷调底纹，
 * 主视觉由节点图形、点阵与留白承担。
 *
 * 注意：所有 id / data-* 都是 legacy 控制器与品牌注入的契约，不能改：
 *   searchForm qName qRoot results suffixGrid rtTags rtMore apiHost yr toast
 *   data-logo-img data-site-name data-icp-slot
 */
function Ico({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`td-ico ${className}`} viewBox="0 0 24 24" width={size} height={size}
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export default function HomePage() {
  const ref = useRef<HTMLDivElement>(null);
  /* 顶栏入口按登录态切换：命中缓存时首帧就是「去往控制台」，
     再用共享探测校正一次，避免会话已过期却误显示。 */
  const [authed, setAuthed] = useState(() => {
    const u = readUserCache();
    return !!(u && u.id);
  });
  useEffect(() => {
    document.body.className = 'page-home page-reverie has-cloud';
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = true;
    let alive = true;

    /* Yunamo 式可访问性：「暂停动效」开关，选择记在 localStorage，零接口请求。
       系统设置了 prefers-reduced-motion 时由 CSS 自动降级，这里只管手动开关。 */
    const MOTION_KEY = 'noxc-motion-paused';
    const syncMotion = () => {
      const paused = document.documentElement.dataset.motion === 'paused';
      const btn = document.getElementById('ynMotion');
      if (btn) {
        const zh = paused ? '恢复动效' : '暂停动效';
        const en = paused ? 'Resume motion' : 'Pause motion';
        btn.textContent = currentLang() === 'en' ? en : zh;
        btn.setAttribute('data-en', en);
        btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      }
    };
    try { if (localStorage.getItem(MOTION_KEY) === '1') document.documentElement.dataset.motion = 'paused'; } catch { /* 隐私模式 */ }
    syncMotion();
    const onMotion = () => {
      const paused = document.documentElement.dataset.motion === 'paused';
      if (paused) delete document.documentElement.dataset.motion;
      else document.documentElement.dataset.motion = 'paused';
      try { localStorage.setItem(MOTION_KEY, paused ? '0' : '1'); } catch { /* 忽略 */ }
      syncMotion();
    };
    const motionBtn = document.getElementById('ynMotion');
    motionBtn?.addEventListener('click', onMotion);

    /* Try 示例：只把前缀填进输入框并聚焦，不发任何查询请求（省 D1 读取） */
    const onTry = (e: Event) => {
      const v = (e.currentTarget as HTMLElement)?.getAttribute('data-yn-try') || '';
      const q = document.getElementById('qName') as HTMLInputElement | null;
      if (q) { q.value = v; q.focus(); }
    };
    const tryBtns = Array.from(ref.current?.querySelectorAll('[data-yn-try]') || []);
    tryBtns.forEach((b) => b.addEventListener('click', onTry));

    authProbe().then((u) => { if (alive) setAuthed(!!(u && u.id)); });
    (async () => {
      try { await mountHome(ref.current); } catch (e) { console.error('[home] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => {
      alive = false; cleanupPage();
      motionBtn?.removeEventListener('click', onMotion);
      tryBtns.forEach((b) => b.removeEventListener('click', onTry));
    };
  }, []);

  return (
    <div className="page-root rv-page" ref={ref}>
      <div id="bg" aria-hidden="true"></div>

      {/* ══ Editorial 顶栏：品牌 / 细线导航 / 药丸 ══ */}
      <header className="rv-head">
        <div className="rv-head-in">
          <a className="rv-brand" href="/">
            <img data-logo-img src="/img/logo.jpg" alt="" />
            <span><b data-site-name>Noxc</b><i>Free subdomains</i></span>
          </a>
          <nav className="rv-nav" aria-label="主导航">
            <a href="#features">特性</a>
            <a href="#how" data-en="How it works">如何使用</a>
            <a href="#suffix">后缀</a>
            <a href="#faq">常见问题</a>
            <button type="button" className="yn-motion" id="ynMotion" aria-pressed="false" data-en="Pause motion">暂停动效</button>
            {authed
              ? <a className="rv-pill line sm rv-login" href="/dashboard">→ 去往控制台</a>
              : <a className="rv-pill line sm rv-login" href="/login">登录</a>}
            <a className="rv-pill ink sm zx-nav-cta" href="/register">立即注册 <Ico name="arrowUp" size={14} /></a>
          </nav>
          {authed
            ? <a className="rv-pill ink sm rv-mobile-cta zx-nav-cta" href="/dashboard">→ 控制台</a>
            : <a className="rv-pill ink sm rv-mobile-cta zx-nav-cta" href="/register">注册 <Ico name="arrowUp" size={14} /></a>}
        </div>
      </header>

      <main className="rv-main">
        {/* ══ Hero：超大无衬线黑体，强调只灰一档（Zerexa Domains 实拍口径） ══ */}
        <section className="rv-hero rv-reveal" style={{ '--i': 0 } as CSSProperties}>
          <p className="rv-eyebrow">OPEN REGISTRATION <span>·</span> <span data-default-quota data-no-i18n>5</span> FREE DOMAINS PER EMAIL</p>
          <h1 className="rv-title" data-en="Your own subdomain.">属于你的<em>专属</em>子域名<span className="rv-fullstop">.</span></h1>
          <p className="rv-lede">免费注册子域名，通过 NS 委托掌控解析。每个邮箱都有免费额度，超出后可随时在控制台购买额外配额。</p>
          <div className="rv-actions">
            <a className="rv-pill ink lg" href="/register">开始注册 <Ico name="arrow" size={17} /></a>
            <a className="rv-pill line lg" href="/dashboard">管理控制台 <Ico name="arrowUp" size={15} /></a>
          </div>
          {/* 站点公开数据：随 /api/config 一次返回，首屏同一帧填好。
              「已开通域名」可展开看每个根域名分别有多少，最热的那个标 HOT。 */}
          <div className="rv-stats" id="siteStats" aria-label="站点数据">
            <div className="rv-stat"><b data-stat-users>—</b><span>注册人数</span></div>
            <i className="rv-stat-rule" aria-hidden="true"></i>
            <button
              type="button"
              className="rv-stat rv-stat-toggle"
              id="statDomainsToggle"
              aria-expanded="false"
              aria-controls="statBreakdown"
            >
              <b data-stat-domains>—</b>
              <span>已开通域名<i className="rv-stat-caret" aria-hidden="true"></i></span>
            </button>
          </div>
          {/* 最热后缀：不用展开也能在首页看到 HOT */}
          <div className="rv-hottest" id="statHottest" hidden></div>
          <div className="rv-breakdown" id="statBreakdown" hidden>
            <div className="rv-bd-head">
              <span data-en="SUFFIX">后缀</span>
              <span data-en="DOMAINS">域名数</span>
              <span data-en="USERS">注册人数</span>
            </div>
            <div id="statBreakdownRows"></div>
          </div>
          <p className="rv-hero-foot">Kept open all day by small studios and long-form writers</p>
        </section>

        {/* ══ 节点面板：输入框浮在淡化的 N 图形与点阵之上 ══ */}
        <section className="rv-landscape rv-reveal" style={{ '--i': 1 } as CSSProperties} id="check">
          <div className="rv-frame">
            <div className="rv-art" aria-hidden="true"></div>
            <div className="rv-art-veil" aria-hidden="true"></div>
            <span className="rv-art-cap">NODES · NOXC</span>
            <form className="rv-ask" id="searchForm">
              <Ico name="search" size={19} className="rv-ask-ico" />
              <input id="qName" placeholder="输入你想要的前缀" autoComplete="off" spellCheck={false} aria-label="域名前缀" />
              <div className="rv-root-wrap" data-no-i18n>
                <select id="qRoot" aria-label="选择根域名"></select>
                <Ico name="chevron" size={16} />
              </div>
              <button type="submit" className="rv-pill ink rv-ask-btn">查询 <Ico name="arrow" size={15} /></button>
            </form>
          </div>
          <div className="zx-results rv-results" id="results"></div>
          <p className="rv-hint"><Ico name="info" size={15} /> 输入前缀，查询它在各个后缀下是否可用</p>
          <div className="yn-try" aria-label="Example prefixes">
            <span>TRY:</span>
            <button type="button" data-yn-try="hello-world">hello-world ↗</button>
            <button type="button" data-yn-try="my-app">my-app ↗</button>
            <button type="button" data-yn-try="portfolio">portfolio ↗</button>
          </div>
        </section>

        {/* ══ 四张特性卡：对齐 Zerexa Domains 实拍的第二屏 ══ */}
        <section className="zx-facts rv-reveal" style={{ '--i': 1 } as CSSProperties} aria-label="服务概览">
          <div className="zx-fact"><span className="zx-fact-k">免费额度</span><span className="zx-fact-v"><span data-default-quota data-no-i18n>5</span> 个 / 邮箱</span></div>
          <div className="zx-fact"><span className="zx-fact-k">开通时效</span><span className="zx-fact-v">30 秒</span></div>
          <div className="zx-fact"><span className="zx-fact-k">解析方式</span><span className="zx-fact-v">NS 委托</span></div>
          <div className="zx-fact"><span className="zx-fact-k">有效期</span><span className="zx-fact-v" id="factValidDays">—</span></div>
        </section>

        {/* ══ 01 可选后缀 ══ */}
        <section className="rv-sec rv-reveal" style={{ '--i': 2 } as CSSProperties} id="suffix">
          <p className="rv-sec-no">01 <span>/</span> SUFFIXES</p>
          <h2 className="rv-h2">可选后缀</h2>
          <p className="rv-sec-lede" data-en="Start with noxc.uk — pick a prefix you like, then pick an ending.">首推 <b>noxc.uk</b>，挑一个顺口的前缀，再挑一个喜欢的结尾。</p>
          <div className="nk-suffix rv-suffix" id="suffixGrid">
            <div className="nk-sk">加载中…</div>
          </div>
        </section>

        {/* ══ 02 特性：发丝线、零阴影 ══ */}
        <section className="rv-sec rv-reveal" style={{ '--i': 3 } as CSSProperties} id="features">
          <p className="rv-sec-no">02 <span>/</span> WHY NOXC</p>
          <h2 className="rv-h2">为什么选择 Noxc</h2>
          <p className="rv-sec-lede">免费额度、自动配置、NS 委托和独立控制台，适合个人站点、Demo 和轻量服务。</p>
          <div className="rv-cols">
            <article className="card rv-col">
              <span className="rv-col-ico"><Ico name="globe" size={22} /></span>
              <h3>永久免费的域名注册</h3>
              <p>注册即拥有完整管理权，免费续期，无需任何费用与信用卡。</p>
            </article>
            <article className="card rv-col">
              <span className="rv-col-ico"><Ico name="layers" size={22} /></span>
              <h3>完善的 DNS 管理</h3>
              <p>12 种记录类型、自定义 TTL、Cloudflare 代理、根域名验证一应俱全。</p>
            </article>
            <article className="card rv-col">
              <span className="rv-col-ico"><Ico name="chat" size={22} /></span>
              <h3>免费技术支持</h3>
              <p>内置工单系统与讨论区，遇到问题可随时提交，社区与管理员共同协助。</p>
            </article>
          </div>
          <div className="rv-rule-row">
            <span>免费 DNS</span><span>专业级权威解析</span><span>12+ 记录类型</span>
            <span>根域名验证</span><span>域名托管委派</span><span>DNSSEC 就绪</span>
          </div>
        </section>

        {/* ══ 03 使用流程：Yunamo 的 How it works 三步 ══ */}
        <section className="rv-sec rv-reveal" style={{ '--i': 4 } as CSSProperties} id="how">
          <p className="rv-sec-no">03 <span>/</span> HOW IT WORKS</p>
          <h2 className="rv-h2" data-en="Three steps to your domain">三步拥有你的域名</h2>
          <p className="rv-sec-lede" data-en="From picking a name to live DNS, all in your browser. No credit card needed.">从挑名字到解析生效，全程在浏览器里完成，不需要信用卡。</p>
          <div className="yn-steps">
            <article className="yn-step">
              <span className="yn-no">01 / FIND A NAME</span>
              <h3 data-en="Find a name that is still free">查一个还没被占用的名字</h3>
              <p data-en="Enter a prefix above, pick a suffix, then hit Check availability. 3 to 63 characters: letters, digits and hyphens.">在上面的输入框填前缀，选一个喜欢的后缀，点「查询」看是否可用。3 到 63 个字符，字母、数字与连字符都行。</p>
            </article>
            <article className="yn-step">
              <span className="yn-no">02 / CLAIM IT</span>
              <h3 data-en="Register and claim it">注册并领取</h3>
              <p data-en="Sign in and submit the name on the registration page. Approval follows the site settings. Every email has a free quota you can check in the console.">登录后在注册页提交，按后台配置走审核或直接开通。每个邮箱都有免费额度，可在控制台查看。</p>
            </article>
            <article className="yn-step">
              <span className="yn-no">03 / POINT ANYWHERE</span>
              <h3 data-en="Point the name at your host">把域名指向你的主机</h3>
              <p data-en="Add A, AAAA, CNAME, MX or TXT records on the domain page, or delegate the zone to your own DNS provider with NS records.">在域名详情页添加 A / AAAA / CNAME / MX / TXT 等记录，或用 NS 委托交给自己的 DNS 服务商。</p>
            </article>
          </div>
        </section>

        {/* ══ 引用 ══ */}
        <blockquote className="rv-quote rv-reveal" style={{ '--i': 5 } as CSSProperties}>
          <p>「感觉不像在操作一套软件，更像把一件小事托付出去，然后它就安静地办好了。」</p>
          <cite>— Noxc, on keeping things quiet</cite>
        </blockquote>

        {/* ══ 03 工具 ══ */}
        <section className="rv-sec rv-reveal" style={{ '--i': 6 } as CSSProperties} id="faq">
          <p className="rv-sec-no">04 <span>/</span> TOOLS</p>
          <h2 className="rv-h2">Whois 查询 &amp; <em>DNS 工具</em></h2>
          <p className="rv-sec-lede">公开查询接口，无需登录即可调用</p>
          <div className="rv-tools">
            <div className="rv-term">
              <div className="rv-term-bar"><i></i><i></i><i></i><span>bash</span></div>
              <pre className="rv-term-body"><code><span className="c-dim" data-en="# Check subdomain status (public API)"># 查询子域名状态（公开接口）</span>
<span className="c-cmd">curl</span> <span className="c-str">"<span id="apiHost">https://meoy.top</span>/api/whois?name=mail"</span>

<span className="c-dim" data-en="# Example response"># 返回示例</span>
<span className="c-punc">{'{'}</span>
  <span className="c-key">"success"</span>: <span className="c-num">true</span>,
  <span className="c-key">"state"</span>: <span className="c-str">"registered"</span>,
  <span className="c-key">"fqdn"</span>: <span className="c-str">"mail.meoy.top"</span>,
  <span className="c-key">"recordCount"</span>: <span className="c-num">4</span>
<span className="c-punc">{'}'}</span></code></pre>
            </div>
            <div className="rv-tool-list">
              <div className="card rv-col"><h3>Web 查询页</h3><p>访问 <a href="/whois">WHOIS 查询</a>，支持查询本站子域名，以及 DNSHE / 任意外部域名。</p></div>
              <div className="card rv-col"><h3>Whois LookUP</h3><p>自动识别输入归属：本站走 D1 实时状态，外部域名走 DNSHE 公开 WHOIS 或 RDAP。</p></div>
              <div className="card rv-col"><h3>DNS 工具</h3><p>在域名详情页自助添加 A / AAAA / CNAME / MX / TXT 等记录，并支持平台验证一键写入。</p></div>
            </div>
          </div>
          <div className="nk-tags rv-tags" id="rtTags"></div>
          <div className="nk-more rv-more"><button className="rv-pill line sm" id="rtMore">更多… <Ico name="chevron" size={14} /></button></div>
        </section>

        {/* ══ 片尾 ══ */}
        <section className="rv-cta rv-reveal" style={{ '--i': 7 } as CSSProperties}>
          <h2>Begin with <em>one good question.</em></h2>
          <p>先挑一个喜欢的前缀，剩下的交给我们。</p>
          <a className="rv-pill ink lg" href="/register">立即注册 <Ico name="arrow" size={17} /></a>
        </section>
      </main>

      {/* ══ 页脚：细线 + 备案插槽 ══ */}
      <footer className="nk-foot rv-foot">
        <div className="rv-wrap">
          <div className="rv-foot-in">
            <div className="rv-fcol">
              <div className="rv-fbrand"><img data-logo-img src="/img/logo.jpg" alt="" /><span data-site-name>Noxc</span></div>
              <p className="rv-fdesc">免费、开源的二级域名分发与 DNS 管理系统。<br />基于 Cloudflare Workers + D1。</p>
            </div>
            <div className="rv-fcol"><h4>服务</h4><a href="/whois">WHOIS 查询</a><a href="/dashboard">域名管理</a><a href="/showcase">用户案例</a><a href="/docs">服务文档</a><a href="/terms">服务条款</a><a href="/report">举报滥用</a></div>
            <div className="rv-fcol"><h4>开源</h4><a href="https://github.com/wcvjk8tnz8-create/MeoyDomain" target="_blank" rel="noopener noreferrer">GitHub <Ico name="external" size={13} /></a><a href="https://github.com/wcvjk8tnz8-create/MeoyDomain/issues" target="_blank" rel="noopener noreferrer">问题反馈 <Ico name="external" size={13} /></a><span className="rv-fdim">MIT License</span></div>
          </div>
          <div className="rv-fbottom">
            <span>© <span id="yr">2026</span> <b>Noxc</b> · 二级域名分发</span>
            <a href="https://github.com/wcvjk8tnz8-create/MeoyDomain" target="_blank" rel="noopener noreferrer">GitHub</a>
            <span className="nk-ficp" data-icp-slot></span>
            <span className="nk-fcontact" data-contact-slot></span>
          </div>
        </div>
      </footer>

      <div id="toast"></div>
    </div>
  );
}
