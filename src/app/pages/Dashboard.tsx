import { useEffect, useRef, useState } from 'react';
import { mountDashboard } from '../legacy/dashboard';
import { api, refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/**
 * 第三方域名接入（外部域名）· 放在「注册域名」卡片下面
 *
 * 流程：提交域名 → 加 TXT 验证所有权 → 填供应商 API key 连接 → 添加 DNS 记录。
 * 关键提示：TXT 只证明所有权，记录生效还要求域名 NS 指向该供应商，
 * 这一步由用户在注册商完成，UI 里必须写清楚，不能省。
 */
function ExternalDomains() {
  const [items, setItems] = useState<any[]>([]);
  const [domain, setDomain] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [max, setMax] = useState(5);
  const [providers] = useState<string[]>(['cloudflare', 'dnshe']);
  const [recordTypes] = useState<string[]>(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA']);
  // 每个域名各自的表单状态（key 不进 React 之外的任何持久化存储）
  const [form, setForm] = useState<Record<number, any>>({});
  const setField = (id: number, k: string, v: any) =>
    setForm((f) => ({ ...f, [id]: { ...(f[id] || {}), [k]: v } }));

  const load = () => api.get('/api/external-domains')
    .then((d: any) => {
      setItems(d.items || []);
      if (Number(d.max) > 0) setMax(Number(d.max));
    })
    .catch(() => { /* 未登录 / 接口不可用时保持空 */ });
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!domain.trim() || busy) return;
    setBusy(true); setMsg('');
    try {
      const r: any = await api.post('/api/external-domains', {
        domain: domain.trim(), note: note.trim(),
      });
      setDomain(''); setNote('');
      setMsg('已创建待验证记录。请在你当前的 DNS 服务商添加页面里显示的 TXT，然后点「验证所有权」。');
      await load();
      void r;
    } catch (e: any) { setMsg(e?.message || '提交失败'); }
    finally { setBusy(false); }
  };

  const verify = async (id: number) => {
    setBusy(true); setMsg('');
    try {
      const r: any = await api.post(`/api/external-domains/${id}/verify`, {});
      setMsg(r?.verified ? '所有权验证通过，可以继续连接供应商' : (r?.detail || '尚未查到 TXT'));
      await load();
    } catch (e: any) { setMsg(e?.message || '验证失败'); }
    finally { setBusy(false); }
  };

  const connect = async (id: number) => {
    const f = form[id] || {};
    if (!f.apiKey) { setMsg('请填写供应商 API key（不会保存）'); return; }
    setBusy(true); setMsg('');
    try {
      const r: any = await api.post(`/api/external-domains/${id}/connect`, {
        provider: f.provider || 'cloudflare', apiKey: f.apiKey,
      });
      setField(id, 'apiKey', '');       // 用完立刻从前端状态清掉
      setMsg(`${r?.note || '已连接供应商'}${r?.ns?.length ? '　官方 NS：' + r.ns.join(' / ') : ''}`);
      await load();
    } catch (e: any) { setMsg(e?.message || '连接失败'); }
    finally { setBusy(false); }
  };

  const addRec = async (id: number) => {
    const f = form[id] || {};
    if (!f.apiKey) { setMsg('添加记录需要重新填一次 API key（本站不保存）'); return; }
    setBusy(true); setMsg('');
    try {
      const r: any = await api.post(`/api/external-domains/${id}/records`, {
        apiKey: f.apiKey, type: f.type || 'A', name: f.name || '@',
        content: f.content || '', ttl: Number(f.ttl || 3600),
      });
      setField(id, 'apiKey', '');
      setField(id, 'content', '');
      setMsg(r?.note || '记录已提交');
      await load();
    } catch (e: any) { setMsg(e?.message || '写入失败'); }
    finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    try { await api.del('/api/external-domains/' + id); await load(); }
    catch (e: any) { setMsg(e?.message || '移除失败'); }
  };

  return (
    <div className="card" id="externalCard">
      <div className="head-row">
        <h3 data-en="Third-party domain access">第三方域名接入</h3>
        <span className="badge inf" data-en="(External domain)">（外部域名）</span>
      </div>
      <p className="hint">
        接入你自己拥有的完整域名（如 example.com）。流程：<b>① 提交域名</b> →
        <b>② 在当前 DNS 服务商添加一条 TXT 验证所有权</b> →
        <b>③ 填供应商 API key 连接并添加 DNS 记录</b>。
      </p>
      <div className="alert a-warn" style={{ marginTop: '10px' }}>
        <b>TXT 只用来验证所有权，不能让解析生效。</b>添加记录后，还必须到你的域名注册商
        把 <b>NS 改成供应商分配的两台</b>（连接后下方会显示）。NS 生效前写进去的记录
        不会被全球 DNS 查询。本站不托管这些域名的 DNS。
      </div>

      {items.length > 0 && items.map((it) => {
        const f = form[it.id] || {};
        return (
          <div className="card flat" key={it.id} style={{ marginTop: '12px' }}>
            <div className="row between" style={{ flexWrap: 'wrap', gap: '8px' }}>
              <div><b className="mono">{it.fqdn}</b> <span className="badge inf">{it.externalLabel}</span></div>
              <div className="row" style={{ gap: '6px' }}>
                <span className={`badge ${it.verified ? 'ok' : 'warn'}`}>{it.verified ? '已验证所有权' : '待验证'}</span>
                {it.connected && <span className="badge ok">已连接 {it.providerKey}</span>}
                <button className="btn sm danger" onClick={() => remove(it.id)} data-en="Remove">移除</button>
              </div>
            </div>

            {!it.verified && (
              <div style={{ marginTop: '10px' }}>
                <div className="hint" data-en="Add this TXT record at your current DNS provider:">在你当前的 DNS 服务商添加这条 TXT：</div>
                <div className="mono" style={{ fontSize: '11.5px', wordBreak: 'break-all', background: 'var(--paper2)', padding: '8px', borderRadius: '6px', marginTop: '5px' }}>
                  {it.verifyHost}　TXT　{it.verifyValue}
                </div>
                <button className="btn sm primary" style={{ marginTop: '8px' }} disabled={busy} onClick={() => verify(it.id)} data-en="Verify ownership">
                  验证所有权
                </button>
              </div>
            )}

            {it.verified && (
              <div style={{ marginTop: '10px' }}>
                <div className="grid2">
                  <div className="field">
                    <label data-en="DNS provider">DNS 供应商</label>
                    <select value={f.provider || 'cloudflare'} onChange={(e) => setField(it.id, 'provider', e.target.value)}>
                      {providers.map((p) => <option key={p} value={p}>{p === 'cloudflare' ? 'Cloudflare' : 'DNSHE'}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label data-en="Provider API key (never stored)">供应商 API key（不会保存）</label>
                    <input type="password" value={f.apiKey || ''} onChange={(e) => setField(it.id, 'apiKey', e.target.value)} placeholder="每次操作时填写" autoComplete="off" />
                  </div>
                </div>
                <div className="hint" style={{ marginTop: '4px' }}>
                  Cloudflare Token 需要 <b>Zone Read + DNS Write</b> 权限；DNSHE 填其 API Token。
                  key 只用于本次请求，不落库、不回传。
                </div>
                <button className="btn sm primary" style={{ marginTop: '8px' }} disabled={busy} onClick={() => connect(it.id)} data-en="Connect provider">
                  连接供应商
                </button>

                {(it.ns1 || it.ns2) && (
                  <div className="alert a-info" style={{ marginTop: '10px' }}>
                    <b>请到注册商把 NS 改成：</b><span className="mono">{[it.ns1, it.ns2].filter(Boolean).join(' / ')}</span>
                    <br />NS 生效（Cloudflare 显示 Active）后，下面写的记录才会真正被解析。
                  </div>
                )}

                {it.connected && (
                  <div style={{ marginTop: '12px', borderTop: '1px solid var(--hair)', paddingTop: '10px' }}>
                    <div className="hint" data-en="Add a DNS record">添加 DNS 记录（写入 {it.providerKey}）</div>
                    <div className="grid2" style={{ marginTop: '6px' }}>
                      <div className="field">
                        <label data-en="Type">类型</label>
                        <select value={f.type || 'A'} onChange={(e) => setField(it.id, 'type', e.target.value)}>
                          {recordTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label data-en="Name">名称（@ = 主域名）</label>
                        <input value={f.name || ''} onChange={(e) => setField(it.id, 'name', e.target.value)} placeholder="@ 或 www" />
                      </div>
                    </div>
                    <div className="grid2" style={{ marginTop: '6px' }}>
                      <div className="field">
                        <label data-en="Value">记录值</label>
                        <input value={f.content || ''} onChange={(e) => setField(it.id, 'content', e.target.value)} placeholder="1.2.3.4 或目标域名" />
                      </div>
                      <div className="field">
                        <label data-en="TTL">TTL</label>
                        <input type="number" value={f.ttl || 3600} onChange={(e) => setField(it.id, 'ttl', e.target.value)} min={60} max={86400} />
                      </div>
                    </div>
                    <div className="field" style={{ marginTop: '6px' }}>
                      <label data-en="Provider API key (again)">供应商 API key（再次填写）</label>
                      <input type="password" value={f.apiKey || ''} onChange={(e) => setField(it.id, 'apiKey', e.target.value)} placeholder="本站不保存，每次操作需重填" autoComplete="off" />
                    </div>
                    <button className="btn sm primary" style={{ marginTop: '8px' }} disabled={busy} onClick={() => addRec(it.id)} data-en="Add record">
                      添加记录
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="grid2" style={{ marginTop: '14px' }}>
        <div className="field">
          <label data-en="Full domain">完整域名</label>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" maxLength={253} />
        </div>
        <div className="field">
          <label data-en="Note (optional)">备注（选填）</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="这个域名做什么用" maxLength={160} />
        </div>
      </div>
      <div className="row between" style={{ alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span className="hint" style={{ margin: 0 }}>{items.length} / {max} <span data-en="external domains">个外部域名</span> · 不占注册配额、不计入站点统计</span>
        <button className="btn primary sm" onClick={add} disabled={busy || !domain.trim()} data-en="Add domain">{busy ? '处理中…' : '提交域名'}</button>
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
