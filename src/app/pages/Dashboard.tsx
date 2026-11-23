import { useEffect, useRef, useState } from 'react';
import { mountDashboard } from '../legacy/dashboard';
import { api, refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/**
 * 第三方域名接入（外部域名）
 * 独立表 /api/external-domains，不占注册配额、不参与公开统计聚合、不写本站 DNS。
 * 每条都标「（外部域名）」，解析由域名注册商或 DNSHE 管理。
 */
function ExternalDomains() {
  const [items, setItems] = useState<any[]>([]);
  const [domain, setDomain] = useState('');
  const [note, setNote] = useState('');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [max, setMax] = useState(5);

  const load = () => api.get('/api/external-domains')
    .then((d: any) => { setItems(d.items || []); if (Number(d.max) > 0) setMax(Number(d.max)); })
    .catch(() => { /* 未登录 / 接口不可用时保持空 */ });
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!domain.trim() || busy) return;
    setBusy(true); setMsg('');
    try {
      const r: any = await api.post('/api/external-domains', {
        domain: domain.trim(), note: note.trim(), dnsheToken: token.trim(),
      });
      setDomain(''); setNote(''); setToken('');
      setMsg(r?.zoneNote || '已接入，已标记为（外部域名）');
      await load();
    } catch (e: any) { setMsg(e?.message || '接入失败'); }
    finally { setBusy(false); }
  };
  const remove = async (id: number) => {
    try { await api.del('/api/external-domains/' + id); await load(); }
    catch (e: any) { setMsg(e?.message || '移除失败'); }
  };

  return (
    <div className="card" id="externalCard">
      <div className="head-row"><h3 data-en="Third-party domain access">第三方域名接入</h3><span className="badge inf" data-en="(External domain)">（外部域名）</span></div>
      <p className="hint" data-en="Register a domain you already own. External domains are display-only: DNS is managed at your registrar or DNSHE, and they do not count toward the site statistics or your quota.">登记你已经拥有的完整域名。外部域名仅作展示：DNS 由域名注册商 / DNSHE 管理，本站不写入解析、不占注册配额、不计入站点统计。</p>
      {items.length > 0 && (
        <div className="tablewrap" style={{ marginTop: '12px' }}>
          <table>
            <thead><tr><th data-en="Domain">域名</th><th data-en="Type">类型</th><th data-en="Nameservers">NS</th><th className="right" data-en="Action">操作</th></tr></thead>
            <tbody>{items.map((it) => (
              <tr key={it.id}>
                <td className="mono">{it.fqdn}</td>
                <td><span className="badge inf" data-en="(External domain)">{it.externalLabel || '（外部域名）'}</span></td>
                <td className="mono" style={{ fontSize: '11.5px' }}>{it.ns1 ? `${it.ns1}${it.ns2 ? ' / ' + it.ns2 : ''}` : '—'}</td>
                <td className="right"><button className="btn sm danger" onClick={() => remove(it.id)} data-en="Remove">移除</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="grid2" style={{ marginTop: '12px' }}>
        <div className="field">
          <label data-en="Full domain">完整域名</label>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" maxLength={253} />
        </div>
        <div className="field">
          <label data-en="Note (optional)">备注（选填）</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="这个域名做什么用" maxLength={160} />
        </div>
      </div>
      <div className="field">
        <label data-en="DNSHE API Token (optional)">DNSHE API Token（选填）</label>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="留空则不自动创建解析区域" autoComplete="off" />
        <div className="hint" data-en="Used only for this request to create a DNSHE zone; never stored. Leave blank to add the zone manually at your provider.">只在本次请求中用于创建 DNSHE 解析区域，不会保存；留空请到服务商面板手动添加。</div>
      </div>
      <div className="row between" style={{ alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span className="hint" style={{ margin: 0 }}>{items.length} / {max} <span data-en="external domains">个外部域名</span></span>
        <button className="btn primary sm" onClick={add} disabled={busy || !domain.trim()} data-en="Add domain">{busy ? '处理中…' : '接入域名'}</button>
      </div>
      {msg && <p className="hint" style={{ marginTop: '8px' }}>{msg}</p>}
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

        <ExternalDomains />
      </div></div></main>
      
      <div className="modal" id="modal"><div className="box"></div></div>
      <div id="toast"></div>
    </div>
  );
}
