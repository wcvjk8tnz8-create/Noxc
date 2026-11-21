import { useEffect, useState } from 'react';
import { api, refreshRuntime, cleanupPage, readUserCache, authProbe } from '../lib/runtime';

/**
 * Showcase · 用户案例
 *
 * 对齐参考图（Leo Free Page）：独立顶栏、标题与一句副标题、
 * 三列圆角白卡片，每张卡有 emoji / 标题 / 站长 / 描述 / 域名链接。
 *
 * 隐私：只展示用户主动开启展示（showcase=1）且已开通的域名，
 * 接口不返回邮箱与 user_id；站长名优先取昵称，否则用邮箱前缀。
 * 默认不展示 —— 开关在「域名详情 → 用户案例展示」里。
 */

type Item = {
  fqdn: string;
  label: string;
  emoji: string;
  title: string;
  owner: string;
  desc: string;
};

export default function ShowcasePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(() => {
    const u = readUserCache();
    return !!(u && u.id);
  });

  useEffect(() => {
    document.body.className = 'page-home page-reverie has-cloud page-showcase';
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = true;
    let alive = true;
    authProbe().then((u) => { if (alive) setAuthed(!!(u && u.id)); });
    api.get('/api/showcase')
      .then((d: any) => { if (alive) { setItems(d?.items || []); setLoading(false); } })
      .catch(() => { if (alive) { setItems([]); setLoading(false); } });
    // 品牌 / 备案 / 联系方式 / 语言等全站运行时注入（与首页同一套）
    try { refreshRuntime(); } catch { /* 注入失败不影响公开页 */ }
    return () => { alive = false; cleanupPage(); };
  }, []);

  return (
    <div className="page-root rv-page showcase-page">
      <div id="bg" aria-hidden="true"></div>

      <header className="rv-head">
        <div className="rv-head-in">
          <a className="rv-brand" href="/">
            <img data-logo-img src="/img/logo.jpg" alt="" />
            <span><b data-site-name>Noxc</b><i>Free subdomains</i></span>
          </a>
          <nav className="rv-nav" aria-label="主导航">
            <a href="/">首页</a>
            <a href="/showcase">用户案例</a>
            <a href="/docs">服务文档</a>
            {authed
              ? <a className="rv-pill line sm" href="/dashboard">→ 去往控制台</a>
              : <a className="rv-pill line sm" href="/login">登录</a>}
            <a className="rv-pill ink sm" href="/register">注册</a>
          </nav>
          {authed
            ? <a className="rv-pill ink sm rv-mobile-cta" href="/dashboard">→ 控制台</a>
            : <a className="rv-pill ink sm rv-mobile-cta" href="/register">注册</a>}
        </div>
      </header>

      <main className="rv-main showcase-main">
        <section className="showcase-head rv-reveal">
          <p className="rv-eyebrow">COMMUNITY <span>·</span> MADE WITH NOXC</p>
          <h1 className="rv-title">用户案例</h1>
          <p className="rv-lede">由用户自愿展示的主页，点击卡片即可访问</p>
          <p className="showcase-note">所有域名预设都不展示，只有你主动开启才会出现在这里。</p>
          <p className="showcase-note"><a href="/dashboard">去域名管理开启展示 →</a></p>
        </section>

        {loading && <div className="showcase-empty">加载中…</div>}
        {!loading && items.length === 0 && (
          <div className="showcase-empty">
            <p>还没有用户开启展示。</p>
            <p>在自己的域名详情里打开「用户案例展示」，它就会出现在这里。</p>
          </div>
        )}
        {!loading && items.length > 0 && (
          <div className="showcase-grid" id="showcaseGrid">
            {items.map((it) => (
              <a key={it.fqdn} className="showcase-card"
                 href={`https://${it.fqdn}`} target="_blank" rel="noopener noreferrer">
                <span className="showcase-emoji" aria-hidden="true">{it.emoji || it.fqdn.slice(0, 1).toUpperCase()}</span>
                <h3 className="showcase-title">{it.title}</h3>
                <p className="showcase-owner">站长：{it.owner}</p>
                <p className="showcase-desc">{it.desc || '——'}</p>
                <span className="showcase-fqdn">{it.fqdn} ↗</span>
              </a>
            ))}
          </div>
        )}
      </main>

      <footer className="nk-foot rv-foot">
        <div className="rv-wrap">
          <div className="rv-fbottom showcase-fbottom">
            <span>© <span id="yr">2026</span> <b data-site-name>Noxc</b> · <a href="/">首页</a></span>
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
