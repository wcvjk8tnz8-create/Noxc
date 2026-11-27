import { useEffect, useRef, useState, type FormEvent } from 'react';
import { mountDashboard } from '../legacy/dashboard';
import { api, refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/**
 * 第三方域名接入 · 站长定版流程
 *
 *   ① 填自己的完整域名（仅 gTLD 二级域，不接受子域名）
 *   ② 注册商 NS 指向 SEUS DNS，并在 s.eus 完成托管
 *   ③ 用 SEUS API 连接（站点级 MCP Token，用户不需要填凭据）
 *   ④ 站长在「站点设置 → 第三方域名接入」批准后生效
 *
 * 后端固定 SEUS DNS，不提供供应商选择；令牌绝不落在前端。
 */
type ExternalItem = {
  id: number; fqdn: string; status: string; statusLabel: string;
  ns: string[]; zoneId: string; connected: boolean; connectedAt: number | null;
  nsDelegated: boolean; apiSource: string; reviewNote: string;
  createdAt: number; note: string;
};
function ExternalDomains() {
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
        <span className="badge inf" data-en="SEUS DNS only">固定 SEUS DNS</span>
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
              {it.connected && <span className="badge inf">SEUS 已连接{it.zoneId ? ` · #${it.zoneId}` : ''}</span>}
              {it.nsDelegated && <span className="badge ok">NS 已生效</span>}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              NS：<span className="mono">{it.ns?.join(' / ')}</span>
              {it.apiSource === 'user' && <> · 本次连接用的是你临时填的 Token</>}
              {it.reviewNote && <> · 站长备注：{it.reviewNote}</>}
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

/** Dashboard —— 由 dashboard.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function DashboardPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;
    (async () => {
      try { await mountDashboard(ref.current); } catch (e) { console.error('[dashboard] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => { alive = false; cleanupPage(); };
  }, []);
  return (
    <div className="page-root" ref={ref} data-ready="0">
      <div id="bg"></div>
      <header className="topbar" id="topbar"></header>
      <aside className="sidebar" id="sidebar"></aside>
      
      <main className="main"><div className="main-in"><div className="wrap td-wrap">
        <div className="td-crumbbar">
          <div className="td-crumb">控制台 <span>/</span> <b>域名管理</b></div>
          <div className="td-crumb-meta"><span>DNS ZONES</span><span>·</span><span>实时状态</span></div>
        </div>
          <div className="welcome td-pagehead" id="welcome">
          <img className="w-av" id="wAv" src="/img/avatar/miku-headset.webp" alt="" />
          <div className="w-txt">
            {/* 骨架不放假数据：数据到齐前整块隐藏，避免「欢迎回来 → 下午好」跳一帧 */}
            <div className="w-hi" id="wHi">&nbsp;</div>
            <div className="w-sub" id="wSub">&nbsp;</div>
          </div>
          <div className="row" style={{marginLeft: "auto", gap: "6px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end"}}>
            <span className="sub" id="quotaTip" style={{margin: "0"}}></span>
            <button className="btn sm" id="btnPwd">修改密码</button>
            <a className="btn sm" href="/terms" target="_blank">服务条款</a>
          </div>
        </div>
      
        <div className="stat-row td-stats">
          <div className="stat-card sc-pink">
            <span className="sc-ico"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c1.3 0 2.6 2 3.2 5H8.8C9.4 6 10.7 4 12 4ZM4.3 9h3.1c-.1 1-.2 2.1-.2 3s.1 2 .2 3H4.3a8 8 0 0 1 0-6Zm1.1 8h3.4c.6 3 1.9 5 3.2 5-2.5 0-4.8-2-6.6-5Zm4.6 0h7.9c-1.8 3-4.1 5-6.6 5 1.3 0 2.6-2 3.2-5h-4.5Zm8.6-2c.1-1 .2-2.1.2-3s-.1-2-.2-3h3.1a8 8 0 0 1 0 6h-3.1Z" /></svg></span>
            <div><div className="sc-num" id="stDomains">—</div><div className="sc-lbl">域名总数</div></div>
          </div>
          <div className="stat-card sc-blue">
            <span className="sc-ico"><svg viewBox="0 0 24 24"><path d="M4 4h16a1 1 0 0 1 1 1v4H3V5a1 1 0 0 1 1-1Zm-1 7h18v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8Zm3 3v2h4v-2H6Z" /></svg></span>
            <div><div className="sc-num" id="stRecords">—</div><div className="sc-lbl">DNS 记录</div></div>
          </div>
          <div className="stat-card sc-indigo">
            <span className="sc-ico"><svg viewBox="0 0 24 24"><path d="M12 1 3 5v6c0 5.6 3.8 10.7 9 12 5.2-1.3 9-6.4 9-12V5l-9-4Zm0 3.2 7 3.1V11c0 4.4-3 8.3-7 9.4-4-1.1-7-5-7-9.4V7.3l7-3.1Zm-1 5v2H7.5v2H11v2h2v-2h3.5v-2H13v-2h-2Z" /></svg></span>
            <div><div className="sc-num" id="stPoints">—</div><div className="sc-lbl">我的积分</div></div>
          </div>
          <div className="stat-card sc-amber">
            <span className="sc-ico"><svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5-3 6-3 6h20s-3-1-3-6a7 7 0 0 0-7-7Zm0 2a5 5 0 0 1 5 5c0 2.3.5 3.8 1.3 5H5.7C6.5 12.8 7 11.3 7 9a5 5 0 0 1 5-5Zm-2.2 12h4.4a2.2 2.2 0 0 1-2.2 1.8A2.2 2.2 0 0 1 9.8 16Z" /></svg></span>
            <div><div className="sc-num" id="stPending">—</div><div className="sc-lbl">待审核</div></div>
          </div>
        </div>
      
        <div className="quick-row td-quickbar">
          <a className="quick" href="#listAnchor" data-quick="list"><span className="q-ico"><svg viewBox="0 0 24 24"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" /></svg></span><span className="q-txt">我的域名</span></a>
          <a className="quick" href="#applyCard" data-quick="apply"><span className="q-ico"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5v4h4v2h-4v4h-2v-4H7v-2h4V7h2Z" /></svg></span><span className="q-txt">注册域名</span></a>
          <a className="quick" href="/rewards"><span className="q-ico"><svg viewBox="0 0 24 24"><path d="M20 7h-2.2A3 3 0 0 0 12 3.2 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3h8V8h2v3h8V8a1 1 0 0 0-1-1ZM4 13v7a1 1 0 0 0 1 1h6v-8H4Zm9 8h6a1 1 0 0 0 1-1v-7h-7v8Z" /></svg></span><span className="q-txt">奖励中心</span></a>
          <a className="quick" href="/checkin"><span className="q-ico"><svg viewBox="0 0 24 24"><path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm12 8v9H5v-9h14ZM8 12h3v3H8v-3Z" /></svg></span><span className="q-txt">签到地</span></a>
          <a className="quick" href="/whois"><span className="q-ico"><svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 1 0 4.9 14.3l4.4 4.4 1.4-1.4-4.4-4.4A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z" /></svg></span><span className="q-txt">WHOIS</span></a>
          <a className="quick" href="/chat"><span className="q-ico"><svg viewBox="0 0 24 24"><path d="M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8l-4 4V4a1 1 0 0 1 1-1Zm2 4v2h12V7H6Zm0 4v2h9v-2H6Z" /></svg></span><span className="q-txt">聊天地</span></a>
          <a className="quick" href="#externalCard"><span className="q-ico"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c1.4 0 2.7 2.2 3.3 5.3A16 16 0 0 1 12 10a16 16 0 0 1-3.3-.7C9.3 6.2 10.6 4 12 4ZM4.3 9.2A16 16 0 0 0 8 10a16 16 0 0 0-.1 4 16 16 0 0 0-3.6.8 8 8 0 0 1 0-5.6Zm15.4 0a8 8 0 0 1 0 5.6 16 16 0 0 0-3.6-.8A16 16 0 0 0 16 10a16 16 0 0 0 3.7-.8ZM9.9 14.7A16 16 0 0 1 12 15c.7 0 1.4 0 2.1-.3-.6 2.7-1.4 4.3-2.1 4.3s-1.5-1.6-2.1-4.3Z"/></svg></span><span className="q-txt">外部域名</span></a>
          <a className="quick" href="/showcase"><span className="q-ico"><svg viewBox="0 0 24 24"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z"/></svg></span><span className="q-txt">用户案例</span></a>
        </div>
      
      <div className="card" id="pointsCard" style={{display: "none"}}>
          <div className="row between" style={{flexWrap: "wrap", gap: "10px"}}>
            <div>
              <div style={{fontFamily: "var(--display)", fontSize: "26px", lineHeight: "1.1", color: "var(--c1)"}} id="ptVal">—</div>
              <div className="sub" id="ptRules" style={{margin: "2px 0 0"}}></div>
            </div>
            <div className="row" style={{gap: "6px"}}>
              <button className="btn primary" id="btnCheckin">每日签到</button>
              <button className="btn sm ghost" id="btnLogs">明细</button>
            </div>
          </div>
          <div className="hint" id="ptTip" style={{marginTop: "8px"}}></div>
        </div>
      
        <div className="card" id="applyCard">
          <div className="head-row"><h3>注册域名</h3><a className="btn sm" id="goRegister" href="/register">前往注册 →</a></div>
          <div className="hint" id="applyCardHint">注册入口已独立为单独页面：可先检查名称是否可用、查看积分消耗，再提交申请。</div>
        </div>

        {/* 第三方域名接入按用户要求放在「注册域名」下面 */}
        <ExternalDomains />
      
        <div className="card td-table-card" id="listAnchor">
          <div className="td-cardhead"><h2>我的域名</h2><span className="td-cardhint">ZONE LIST · 可搜索 / 分页</span></div>
          <div className="td-toolbar">
            <div className="td-field" style={{flex: "1", minWidth: "170px"}}>
              <label>搜索域名</label>
              <input id="kw" placeholder="域名关键字" autocomplete="off" />
            </div>
            <button className="btn sm" id="btnSearch">搜索</button>
            <a className="btn sm ghost" href="/register">＋ 注册域名</a>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>域名</th><th>状态</th><th>根域名</th><th>记录数</th><th>注册时间</th><th>到期时间</th><th className="right">操作</th></tr></thead>
              <tbody id="list"><tr><td colspan="7" className="empty">加载中…</td></tr></tbody>
            </table>
          </div>
          <div className="row between" style={{marginTop: "12px"}}>
            <button className="btn sm" id="btnPrev">上一页</button>
            <span className="dim" id="pageTip" style={{fontSize: "12px"}}></span>
            <button className="btn sm" id="btnNext">下一页</button>
          </div>
        </div>

      </div></div></main>
      
      <div className="modal" id="modal"><div className="box"></div></div>
      <div id="toast"></div>
    </div>
  );
}
