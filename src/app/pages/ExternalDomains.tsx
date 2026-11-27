import { useEffect, useState, type FormEvent } from 'react';
import { api, refreshRuntime, cleanupPage, mountShell, authProbe, readUserCache } from '../lib/runtime';

/**
 * 第三方域名接入 · 独立页面 + 可复用卡片
 *
 *   · ExternalDomainsCard  —— 控制台「注册域名」卡片下面继续保留（用户早期要求）
 *   · ExternalDomainsPage  —— 独立直达页 /external-domains，结构与 VitePress
 *     文档一致：本页目录 + 分节说明 + 交互区 + 常见问题；可直接打开 / 刷新 /
 *     从外链跳入，不依赖控制台。
 *
 * 流程（站长定版）：gTLD 二级域 → 注册商 NS 指向 SEUS → SEUS API 连接 →
 * 站长在「站点设置 → 第三方域名接入」批准 → 根域名锁死 seus 后端。
 * 固定 SEUS DNS，不提供供应商选择；令牌绝不落在前端。
 */

type ExternalItem = {
  id: number; fqdn: string; status: string; statusLabel: string;
  ns: string[]; zoneId: string; connected: boolean; connectedAt: number | null;
  nsDelegated: boolean; apiSource: string; reviewNote: string;
  createdAt: number; note: string;
};

export function ExternalDomainsCard() {
  const externalLabel = '（外部域名）';
  const [items, setItems] = useState<ExternalItem[]>([]);
  const [policy, setPolicy] = useState<any>({ ns: ['a.ns.fs5.net', 'b.ns.fs5.net'], flow: '', max: 5, siteTokenReady: false });
  const [domain, setDomain] = useState('');
  const [note, setNote] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      const d = await api.get('/api/external-domains');
      setItems(d.items || []);
      setPolicy({
        ns: d.ns || ['a.ns.fs5.net', 'b.ns.fs5.net'],
        flow: d.flow || '', max: d.max || 5,
        siteTokenReady: !!d.siteTokenReady,
        providerLabel: d.providerLabel || 'SEUS DNS',
      });
    } catch (e: any) { setMsg({ text: e?.message || '载入失败', err: true }); }
    finally { setLoaded(true); }
  };
  useEffect(() => { void load(); }, []);

  const act = async (fn: () => Promise<any>, okText: string): Promise<boolean> => {
    setBusy(true); setMsg(null);
    try {
      const d = await fn();
      setMsg({ text: d?.next || d?.detail || okText, err: false });
      await load();
      return true;
    } catch (e: any) {
      setMsg({ text: e?.message || '操作失败', err: true });
      return false;
    } finally { setBusy(false); }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) { setMsg({ text: '请填写域名', err: true }); return; }
    void act(() => api.post('/api/external-domains', { domain: domain.trim(), note: note.trim() }), '申请已提交')
      .then((done) => { if (done) { setDomain(''); setNote(''); } });
  };

  return (
    <div className="card" id="externalCard">
      <div className="head-row">
        <h3 data-en="Third-party domain access">第三方域名接入</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="badge inf" data-en="SEUS DNS only">固定 SEUS DNS</span>
          <a className="btn sm ghost" href="/external-domains" data-en="Open standalone page">打开独立页面 →</a>
        </div>
      </div>
      <p className="hint" data-en="Bring your own full domain (gTLD only, e.g. xxx.com). Subdomains such as xxx.example.com are not accepted. Marked as (External domain).">
        接入你自己拥有的完整域名（只允许 gTLD，如 <b>xxx.com</b>；<b>xxx.example.com</b> 这类子域名不受理），统一标注「{externalLabel}」。
      </p>

      <div className="alert a-info" style={{ marginTop: '10px', whiteSpace: 'pre-line', lineHeight: 1.8 }}
        data-en="1) Enter your own full gTLD domain (e.g. xxx.com). Subdomains such as xxx.example.com are not accepted. 2) Point the registrar NS to the two SEUS DNS servers below and complete DNS hosting at s.eus. 3) Click Connect via API; the site uses its SEUS MCP token to find the hosted zone. 4) Wait for the site owner to approve in Site Settings.">
        {policy.flow || '① 填写你自己的完整域名（只允许 gTLD 二级域）\n② 注册商 NS 改为下方两台，并在 s.eus 完成 DNS 托管\n③ 点「用 API 连接」\n④ 等待站长在站点设置里批准'}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        <b>SEUS DNS 权威服务器：</b><span className="mono">{policy.ns?.join(' / ')}</span>
        <br /><span data-en="Records will not resolve globally until the registrar NS is pointed to SEUS DNS.">
          NS 未生效前，即使批准，写入的记录也不会被全球 DNS 查询。</span>
        {!policy.siteTokenReady && <><br /><b data-en="No site-wide SEUS MCP token configured yet. Leaving it blank is fine too: you may temporarily paste your own mbt_ token for this one connection.">站长还没在站点设置填 SEUS MCP Token（留空也能用）；连接时可临时填你自己的 mbt_ Token，仅本次使用、不会保存。</b></>}
      </div>

      <form onSubmit={submit} style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 220px', minWidth: 0 }}>
          <label data-en="Your domain">你的域名</label>
          <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)}
            placeholder="xxx.com" autoComplete="off" spellCheck={false}
            aria-label="第三方域名" />
        </div>
        <div className="field" style={{ flex: '1 1 180px', minWidth: 0 }}>
          <label data-en="Note (optional)">备注（选填）</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="用途说明" autoComplete="off" maxLength={160} />
        </div>
        <button className="btn primary" type="submit" disabled={busy} data-en="Submit for approval">提交申请</button>
      </form>

      {!policy.siteTokenReady && (
        <div className="field" style={{ marginTop: 10 }}>
          <label data-en="Your SEUS MCP token (optional, used once, never stored)">你的 SEUS MCP Token（选填，仅本次连接用、不保存）</label>
          <input className="input" type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)}
            placeholder="mbt_..." autoComplete="off" />
        </div>
      )}

      {msg && <div className={msg.err ? 'alert a-warn' : 'alert a-info'} style={{ marginTop: 10 }}>{msg.text}</div>}

      <div style={{ marginTop: 14 }}>
        <b style={{ fontSize: 13 }} data-en="My applications">我的申请</b>
        <span className="dim" style={{ fontSize: 12, marginLeft: 8 }}>{loaded ? `${items.length} / ${policy.max || 5}` : '载入中…'}</span>
        {loaded && items.length === 0 && <div className="hint" style={{ marginTop: 6 }} data-en="No applications yet">还没有申请，填上方域名开始接入。</div>}
        {items.map((it) => (
          <div key={it.id} className="card" style={{ marginTop: 8, padding: 12 }}>
            <div className="head-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <b className="mono">{it.fqdn}</b>
              <span className={it.status === 'approved' ? 'badge ok' : (it.status === 'rejected' ? 'badge warn' : 'badge')}>{it.statusLabel}</span>
              {it.connected && <span className="badge inf" data-en="SEUS connected">SEUS 已连接{it.zoneId ? ` · #${it.zoneId}` : ''}</span>}
              {it.nsDelegated && <span className="badge ok" data-en="NS live">NS 已生效</span>}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              NS：<span className="mono">{it.ns?.join(' / ')}</span>
              {it.apiSource === 'user' && <span data-en=" · this connection used your temporary token"> · 本次连接用的是你临时填的 Token</span>}
              {it.reviewNote && <span data-en=" · owner note"> · 站长备注：{it.reviewNote}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {it.status === 'pending' && (
                <button className="btn sm" disabled={busy}
                  onClick={() => void act(() => api.post(`/api/external-domains/${it.id}/connect`, apiToken ? { apiToken } : {}), '连接成功')}
                  data-en="Connect via API">用 API 连接</button>
              )}
              {it.status === 'pending' && (
                <button className="btn sm ghost" disabled={busy}
                  onClick={() => void act(() => api.post(`/api/external-domains/${it.id}/check-ns`, {}), '已重新检查 NS')}
                  data-en="Recheck NS">重新检查 NS</button>
              )}
              {it.status !== 'approved' && (
                <button className="btn sm ghost" disabled={busy}
                  onClick={() => void act(() => api.del(`/api/external-domains/${it.id}`), '已撤回申请')}
                  data-en="Withdraw">撤回申请</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 独立页：文档式章节 + 本页目录 + 交互区，未登录也能读说明 */
export default function ExternalDomainsPage() {
  const [authed, setAuthed] = useState(() => !!(readUserCache() && readUserCache().id));

  useEffect(() => {
    document.body.className = '';
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = true;
    let alive = true;
    (async () => {
      try { await mountShell('external-domains', { optional: true }); } catch { /* 公开页容错 */ }
      authProbe().then((u) => { if (alive) setAuthed(!!(u && u.id)); });
      if (alive) refreshRuntime();
    })();
    return () => { alive = false; cleanupPage(); };
  }, []);

  return (
    <div className="page-root" data-ready="0">
      <style>{`
        .ed-layout { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 18px; align-items: start; }
        .ed-toc { position: sticky; top: 74px; padding: 14px; }
        .ed-toc a { display: block; padding: 6px 8px; border-radius: 10px; font-size: 12.5px; color: var(--zx-ink, #1b1b1b); text-decoration: none; }
        .ed-toc a:hover { background: var(--zx-soft, #f3f3f3); }
        .ed-sec { scroll-margin-top: 84px; margin-bottom: 16px; padding: 18px 20px; }
        .ed-sec h2 { font-size: 17px; margin: 0 0 10px; }
        .ed-sec p, .ed-sec li { font-size: 13px; line-height: 1.9; }
        .ed-steps { counter-reset: edstep; list-style: none; padding: 0; margin: 0; }
        .ed-steps li { position: relative; padding: 10px 0 10px 38px; border-bottom: 1px solid var(--zx-hair, #e6e6e6); }
        .ed-steps li:last-child { border-bottom: 0; }
        .ed-steps li::before { counter-increment: edstep; content: counter(edstep); position: absolute; left: 0; top: 10px; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; background: var(--zx-ink, #1b1b1b); color: var(--zx-paper, #fff); }
        @media (max-width: 860px) { .ed-layout { grid-template-columns: minmax(0, 1fr); } .ed-toc { position: static; } }
      `}</style>
      <div id="bg"></div>
      <header className="topbar" id="topbar"></header>
      <aside className="sidebar" id="sidebar"></aside>

      <main className="main"><div className="main-in"><div className="wrap" style={{ maxWidth: 1000 }}>
        <div className="page-head">
          <h1 className="page-title" data-en="Third-party domain access">第三方域名接入</h1>
          <p className="page-sub" data-en="Bring your own domain, point it to SEUS DNS, connect via API, and wait for approval.">带上你自己的域名 · 固定 SEUS DNS · API 连接 · 等待站长批准</p>
        </div>

        <div className="ed-layout">
          <nav className="card ed-toc" aria-label="本页目录">
            <b style={{ fontSize: 12.5 }} data-en="On this page">本页目录</b>
            <div style={{ marginTop: 8 }}>
              <a href="#ed-overview" data-en="Overview">概览</a>
              <a href="#ed-rules" data-en="Eligibility">准入规则</a>
              <a href="#ed-steps" data-en="Step by step">接入流程</a>
              <a href="#ed-apply" data-en="Apply & status">申请与状态</a>
              <a href="#ed-faq" data-en="FAQ">常见问题</a>
            </div>
            <div className="hint" style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.7 }}>
              <a href="/docs/external-domains.html" data-en="Full documentation">完整服务文档 →</a>
            </div>
          </nav>

          <div style={{ minWidth: 0 }}>
            <section className="card ed-sec" id="ed-overview">
              <h2 data-en="Overview">概览</h2>
              <p data-en="Third-party domain access lets you bring a domain you own into Noxc. It is listed as (External domain) in the domain list and WHOIS, does not consume your registration quota, and is not counted in public statistics.">
                第三方域名接入允许把你拥有的域名接入本站。列表与 WHOIS 结果统一标注「（外部域名）」，不占注册配额、不计入公开统计。
              </p>
              <p className="hint" data-en="DNS is fixed to SEUS DNS (a.ns.fs5.net / b.ns.fs5.net). There is no provider picker, and after approval the root is locked to the seus backend; its DNS dropdown in Root domain management is disabled.">
                DNS <b>固定使用 SEUS DNS</b>（<span className="mono">a.ns.fs5.net / b.ns.fs5.net</span>）：接入表单没有供应商选择；站长批准后该根域名的 DNS 后端锁死 <span className="mono">seus</span>，「根域名管理」里那一行不能切换。
              </p>
            </section>

            <section className="card ed-sec" id="ed-rules">
              <h2 data-en="Eligibility">准入规则</h2>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                <li data-en="Only gTLD second-level domains such as xxx.com / xxx.xyz / xxx.top.">只受理 <b>gTLD 二级域</b>，如 <span className="mono">xxx.com</span> / <span className="mono">xxx.xyz</span> / <span className="mono">xxx.top</span>。</li>
                <li data-en="Subdomains such as xxx.example.com are not accepted. Document example domains and active site suffixes are not accepted either.">不接受 <span className="mono">xxx.example.com</span> 这类子域名，也不接受 <span className="mono">example.com</span> 等示例域与本站已生效后缀。</li>
                <li data-en="ccTLD and country/region suffixes such as .cn / .uk / .cc / .io / .ai are not accepted.">不接受 <span className="mono">.cn</span> / <span className="mono">.uk</span> / <span className="mono">.cc</span> / <span className="mono">.io</span> / <span className="mono">.ai</span> 等 ccTLD 与国家地区后缀。</li>
                <li data-en="Up to 5 domains per account; ownership is established by a real hosted zone in the SEUS account, the registrar NS pointing to SEUS, and manual approval by the site owner.">每账号最多 5 个；权属由「SEUS 账号里真实存在托管区域 + 注册商 NS 指向 SEUS + 站长人工批准」三道关构成，不做 TXT 所有权验证。</li>
              </ul>
            </section>

            <section className="card ed-sec" id="ed-steps">
              <h2 data-en="Step by step">接入流程</h2>
              <ol className="ed-steps">
                <li data-en="Enter your own full gTLD domain in the form below and submit the application.">在下方表单填写你自己的完整 gTLD 域名并提交申请。</li>
                <li data-en="At your registrar, change the NS to a.ns.fs5.net / b.ns.fs5.net, and finish DNS hosting for the domain at s.eus first (BYOS requires KYC L2 and manual review, which the site does not do for you).">到域名注册商把 NS 改为 <span className="mono">a.ns.fs5.net / b.ns.fs5.net</span>，并先在 s.eus 完成该域名的 DNS 托管（BYOS 需 KYC L2 与人工审核，本站不代做）。</li>
                <li data-en="Click Connect via API. The site uses the SEUS MCP token configured in Site Settings (one single input, effective on save) to call dns_zones and find the hosted zone. If that field is blank, you can temporarily paste your own mbt_ token for this one connection — it is never stored.">点「用 API 连接」：站点用「站点设置 → 第三方域名接入」<b>唯一输入框</b>里的 SEUS MCP Token 调官方 <span className="mono">dns_zones</span> 找到托管区域；该框留空也能用，连接时临时填自己的 <span className="mono">mbt_</span> Token，仅本次使用、不保存。</li>
                <li data-en="Wait for the site owner to approve in Site Settings → Third-party domain access. Only applications with a connected SEUS zone can be approved; afterwards the domain becomes a root domain and you can apply for subdomains under it.">等待站长在「站点设置 → 第三方域名接入」批准。只有已连上 SEUS zone 的申请能批准；批准后域名成为根域名，可在该后缀下申请子域。</li>
              </ol>
              <p className="hint" style={{ marginTop: 12 }} data-en="Records are written into the SEUS hosted zone; they will not resolve globally until the registrar NS actually points to SEUS DNS.">
                记录写进 SEUS 托管区域；<b>注册商 NS 没指向 SEUS 之前，全球 DNS 不会查询这些记录</b>，页面也会持续提示 NS 未生效。
              </p>
            </section>

            <section id="ed-apply" style={{ scrollMarginTop: 84 }}>
              {authed
                ? <ExternalDomainsCard />
                : <div className="card ed-sec">
                    <h2 data-en="Apply & status">申请与状态</h2>
                    <p data-en="Sign in to submit an application, connect via the SEUS API, and check approval status. This page itself is public, so you can read the guide without an account.">
                      提交申请、用 API 连接、查看审批状态需要先登录。本页说明部分公开可读，登录后再回来即可。
                    </p>
                    <a className="btn primary sm" href="/login" data-en="Sign in to apply">登录后提交申请 →</a>
                  </div>}
            </section>

            <section className="card ed-sec" id="ed-faq">
              <h2 data-en="FAQ">常见问题</h2>
              <p data-en="Connected but nothing resolves? The registrar NS is still the #1 cause — check with dig NS xxx.com @1.1.1.1, and use the Recheck NS button on the application. DNSSEC at the registrar must be turned off before switching.">
                <b>连上 API 也写了记录，但解析不生效？</b> 先查注册商 NS：用 <span className="mono">dig NS xxx.com @1.1.1.1</span> 看是否指向 SEUS 两台，或在申请上点「重新检查 NS」。切换前还要先在注册商关闭 DNSSEC。
              </p>
              <p data-en="Do I need to paste an SEUS token? Usually no. The site owner configures one token in Site Settings. Only when that field is blank can you temporarily paste your own mbt_ token for a single connection; it is never saved or echoed back.">
                <b>我要填 SEUS Token 吗？</b> 通常不用，站长在站点设置里配一次即可。只有该框留空时，才需要在连接时临时填自己的 <span className="mono">mbt_</span> Token，仅本次使用、不落库、不回显。
              </p>
              <p data-en="Can I switch the DNS backend after approval? No. Approved domains are locked to SEUS DNS on purpose; the dropdown in Root domain management is disabled and the switch API rejects the change.">
                <b>批准后能切换 DNS 后端吗？</b> 不能。批准后固定 SEUS DNS，「根域名管理」里的下拉禁用，切换接口也会拒绝。
              </p>
              <p style={{ marginBottom: 0 }}><a href="/docs/external-domains.html" data-en="Read the full guide">阅读完整服务文档 →</a></p>
            </section>
          </div>
        </div>
      </div></div></main>
      <div id="toast"></div>
    </div>
  );
}
