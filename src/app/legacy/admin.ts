/**
 * Admin 页面控制器（由 admin.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, openModal, closeModal, loadBranding, resetBranding, applyBranding, statusBadge, mountShell, showDialog } from '../lib/runtime';
import { POINT_DEFAULTS, SHOWCASE_REWARD_POINTS, COMBO_REWARD_POINTS, COMBO_REWARD_CAP } from '../../lib/pointDefaults';

import type { LegacyCtx } from '../lib/types';

/* 0 是合法值（免费），不能用 `||` 兜底 —— 否则管理员设 0 后重开页面
   会看到默认值，一点保存就把 0 覆盖掉。只把 undefined / 空串交给默认。 */
function pick(v, d) { return (v === undefined || v === null || v === '') ? d : v; }

/** 站点设置页的操作反馈：统一用弹窗，不再弹底部黑色药丸。 */
function settingsFeedback(msg: string, type: 'ok' | 'err' = 'ok') {
  showDialog({ message: msg, tone: type === 'err' ? 'err' : 'ok' });
}

export async function mountAdmin(_root: HTMLElement | null): Promise<void> {
  
  let tab = 'pending';
  
  const HEADS = {
    pending: ['域名', '申请人', '用途', '时间', '操作'],
    subs: ['域名', '申请人', '状态', '记录', '时间', '操作'],
    users: ['邮箱', '角色', '状态', '配额', '域名数', '积分', '操作'],
    locks: ['记录名', '类型', '发起人', '锁定时间', '操作'],
    settings: ['站点品牌', '值'],
    backup: ['数据备份', '导出 / 重新汇入'],
    ips: ['IP', '账号数', '邮箱', '最近注册', '状态', '操作'],
    emailreq: ['邮箱', '理由 / 联系方式', '状态', '时间', '操作'],
    audit: ['时间', '用户', '动作', '对象', '详情'],
  };
  
  
  /* ---------- Spaceship 域名选择弹窗 ----------
     拉取后不直接添加，先把账号下所有域名列出来让管理员勾选，
     并可顺手填 Cloudflare Zone ID（做 DNS 解析时需要）。 */
  function openSpaceshipPicker(items, showRoots) {
    let mask = document.getElementById('spMask');
    if (mask) mask.remove();
    mask = document.createElement('div');
    mask.id = 'spMask';
    mask.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(20,28,50,.45);display:grid;place-items:center;padding:16px';
    const rows = items.map((it, i) => `
      <label class="sp-row" style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--line);cursor:${it.alreadyAdded ? 'default' : 'pointer'}">
        <input type="checkbox" class="sp-chk" data-i="${i}" ${it.alreadyAdded ? 'disabled' : ''} style="width:16px;height:16px;flex-shrink:0">
        <span style="flex:1;min-width:0">
          <b class="mono">${esc(it.domain)}</b>
          ${it.alreadyAdded ? '<span class="badge ok" style="margin-left:8px">已添加</span>' : ''}
          <div class="hint" style="margin-top:2px">${it.expirationDate ? '到期 ' + esc(String(it.expirationDate).slice(0, 10)) : 'Spaceship 账号域名'}${it.hasZone ? ' · 已配 Zone' : ''}</div>
        </span>
        ${it.alreadyAdded ? '' : `<input class="input sp-zone" data-i="${i}" placeholder="CF Zone ID（可选）" style="width:170px;padding:6px 9px;font-size:12px">`}
      </label>`).join('');
    mask.innerHTML = `
      <div style="background:#fff;border-radius:18px;width:min(640px,96vw);max-height:86vh;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(20,28,50,.25);overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px">
          <b style="font-size:16px">从 Spaceship 添加根域名</b>
          <span class="dim" style="margin-left:auto;font-size:12px">共 ${items.length} 个</span>
        </div>
        <div style="padding:6px 20px;overflow-y:auto;flex:1">
          ${items.length ? rows : '<div class="empty" style="padding:40px 0">账号下没有域名</div>'}
          <div class="hint" style="padding:12px 4px">勾选后即为本站可用根域名。若要用 Cloudflare 做 DNS 解析，请把该域名 NS 指向 Cloudflare 并填入对应 Zone ID（也可稍后在环境变量配置）。</div>
        </div>
        <div style="padding:14px 20px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:10px">
          <button class="btn" id="spCancel">取消</button>
          <button class="btn primary" id="spAdd">添加选中</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
  
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    document.getElementById('spCancel').onclick = close;
    document.getElementById('spAdd').onclick = async () => {
      const picked = [];
      mask.querySelectorAll('.sp-chk:checked').forEach((cb) => {
        const i = Number(cb.dataset.i);
        const z = mask.querySelector('.sp-zone[data-i="' + i + '"]');
        picked.push({ domain: items[i].domain, zoneId: z ? z.value.trim() : '' });
      });
      if (!picked.length) return settingsFeedback('请先勾选要添加的域名', 'err');
      const btn = document.getElementById('spAdd');
      btn.disabled = true; btn.textContent = '添加中…';
      try {
        const r = await api.post('/api/admin/spaceship/add', { domains: picked });
        settingsFeedback('已添加：' + r.added.join('、') + (r.skipped.length ? '（跳过已存在 ' + r.skipped.length + ' 个）' : ''));
        if (showRoots) showRoots(r.rootDomains);
        close();
      } catch (e) {
        btn.disabled = false; btn.textContent = '添加选中';
        settingsFeedback(e.message, 'err');
      }
    };
  }
  
  /* ---------- AnyNS 解析区域选择弹窗 ----------
     拉取回来的是「解析区域」而不是注册商域名，自带数字 Zone ID。
     已存在的根域名照样可勾选：勾选后会把它的 DNS 后端切换成 AnyNS
     （截图里 meoy.top 显示 CLOUDFLARE DNS 的场景就是这么切过来的）。 */
  function openAnynsPicker(items, showRoots, renderRoots) {
    let mask = document.getElementById('anMask');
    if (mask) mask.remove();
    mask = document.createElement('div');
    mask.id = 'anMask';
    mask.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(20,28,50,.45);display:grid;place-items:center;padding:16px';
    const rows = items.map((it, i) => `
      <label class="an-row" style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--line);cursor:pointer">
        <input type="checkbox" class="an-chk" data-i="${i}" style="width:16px;height:16px;flex-shrink:0">
        <span style="flex:1;min-width:0">
          <b class="mono">${esc(it.domain)}</b>
          <span class="badge" style="margin-left:8px">Zone #${esc(it.zoneId)}</span>
          ${it.alreadyAdded ? '<span class="badge ok" style="margin-left:6px">已添加 · 勾选后切换为 AnyNS</span>' : ''}
          <div class="hint" style="margin-top:2px">NS：${esc((it.ns || []).join(' / '))}${it.hasCfZone ? ' · 本站已配 Cloudflare Zone（切换后不再使用）' : ''}</div>
        </span>
      </label>`).join('');
    mask.innerHTML = `
      <div style="background:#fff;border-radius:18px;width:min(640px,96vw);max-height:86vh;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(20,28,50,.25);overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px">
          <b style="font-size:16px">从 AnyNS 添加根域名</b>
          <span class="dim" style="margin-left:auto;font-size:12px">共 ${items.length} 个解析区域</span>
        </div>
        <div style="padding:6px 20px;overflow-y:auto;flex:1">
          ${items.length ? rows : '<div class="empty" style="padding:40px 0">该令牌下没有解析区域，请先到 anyns.io 面板添加域名</div>'}
          <div class="hint" style="padding:12px 4px">勾选后：还不是根域名的会被添加，已经是根域名的会把 DNS 写入后端切换为 <b>AnyNS</b>。Zone ID 会自动保存，写记录时不用再查一次。记得把该域名的 NS 指向 AnyNS 给出的服务器。</div>
        </div>
        <div style="padding:14px 20px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:10px">
          <button class="btn" id="anCancel">取消</button>
          <button class="btn primary" id="anAdd">添加选中 / 切换为 AnyNS</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    document.getElementById('anCancel').onclick = close;
    document.getElementById('anAdd').onclick = async () => {
      const picked = [];
      mask.querySelectorAll('.an-chk:checked').forEach((cb) => {
        const i = Number(cb.dataset.i);
        picked.push({ domain: items[i].domain, zoneId: items[i].zoneId });
      });
      if (!picked.length) return settingsFeedback('请先勾选要添加的域名', 'err');
      const btn = document.getElementById('anAdd');
      btn.disabled = true; btn.textContent = '处理中…';
      try {
        const r = await api.post('/api/admin/anyns/add', { domains: picked });
        const parts = [];
        if (r.added && r.added.length) parts.push('已添加 ' + r.added.join('、'));
        if (r.switched && r.switched.length) parts.push('已切换为 AnyNS ' + r.switched.join('、'));
        if (r.invalid && r.invalid.length) parts.push('跳过 ' + r.invalid.join('、'));
        settingsFeedback(parts.join('；') || '已完成');
        if (showRoots) showRoots(r.rootDomains);
        if (renderRoots) renderRoots();
        close();
      } catch (e) {
        btn.disabled = false; btn.textContent = '添加选中 / 切换为 AnyNS';
        settingsFeedback(e.message, 'err');
      }
    };
  }

  async function load() {
    const s = await api.get('/api/admin/stats');
    document.getElementById('stats').innerHTML = [
      ['用户', s.users], ['已开通域名', s.subdomains], ['待审核', s.pending], ['DNS 记录', s.records], ['验证锁定', s.locked],
    ].map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')
     + `<div class="stat"><div class="v" style="font-size:13px;font-family:var(--mono)">${esc(s.rootDomain)}</div><div class="l">根域名${s.mock ? ' · MOCK' : ''}</div></div>`;
    document.getElementById('envTip').textContent = s.mock
      ? '当前为 MOCK 模式：DNS 记录只写入内存，不会真正调用 Cloudflare。'
      : 'DNS 记录按各根域名配置的后端实时同步（Cloudflare / Spaceship）。';
  
    document.getElementById('thead').innerHTML = '<tr>' + HEADS[tab].map((h) => `<th>${h}</th>`).join('') + '</tr>';
    const tb = document.getElementById('tbody');
  
    if (tab === 'pending' || tab === 'subs') {
      const d = await api.get('/api/admin/subdomains' + (tab === 'pending' ? '?status=pending' : ''));
      if (!d.items.length) return tb.innerHTML = `<tr><td colspan="6" class="empty">暂无数据</td></tr>`;
      tb.innerHTML = d.items.map((s) => `
        <tr>
          <td><span class="fqdn">${esc(s.fqdn)}</span>${s.reason ? `<div class="hint">${esc(s.reason)}</div>` : ''}</td>
          <td class="mono" style="color:var(--muted)">${esc(s.owner_email)}</td>
          ${tab === 'pending' ? `<td>${esc(s.note || '-')}</td>` : `<td>${statusBadge(s.status)}</td><td>${s.record_count}</td>`}
          <td class="nowrap" style="color:var(--muted)">${fmtTime(s.created_at)}</td>
          <td class="right nowrap">
            ${s.status !== 'approved' ? `<button class="btn sm ok" data-act="approve" data-id="${s.id}">通过</button>` : ''}
            ${s.status !== 'rejected' ? `<button class="btn sm" data-act="reject" data-id="${s.id}">驳回</button>` : ''}
            ${s.status === 'approved' ? `<button class="btn sm danger" data-act="suspend" data-id="${s.id}">停用</button>` : ''}
            ${s.status === 'suspended' ? `<button class="btn sm ok" data-act="restore" data-id="${s.id}">恢复</button>` : ''}
            <button class="btn sm" onclick="location.href='/domain?id=${s.id}'">记录</button>
            <button class="btn sm danger" data-act="del" data-id="${s.id}">删除</button>
          </td>
        </tr>`).join('');
      bindSubActions(tb);
    }
  
    if (tab === 'users') {
      const d = await api.get('/api/admin/users');
      tb.innerHTML = d.items.map((u) => `
        <tr>
          <td class="mono">${esc(u.email)}</td>
          <td>${u.role === 'admin' ? '<span class="badge type">admin</span>' : '<span class="badge">user</span>'}</td>
          <td>${u.status === 'banned' ? `<span class="badge danger">已封禁</span><div class="hint">${esc(u.ban_reason || '')}</div>` : '<span class="badge ok">正常</span>'}</td>
          <td>${u.quotaUnlimited ? '<span class="badge inf">∞ 不限</span>' : u.quota}</td>
          <td>${u.sub_count}</td>
          <td class="mono">${u.points === -1 ? '<span class="badge inf">∞</span>' : (u.points === null ? '<span style="color:var(--muted)">—</span>' : u.points)}</td>
          <td class="right nowrap">
            <button class="btn sm" data-points="${u.id}" data-email="${esc(u.email)}" data-p="${u.points ?? ''}" data-role="${u.role}">积分</button>
            <button class="btn sm" data-quota="${u.id}" data-email="${esc(u.email)}" data-q="${u.quota}" data-role="${u.role}">配额/角色</button>
            ${u.status === 'banned'
              ? `<button class="btn sm ok" data-unban="${u.id}">解封</button>`
              : `<button class="btn sm danger" data-ban="${u.id}" data-email="${esc(u.email)}">封禁</button>`}
          </td>
        </tr>`).join('');
      tb.querySelectorAll('[data-points]').forEach((b) => b.onclick = () => {
        if (b.dataset.role === 'admin') return settingsFeedback('管理员积分不限，无需调整', 'err');
        openModal('调整积分 · ' + b.dataset.email, `
          <div class="field"><label>设置为</label><input id="pset" type="number" value="${b.dataset.p || 0}"><div class="hint">直接指定最终余额</div></div>
          <div class="field"><label>或增减</label><input id="pdelta" type="number" placeholder="如 +20 或 -5"><div class="hint">填了这项则忽略上面的「设置为」</div></div>
          <div class="field"><label>备注</label><input id="preason" placeholder="选填"></div>
          <div class="row end"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="pok">保存</button></div>`);
        document.getElementById('pok').onclick = async () => {
          const delta = document.getElementById('pdelta').value.trim();
          const body = delta
            ? { delta: Number(delta), reason: document.getElementById('preason').value.trim() }
            : { set: Number(document.getElementById('pset').value), reason: document.getElementById('preason').value.trim() };
          try { await api.post('/api/admin/users/' + b.dataset.points + '/points', body); settingsFeedback('已保存'); closeModal(); load(); }
          catch (e) { settingsFeedback(e.message, 'err'); }
        };
      });
      tb.querySelectorAll('[data-quota]').forEach((b) => b.onclick = () => {
        openModal('调整 ' + b.dataset.email, `
          <div class="field"><label>子域名配额</label><input id="q" type="number" value="${b.dataset.q}"><div class="hint">该用户可单独设置额度；-1 表示不限量，管理员始终不限。</div></div>
          <div class="field"><label>角色</label><select id="r"><option value="user" ${b.dataset.role === 'user' ? 'selected' : ''}>user</option><option value="admin" ${b.dataset.role === 'admin' ? 'selected' : ''}>admin</option></select></div>
          <div class="field"><button class="btn sm" type="button" id="qUseDefault">填入全局默认</button> <span class="dim" id="qDefaultHint"></span></div>
          <div class="row end"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="ok">保存</button></div>`);
        document.getElementById('qUseDefault').onclick = async () => {
          try {
            const s = await api.get('/api/admin/settings');
            const q = s.items?.default_quota ?? 5;
            document.getElementById('q').value = q;
            document.getElementById('qDefaultHint').textContent = String(q);
          } catch (e) { settingsFeedback(e.message, 'err'); }
        };
        document.getElementById('ok').onclick = async () => {
          try { await api.post('/api/admin/users/' + b.dataset.quota + '/quota', { quota: Number(document.getElementById('q').value), role: document.getElementById('r').value }); settingsFeedback('已保存'); closeModal(); load(); }
          catch (e) { settingsFeedback(e.message, 'err'); }
        };
      });
      tb.querySelectorAll('[data-ban]').forEach((b) => b.onclick = () => {
        openModal('封禁 ' + b.dataset.email, `
          <div class="alert danger">封禁后该用户立即下线、无法登录，其全部子域名停用。</div>
          <div class="field"><label>封禁原因</label><input id="rs" placeholder="违规使用"></div>
          <label class="check" style="margin-bottom:12px"><input type="checkbox" id="pg"> 同时清空其在 Cloudflare 上的全部 DNS 记录</label>
          <div class="row end"><button class="btn" onclick="closeModal()">取消</button><button class="btn danger" id="ok">确认封禁</button></div>`);
        document.getElementById('ok').onclick = async () => {
          try { await api.post('/api/admin/users/' + b.dataset.ban + '/ban', { reason: document.getElementById('rs').value, purgeDns: document.getElementById('pg').checked }); settingsFeedback('已封禁'); closeModal(); load(); }
          catch (e) { settingsFeedback(e.message, 'err'); }
        };
      });
      tb.querySelectorAll('[data-unban]').forEach((b) => b.onclick = async () => {
        try { await api.post('/api/admin/users/' + b.dataset.unban + '/unban', {}); settingsFeedback('已解封'); load(); } catch (e) { settingsFeedback(e.message, 'err'); }
      });
    }
  
    if (tab === 'locks') {
      const d = await api.get('/api/admin/locks');
      if (!d.items.length) return tb.innerHTML = `<tr><td colspan="5" class="empty">当前没有处于锁定状态的验证记录</td></tr>`;
      tb.innerHTML = d.items.map((r) => `
        <tr class="locked">
          <td class="mono">${esc(r.name)}</td>
          <td><span class="badge type">${esc(r.type)}</span></td>
          <td class="mono" style="color:var(--muted)">${esc(r.owner_email)}</td>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(r.locked_at)}</td>
          <td class="right nowrap">
            <button class="btn sm" data-unlock="${r.id}" data-keep="1">仅解锁</button>
            <button class="btn sm danger" data-unlock="${r.id}" data-keep="0">解锁并删除</button>
          </td>
        </tr>`).join('');
      tb.querySelectorAll('[data-unlock]').forEach((b) => b.onclick = async () => {
        try { await api.post('/api/records/' + b.dataset.unlock + '/force-unlock', { delete: b.dataset.keep !== '1' }); settingsFeedback('已强制解锁'); load(); }
        catch (e) { settingsFeedback(e.message, 'err'); }
      });
    }
  
    if (tab === 'ips') {
      const d = await api.get('/api/admin/ips');
      if (!d.items.length) {
        tb.innerHTML = `<tr><td colspan="6" class="empty">暂无注册 IP 记录</td></tr>`;
        return;
      }
      tb.innerHTML = d.items.map((r) => {
        const emails = (r.emails || '').split(',').filter(Boolean);
        const shown = emails.slice(0, 3).join('、') + (emails.length > 3 ? ` 等 ${emails.length} 个` : '');
        const badge = r.ipBanned
          ? `<span class="badge danger">IP 已封禁</span>`
          : r.overLimit
            ? `<span class="badge danger">超限</span>`
            : '<span class="badge ok">正常</span>';
        return `
        <tr class="${r.overLimit && !r.ipBanned ? 'locked' : ''}">
          <td class="mono">${esc(r.ip)}</td>
          <td><b>${r.accounts}</b> <span style="color:var(--muted)">/ ${d.limit}</span></td>
          <td class="mono" style="font-size:11.5px;max-width:280px">${esc(shown)}</td>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(r.last_at)}</td>
          <td>${badge}${r.banned_count ? `<div class="hint">已封 ${r.banned_count} 个</div>` : ''}</td>
          <td class="right nowrap">
            ${r.ipBanned
              ? `<button class="btn sm ok" data-ipunban="${esc(r.ip)}">解封 IP</button>`
              : `<button class="btn sm danger" data-ipban="${esc(r.ip)}" data-n="${r.accounts}">封禁全部</button>`}
          </td>
        </tr>`;
      }).join('');
  
      tb.querySelectorAll('[data-ipban]').forEach((b) => b.onclick = () => {
        const ip = b.dataset.ipban;
        openModal('封禁该 IP 下的全部账号', `
          <div class="alert danger">将封禁 <b>${ip}</b> 下的 ${b.dataset.n} 个账号：立即踢下线、停用其全部子域名。管理员账号不会被封。</div>
          <div class="field"><label>封禁原因</label><input id="ipr" value="同一 IP 注册账号超限，违反服务条款"></div>
          <label class="check" style="margin-bottom:8px"><input type="checkbox" id="ipb" checked> 同时封禁该 IP（禁止再注册/登录）</label>
          <label class="check" style="margin-bottom:14px"><input type="checkbox" id="ipp"> 同时清空其在 Cloudflare 上的全部 DNS 记录</label>
          <div class="row end">
            <button class="btn" onclick="closeModal()">取消</button>
            <button class="btn danger" id="ok">确认封禁</button>
          </div>`);
        document.getElementById('ok').onclick = async () => {
          try {
            const r = await api.post('/api/admin/ips/ban', {
              ip,
              reason: document.getElementById('ipr').value,
              banIp: document.getElementById('ipb').checked,
              purgeDns: document.getElementById('ipp').checked,
            });
            settingsFeedback(`已封禁 ${r.banned} 个账号` + (r.purged ? `，清空 ${r.purged} 条 DNS` : ''));
            closeModal(); load();
          } catch (e) { settingsFeedback(e.message, 'err'); }
        };
      });
      tb.querySelectorAll('[data-ipunban]').forEach((b) => b.onclick = async () => {
        try { await api.post('/api/admin/ips/unban', { ip: b.dataset.ipunban }); settingsFeedback('已解除 IP 封禁'); load(); }
        catch (e) { settingsFeedback(e.message, 'err'); }
      });
      return;
    }
  
    /* ── 数据备份：导出 CSV / JSON，遗失后可重新汇入 ──
       刻意两步：先 dryRun 预览（只算不写），管理员确认后才真正入库。 */
    if (tab === 'backup') {
      tb.innerHTML = `<tr><td colspan="2">
        <div style="display:grid;gap:14px;max-width:860px">
          <div class="card" style="padding:16px 18px">
            <div style="font-weight:800;font-size:15px;margin-bottom:6px">导出备份</div>
            <div class="hint" style="margin-bottom:12px">子域名与用户为 CSV 表，站点设置为 JSON。文件可下载保存，遗失时从下方重新汇入。</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
              <button class="btn sm" id="bkExpSubs">下载子域名 CSV</button>
              <button class="btn sm" id="bkExpUsers">下载用户 CSV</button>
              <button class="btn sm" id="bkExpSettings">下载站点设置 JSON</button>
              <label class="hint" style="display:inline-flex;align-items:center;gap:6px;margin:0;cursor:pointer">
                <input type="checkbox" id="bkMask" style="width:15px;height:15px">生成脱敏副本（隐藏凭据）
              </label>
            </div>
            <div class="hint" style="margin-top:10px">用户 CSV 含密码哈希，恢复后可原样登录；站点设置 JSON 默认包含全部凭据真值，遗失后可原样汇入，请加密保存。仅当要把文件发给别人排查时才勾选「生成脱敏副本」。JSON 里的 <code>emptyKeys</code> 是库中本来就没配置的项，不是导出丢值。</div>
          </div>

          <div class="card" style="padding:16px 18px">
            <div style="font-weight:800;font-size:15px;margin-bottom:6px">重新汇入</div>
            <div class="hint" style="margin-bottom:12px">先选文件点「预览」，确认统计数字后再点「确认汇入」。预览不会写入数据库。</div>
            <div style="display:grid;gap:10px;max-width:620px">
              <div class="field" style="margin:0"><label>备份文件</label><input type="file" id="bkFile" accept=".csv,.json,text/csv,application/json"></div>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <div class="field" style="margin:0;flex:1;min-width:170px"><label>数据类型</label>
                  <select id="bkKind">
                    <option value="auto">自动识别</option>
                    <option value="users">用户 CSV</option>
                    <option value="subdomains">子域名 CSV</option>
                    <option value="settings">站点设置 JSON</option>
                  </select>
                </div>
                <div class="field" style="margin:0;flex:1;min-width:170px"><label>汇入模式</label>
                  <select id="bkMode">
                    <option value="merge">只补缺失（推荐）</option>
                    <option value="replace">覆盖同名记录</option>
                  </select>
                </div>
              </div>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <button class="btn sm" id="bkPreview">预览</button>
                <button class="btn sm primary" id="bkConfirm" disabled>确认汇入</button>
              </div>
              <div id="bkResult" class="hint" style="white-space:pre-wrap;line-height:1.8"></div>
            </div>
            <div class="hint" style="margin-top:10px">安全边界：只认白名单列 / 配置键，所有字段逐个校验；「覆盖」也绝不改动现有用户密码哈希与角色；脱敏副本里的空密钥会被跳过，不会冲掉正在使用的配置；内部统计快照与迁移标记不导出、不汇入。单文件上限 2MB / 20000 行。汇入子域名前请先汇入用户，跨库时按邮箱重新对应归属。</div>
          </div>
          <div class="hint">导出是一次性全表读取，属低频手动操作；不要放进轮询或自动化脚本，避免无谓消耗 D1 读取额度。</div>
        </div>
      </td></tr>`;

      const $ = (id: string) => document.getElementById(id) as any;
      const result = $('bkResult');
      let pending: { kind: string; data: string; mode: string } | null = null;
      const invalidate = () => { pending = null; $('bkConfirm').disabled = true; };
      ['bkFile', 'bkKind', 'bkMode'].forEach((id) => $(id).addEventListener('change', invalidate));

      async function backupDownload(kind: string) {
        const masked = kind === 'settings' && !!$('bkMask').checked;
        const res = await fetch('/api/admin/backup/export/' + kind + (masked ? '?maskSecrets=1' : ''),
          { credentials: 'same-origin' });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.message || '导出失败');
        }
        const blob = await res.blob();
        const m = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = m ? m[1] : ('noxc-' + kind + (kind === 'settings' ? '.json' : '.csv'));
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        result.textContent = '已导出 ' + a.download + (masked ? '（脱敏副本，不能用于完整恢复）' : '（含全部凭据，请加密保存）');
      }
      for (const [id, kind] of [['bkExpSubs', 'subdomains'], ['bkExpUsers', 'users'], ['bkExpSettings', 'settings']] as const) {
        $(id).onclick = async () => {
          const b = $(id); b.disabled = true;
          try { await backupDownload(kind); } catch (e) { settingsFeedback((e as Error).message, 'err'); }
          finally { b.disabled = false; }
        };
      }

      function pickKind(name: string, data: string): string {
        const chosen = $('bkKind').value;
        if (chosen !== 'auto') return chosen;
        const n = String(name || '').toLowerCase();
        if (n.includes('settings') || data.trimStart().startsWith('{')) return 'settings';
        if (n.includes('subdomain')) return 'subdomains';
        if (n.includes('user')) return 'users';
        /* 靠表头兜底：用户表有 password_hash，子域名表有 fqdn */
        const head = data.replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
        if (head.includes('fqdn')) return 'subdomains';
        if (head.includes('password_hash') || head.includes('email')) return 'users';
        return '';
      }
      async function readFile(): Promise<{ kind: string; data: string; mode: string }> {
        const f = $('bkFile').files?.[0];
        if (!f) throw new Error('请先选择备份文件');
        if (f.size > 2 * 1024 * 1024) throw new Error('文件超过 2MB 上限');
        const data = await f.text();
        const kind = pickKind(f.name, data);
        if (!kind) throw new Error('无法识别文件类型，请在「数据类型」里手动选择');
        return { kind, data, mode: $('bkMode').value };
      }
      function renderReport(j: any, dry: boolean) {
        const lines = [
          (dry ? '预览（未写入）' : '汇入完成') + '：类型 ' + j.kind + ' · 模式 ' + j.mode,
          '共 ' + j.total + ' 条 → 新增 ' + j.insert + ' / 更新 ' + j.update + ' / 跳过 ' + j.skip,
        ];
        for (const s of (j.skipped || []).slice(0, 8)) lines.push('  第 ' + s.row + ' 条：' + s.reason);
        if ((j.skipped || []).length > 8) lines.push('  … 其余跳过项未逐一列出');
        for (const w of (j.warnings || [])) lines.push('  ' + w);
        lines.push(j.hint || '');
        result.textContent = lines.filter(Boolean).join('\n');
      }
      $('bkPreview').onclick = async () => {
        const b = $('bkPreview'); b.disabled = true; result.textContent = '正在预览…';
        try {
          pending = await readFile();
          const j = await api.post('/api/admin/backup/import/' + pending.kind,
            { data: pending.data, mode: pending.mode, dryRun: true });
          renderReport(j, true);
          $('bkConfirm').disabled = false;
        } catch (e) { invalidate(); settingsFeedback((e as Error).message, 'err'); result.textContent = ''; }
        finally { b.disabled = false; }
      };
      $('bkConfirm').onclick = async () => {
        if (!pending) return settingsFeedback('请先预览', 'err');
        if (!window.confirm('确认把这份备份汇入当前数据库？建议先在测试环境核对预览结果。')) return;
        const b = $('bkConfirm'); b.disabled = true; result.textContent = '正在汇入…';
        try {
          const j = await api.post('/api/admin/backup/import/' + pending.kind,
            { data: pending.data, mode: pending.mode, dryRun: false });
          renderReport(j, false);
          invalidate();
          settingsFeedback('汇入完成');
        } catch (e) { b.disabled = false; settingsFeedback((e as Error).message, 'err'); result.textContent = ''; }
      };
      return;
    }

    if (tab === 'settings') {
      const d = await api.get('/api/admin/settings');
      const s = d.items;
      tb.innerHTML = `
        <tr>
          <td style="width:88px;vertical-align:top">
            <img class="logo-preview" src="${esc(s.logo_url || '/img/logo.jpg')}" alt="logo">
            <div class="hint" style="margin-top:6px">当前预览</div>
          </td>
          <td>
            <div class="grid2" style="margin-bottom:10px">
              <div class="field" style="margin:0"><label>站点名称</label><input id="sName" value="${esc(s.site_name || 'Noxc')}" placeholder="Noxc"></div>
              <div class="field" style="margin:0"><label>Logo 地址</label><input id="sLogo" value="${esc(s.logo_url || '')}" placeholder="/img/logo.jpg"></div>
            </div>
            <div class="grid2" style="margin-bottom:12px">
              <div class="field" style="margin:0"><label>图标地址（favicon）</label><input id="sFav" value="${esc(s.favicon_url || '')}" placeholder="/favicon.ico"></div>
              <div class="field" style="margin:0"><label>站点公告</label><input id="sAnno" value="${esc(s.announcement || '')}" placeholder="留空则不显示"></div>
            </div>
            <div class="field">
              <label>页脚备案号（可选）</label>
              <textarea id="sFooterIcpHtml" rows="2" style="width:100%;resize:vertical" placeholder='&lt;a href="https://icp.gov.moe/?keyword=20269429" target="_blank"&gt;萌ICP备20269429号&lt;/a&gt;'>${esc(s.footer_icp_html || '')}</textarea>
              <div class="hint">直接粘贴备案链接 HTML，会显示在全站页脚 GitHub 链接旁边，电脑与手机端均可见。</div>
              <div class="hint">仅允许 a 标签文字链接，其它标签会被过滤；留空则隐藏。保存后立即生效，不用刷新。</div>
            </div>
            <div class="field">
              <label>页脚联系方式（可选）</label>
              <textarea id="sFooterContactHtml" rows="2" style="width:100%;resize:vertical" placeholder='&lt;a href="https://t.me/+cTDEQy_0HqcxZDVl" target="_blank"&gt;Telegram&lt;/a&gt;'>${esc(s.footer_contact_html || '')}</textarea>
              <div class="hint">直接粘贴联系链接 HTML，会显示在全站页脚 GitHub 链接旁边，电脑与手机端均可见。</div>
              <div class="hint">仅允许 a 标签文字链接，其它标签会被过滤；留空则隐藏。保存后立即生效，不用刷新。</div>
            </div>
            <div class="field">
              <label>同一 IP 最多注册账号数</label>
              <input id="sIpLimit" type="number" min="1" max="50" value="${esc(s.max_accounts_per_ip || '2')}" style="max-width:160px">
              <div class="hint">超出限制注册的账号，可在「同 IP 账号」页一键全部封禁。管理员账号不受影响。</div>
            </div>
            <div class="field">
              <label>注册邮箱规则</label>
              <select id="sEmailRule" style="max-width:420px">
                <option value="whitelist_edu"${(d.emailRule || 'whitelist_edu') === 'whitelist_edu' ? ' selected' : ''}>白名单邮箱 + 任何包含 "edu" 的邮箱（默认）</option>
                <option value="whitelist"${d.emailRule === 'whitelist' ? ' selected' : ''}>仅白名单邮箱（旧规则）</option>
                <option value="edu_only"${d.emailRule === 'edu_only' ? ' selected' : ''}>仅包含 "edu" 的邮箱（严格）</option>
                <option value="any"${d.emailRule === 'any' ? ' selected' : ''}>任意有效邮箱（全放开）</option>
              </select>
              <div class="hint">「包含 edu」按字面判定：邮箱地址任意位置出现这三个字符即放行，不区分大小写，本地部分与域名都算。白名单可用 ALLOWED_EMAIL_DOMAINS 扩展；本规则也可用 EMAIL_RULE 设默认值。修改后立即生效，已有账号不受影响。</div>
              <div class="hint mono" style="margin-top:4px">student@school.edu.cn · edu@gmail.com · me@myedu.org</div>
            </div>
            <div class="field">
              <label>域名有效期</label>
              <div class="grid2">
                <div><span class="dim">新域名有效期（天）</span><input id="sValidDays" type="number" min="1" max="3650" value="365"></div>
                <div><span class="dim">续期窗口（天，留空 = 有效期一半）</span><input id="sRenewWindow" type="number" min="0" max="3650" value="" placeholder="自动"></div>
              </div>
              <div class="hint">有效期剩余少于一半即可续期，窗口默认自动取有效期的一半（改有效期会跟着变）；需要固定天数才在这里填，留空则一直自动。迁移前已注册的域名已设为永久有效，不追溯有效期。</div>
            </div>
            <div class="field">
              <label>DNS 提供商 API（可选 · 突破 200 条记录限制）</label>
              <div class="field" style="margin:0 0 8px">
                <span class="dim">API URL</span>
                <input id="sDnsUrl" type="text" autocomplete="off" placeholder="https://api.example.com/v1">
                <div class="hint">留空则使用 Cloudflare（免费版单区域上限约 200 条记录）。
                  填写后所有 DNS 读写走该接口；支持 <span class="mono">{zone}</span> 占位符，例如
                  <span class="mono">https://api.example.com/zones/{zone}/dns_records</span>。</div>
              </div>
              <div class="grid2">
                <div><span class="dim">API Key</span><input id="sDnsKey" type="text" autocomplete="off" placeholder="留空则不修改"></div>
                <div><span class="dim">API Secret</span><input id="sDnsSecret" type="password" autocomplete="new-password" placeholder="留空则不修改"></div>
              </div>
              <div class="hint" id="dnsProvHint"></div>
            </div>
            <div class="field">
              <label>邮件服务与验证码（Resend / Brevo）</label>
              <div class="grid2">
                <div>
                  <span class="dim">服务商</span>
                  <select id="sMailProvider">
                    <option value="">未启用</option>
                    <option value="resend">Resend</option>
                    <option value="brevo">Brevo</option>
                  </select>
                </div>
                <div><span class="dim">发件人邮箱</span><input id="sMailFrom" placeholder="verify@meoy.top"></div>
              </div>
              <div class="field" style="margin:8px 0 0">
                <span class="dim">API Key</span>
                <input id="sMailKey" type="password" autocomplete="new-password" placeholder="留空则不修改">
                <div class="hint" id="mailHint">发件人需先在服务商处完成域名验证（SPF / DKIM）。</div>
              </div>
              <label class="check" style="margin:8px 0 0">
                <input type="checkbox" id="sMailVerifyRequired">
                <span>注册账号需要邮箱验证码</span>
              </label>
              <div class="hint">未配置邮件服务时，忘记密码验证码功能不可用（会提示联系管理员）。</div>
            </div>
            <div class="field">
              <label>R2 头像公网地址（可选）</label>
              <input id="sR2PublicUrl" placeholder="https://img.meoy.top">
              <div class="hint">留空则头像通过 <span class="mono">/api/avatar/&lt;key&gt;</span> 由 Worker 代理读取（桶无需公开）。
                填写后上传的头像直接外链到该地址，可省 Worker 流量。当前状态：<span id="r2Hint" class="dim">读取中…</span></div>
            </div>
            <div class="field">
              <label>AI 自动审核</label>
              <label class="check" style="margin:0 0 8px">
                <input type="checkbox" id="sAiEnabled">
                <span>启用自动审核（仅对下方根域名生效；通过后无需管理员同意）</span>
              </label>
              <div class="grid2" id="aiConfigGrid" style="margin-bottom:8px">
                <div>
                  <span class="dim">审核服务</span>
                  <select id="sAiProvider" style="margin-top:6px">
                    <option value="custom">自定义 API（OpenAI 兼容网关）</option>
                    <option value="workers-ai">Workers AI（Cloudflare 内置，免 Key）</option>
                  </select>
                </div>
                <div id="aiWorkersHint" style="display:none">
                  <span class="dim">Workers AI 说明</span>
                  <div class="hint" style="margin:4px 0 0">走 <span class="mono">env.AI.run</span>，不需要 API Key、接口地址或端点探测；需在 <span class="mono">wrangler.toml</span> 配置 <span class="mono">[ai] binding = "AI"</span> 并重新部署。</div>
                </div>
              </div>
              <div class="grid2" id="aiProviderGrid">
                <div id="aiUrlBlock">
                  <span class="dim">接口地址 / Base URL（如 https://host/v1）</span>
                  <input id="sAiUrl" placeholder="https://apihub.agnes-ai.com/v1">
                  <select id="sAiEndpointMode" style="margin-top:6px">
                    <option value="auto">自动：优先 /chat/completions，失败再试其它端点</option>
                    <option value="direct">强制直连：只 POST 填写地址本身（多数网关会 404）</option>
                    <option value="standard">标准 OpenAI：只试 /chat/completions 与 /responses</option>
                  </select>
                </div>
                <div>
                  <span class="dim">审核模型（探测后自动选择，可改选）</span>
                  <input id="sAiModel" placeholder="保存后自动探测 /models">
                  <select id="sAiModelList" style="margin-top:6px"><option value="">— 尚未探测 —</option></select>
                </div>
              </div>
              <div class="field" id="aiKeyBlock" style="margin:8px 0 0">
                <span class="dim">API Key</span>
                <input id="sAiKey" type="password" autocomplete="new-password" placeholder="留空则不修改">
                <div class="hint" id="aiHint">读取中…</div>
              </div>
              <div class="grid2" style="margin-top:8px">
                <div><span class="dim">自动审核的根域名（填 * = 全部）</span><input id="sAiRoots" placeholder="v-1.top"></div>
                <div><span class="dim">不限 DNS 记录数的根域名</span><input id="sAiDnsRoots" placeholder="v-1.top"></div>
              </div>
              <div class="hint"><b>注意：名单里的根域名必须和你实际申请时选的后缀一致</b>；只填了 <span class="mono">v-1.top</span> 时，在 <span class="mono">meoy.top</span> 下申请不会触发 AI。想对所有后缀生效就填 <span class="mono">*</span>。另外 AI 已不再依赖全局「需要审核」开关，即使设为免审核也会照常判定。</div>
              <div class="hint">密钥只存数据库或 Worker Secret <span class="mono">AI_API_KEY</span>，不会写进代码库；后台与公开接口都只回显掩码。审核时会把「AI，你好，你现在要帮我审核一个子域名申请，域名是…，理由：…」发给下面选定的模型，按 <span class="mono">PASS / REJECT</span> 判定。AI 未配置、超时或返回异常时，申请自动回落为人工审核。</div>
              <div class="hint" id="aiModelHint" style="margin:6px 0 0">填好地址与 Key 后点「保存」会自动探测 /models，请从返回的清单里选模型（大小写要一致）。Base URL 本身不是端点，直接 POST 通常返回 404。</div>
              <div class="row" style="gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
                <button class="btn sm" id="aiProbeBtn" type="button">探测模型</button>
                <button class="btn sm ghost" id="aiTestBtn" type="button">用此模型测试审核</button>
                <button class="btn sm ghost" id="aiDiagBtn" type="button">一键诊断</button>
                <span class="hint" id="aiTestResult" style="margin:0">每个端点独立超时，成功的地址会被记住后续复用。诊断会列出网关返回的真实模型清单。</span>
              </div>
              <div class="row" style="gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
                <button class="btn sm ghost" id="aiBatchBtn" type="button">立即审核所有待审域名</button>
                <button class="btn sm ghost" id="aiBatchResetBtn" type="button">重试全部（清零失败计数）</button>
                <span class="hint" id="aiBatchHint" style="margin:0">每小时整点自动审核；有新申请时也会立即审核全部待审域名。</span>
              </div>
              <pre class="mono" id="aiDiagOut" style="display:none;white-space:pre-wrap;font-size:12px;line-height:1.7;background:var(--surface-2,#f6f8fc);padding:12px;border-radius:10px;margin:10px 0 0;max-height:260px;overflow:auto"></pre>
            </div>
            <div class="field">
              <label>滥用举报渠道（外部域名 WHOIS 展示）</label>
              <div class="grid2">
                <div><span class="dim">投诉邮箱</span><input id="sAbuseEmail" placeholder="abuse@meoy.top"></div>
                <div><span class="dim">在线举报入口 URL</span><input id="sAbuseUrl" placeholder="https://..."></div>
              </div>
              <div class="hint">查询外部域名并识别到托管平台时，结果下方会展示「滥用与违规举报通道」区块。</div>
            </div>
            <div class="field">
              <label>托管面板域名（CNAME 识别）</label>
              <div class="grid2">
                <div><span class="dim">面板域名</span><input id="sPanelDomain" placeholder="dash.domain.meoy.top"></div>
                <div><span class="dim">显示名称</span><input id="sPanelName" placeholder="Noxc 面板"></div>
              </div>
              <div class="hint">外部域名 WHOIS 会探测 CNAME 指向；指向该域名时显示你设定的名称（如
                <span class="mono">meoy.top CNAME dash.domain.meoy.top</span> → 显示「Noxc 面板」）。
                Vercel / Netlify / GitHub Pages 等常见平台自动识别，无需配置。</div>
            </div>
            <div class="field">
              <label>DNSHE API 凭证（查询 DNSHE 系域名）</label>
              <div class="grid2">
                <div><span class="dim">API Key</span><input id="sDnsheKey" type="text" autocomplete="off" placeholder="cfsd_..."></div>
                <div><span class="dim">API Secret</span><input id="sDnsheSecret" type="password" autocomplete="new-password" placeholder="留空则不修改"></div>
              </div>
              <div class="hint" id="dnsheHint"></div>
            </div>
            <div class="field">
              <label>AnyNS（n.ht 社区）· 站点级 DNS 管理 API</label>
              <div class="hint" style="margin-bottom:10px">
                填入 anyns.io 面板创建的 <b>管理令牌</b>（<span class="mono">nhtdns_</span> 开头）后，
                下面「生效根域名」的 DNS 记录会直接写进 AnyNS 的 zone，用户无需自带 key。
                DDNS / ACME 令牌不能用于管理接口。令牌只存服务端，页面只回掩码；
                Worker Secret <span class="mono">ANYNS_API_TOKEN</span> 优先级更高。
                <b>保存后到下方「根域名管理」点「从 AnyNS 拉取域名」</b>，勾选即可把域名添加或切换为 AnyNS 后端。
              </div>
              <div style="margin-bottom:8px">
                <span class="dim">管理令牌</span>
                <input id="sAnynsToken" type="password" autocomplete="new-password" placeholder="留空则不修改">
              </div>
              <div class="grid2" style="margin-bottom:8px">
                <div><span class="dim">生效根域名（逗号分隔，默认 meoy.top）</span><input id="sAnynsRoots" type="text" autocomplete="off" placeholder="meoy.top"></div>
                <div><span class="dim">Zone ID（可选，留空则按域名自动查）</span><input id="sAnynsZoneId" type="text" autocomplete="off" placeholder="4821"></div>
              </div>
              <div style="margin-bottom:8px">
                <span class="dim">多根 Zone 映射（可选）</span>
                <input id="sAnynsZoneIds" type="text" autocomplete="off" placeholder="meoy.top:4821,noxc.uk:4822">
              </div>
              <label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px">
                <input id="sAnynsClearToken" type="checkbox"> 清除已保存的令牌
              </label>
              <div class="hint" style="margin:10px 0 8px;border-top:1px solid var(--zx-hair);padding-top:10px">
                <b>「暂停解析」维护开关</b>：meoy.top 迁移已完成，<b>保持第一格留空即全部正常解析</b>。
                以后需要临时冻结某个后缀时再填（该后缀的子域名会显示「暂停解析」并暂停用户编辑 DNS 记录），
                <b>清空即一次性恢复</b>，不用改数据库。
              </div>
              <div class="grid2">
                <div><span class="dim">暂停解析根域名（留空 = 全部恢复）</span><input id="sDnsPausedRoots" type="text" autocomplete="off" placeholder="留空 = 解析正常"></div>
                <div><span class="dim">维护提示文案（可选）</span><input id="sMigrationNotice" type="text" autocomplete="off" placeholder="仅暂停时显示"></div>
              </div>
              <div class="hint" id="dnsPauseStateHint"></div>
              <div class="hint" id="anynsHint"></div>
            </div>

            <div class="field" id="externalSettingsCard">
              <label>第三方域名接入 · 固定 SEUS DNS</label>
              <div class="hint" style="margin-bottom:10px">
                <b>就这一个框，保存即生效</b>：填 s.eus 账户设置里生成的
                <span class="mono">mbt_</span> MCP Token（需 dns:read / dns:write），
                不用配环境变量、不用改 Worker Secret、不用重新部署。
                <b>留空也能用</b>：用户点「用 API 连接」时可临时填自己的 Token，
                仅本次请求使用、不保存。Zone 会按域名自动查，无需手动映射。
              </div>
              <div style="margin-bottom:8px">
                <span class="dim">SEUS MCP Token（唯一配置项）</span>
                <input id="sSeusToken" type="password" autocomplete="new-password" placeholder="mbt_...（留空则不修改）">
              </div>
              <label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px">
                <input id="sSeusClearToken" type="checkbox"> 清除已保存的令牌
              </label>
              <div class="hint" style="margin:8px 0 10px">
                接入流程：用户填自己的完整域名（<b>只允许 gTLD 二级域，如 xxx.com</b>；不接受
                <span class="mono">xxx.example.com</span> 这类子域名）→ 把注册商 NS 指向
                <span class="mono">a.ns.fs5.net / b.ns.fs5.net</span> 并在 s.eus 完成托管 →
                用 SEUS API 连接 → <b>你在下方审批列表里批准</b>。
                批准后该域名成为根域名，DNS 后端<b>锁死 SEUS</b>，下方「根域名管理」里不能切换。
              </div>
              <div class="hint" id="seusHint"></div>
              <div class="hint" style="margin:10px 0 8px;border-top:1px solid var(--zx-hair);padding-top:10px">
                <b>接入申请</b>：待审核排在最前；只有「SEUS 已连接」的申请可以批准。
              </div>
              <div class="tablewrap" id="externalReqBox"><div class="hint">载入中…</div></div>
            </div>

            <div class="field">
              <label>保留域名</label>
              <div><span class="dim">额外保留名称</span><input id="sReservedLabels" type="text" autocomplete="off" placeholder="例如：pay,live,lab" value="${esc(s.reserved_labels || '')}"></div>
              <div class="hint">系统基线始终生效，包含 ai、dash、nic、www、mail、admin、whois 等，不能在这里删除。</div>
              <div class="hint">用逗号分隔，保存后立即生效，无需重新部署；管理员仍可自建保留名称。留空表示只使用系统基线。</div>
            </div>
            <div class="field">
              <label>注册验证</label>
              <div><label class="check" style="margin-top:2px"><input type="checkbox" id="sCaptchaEnabled" ${String(s.captcha_enabled ?? '1') !== '0' ? 'checked' : ''}> 注册域名前需要完成滑块拼图验证</label></div>
              <div style="margin-top:8px"><span class="dim">验证图库</span><input id="sCaptchaImages" type="text" autocomplete="off" placeholder="typhoon,meoy,miku,cloud" value="${esc(s.captcha_images || 'typhoon,meoy,miku,cloud')}"></div>
              <div class="hint">可选 typhoon / meoy / miku / cloud，逗号分隔，随机抽一张；留空恢复全部。管理员自建域名不经过验证，关闭后全链路放行。</div>
            </div>
            <div class="field">
              <label>第三方登录 · NodeLoc</label>
              <div><label class="check" style="margin-top:2px"><input type="checkbox" id="sNodelocEnabled" ${String(s.nodeloc_enabled ?? '0') === '1' ? 'checked' : ''}> 登录页显示「使用 NodeLoc 登录」</label></div>
              <div class="grid2" style="margin-top:8px">
                <div><span class="dim">Client ID</span><input id="sNodelocClientId" type="text" autocomplete="off" placeholder="应用管理页复制" value="${esc(s.nodeloc_client_id || '')}" ${d.nodeloc?.fromEnv ? 'disabled' : ''}></div>
                <div><span class="dim">Client Secret</span><input id="sNodelocClientSecret" type="password" autocomplete="new-password" placeholder="${d.nodeloc?.secretSet ? '已配置 ' + esc(d.nodeloc.secretMasked) + '（留空不修改）' : '留空则不修改'}" ${d.nodeloc?.fromEnv ? 'disabled' : ''}></div>
              </div>
              <div class="hint">在 <a href="https://www.nodeloc.com/oauth-provider/applications" target="_blank" rel="noopener">NodeLoc 应用管理页</a> 创建应用（需黄金会员 TL2 及以上）。回调 URI 必须逐字符填：<b>${esc(d.nodeloc?.callbackUrl || '/oauth/nodeloc/callback')}</b></div>
              <div style="margin-top:8px">
                <label class="check"><input type="checkbox" id="sNodelocAutoRegister" ${String(s.nodeloc_auto_register ?? '1') !== '0' ? 'checked' : ''}> 首次登录自动创建本地账号</label>
                <div class="hint" style="margin-top:6px">email 权限为必需项（恒开）：账号邮箱直接用 NodeLoc 返回的真实邮箱，不再生成内部乱码地址。请在 <a href="https://www.nodeloc.com/oauth-provider/applications" target="_blank" rel="noopener">NodeLoc 应用管理页</a> 为应用勾选 email 权限。</div>
              </div>
              <div style="margin-top:8px"><span class="dim">自定义回调地址（可选）</span><input id="sNodelocRedirectUri" type="text" autocomplete="off" placeholder="留空则使用上方地址" value="${esc(s.nodeloc_redirect_uri || '')}"></div>
              <div class="hint">关闭自动建号后，访客需先用邮箱注册，再到「个人资料 → 第三方账号」绑定。状态：<span>${d.nodeloc?.ready ? '已就绪' : '未就绪（需开启并填齐 Client ID / Secret）'}</span>${d.nodeloc?.fromEnv ? ' · 凭据来自 Worker 环境变量，后台只读' : ''}</div>
              <div class="hint">Secret 只保存在服务端，页面只显示掩码。</div>
            </div>
            <div class="field">
              <label>第三方登录 · GitHub</label>
              <div><label class="check" style="margin-top:2px"><input type="checkbox" id="sGithubEnabled" ${String(s.github_enabled ?? '0') === '1' ? 'checked' : ''}> 启用 GitHub 登录与「个人资料 → 绑定 GitHub」</label></div>
              <div class="grid2" style="margin-top:8px">
                <div><span class="dim">Client ID</span><input id="sGithubClientId" type="text" autocomplete="off" placeholder="OAuth App 的 Client ID" value="${esc(s.github_client_id || '')}" ${d.github?.fromEnv ? 'disabled' : ''}></div>
                <div><span class="dim">Client Secret</span><input id="sGithubClientSecret" type="password" autocomplete="new-password" placeholder="${d.github?.secretSet ? '已配置 ' + esc(d.github.secretMasked) + '（留空不修改）' : '留空则不修改'}" ${d.github?.fromEnv ? 'disabled' : ''}></div>
              </div>
              <div class="hint">在 <a href="https://github.com/settings/developers" target="_blank" rel="noopener">GitHub → Developer settings → OAuth Apps</a> 创建应用。回调 URI 必须逐字符填：<b>${esc(d.github?.callbackUrl || '/oauth/github/callback')}</b>；授权 scope 需要 <span class="mono">read:user user:email public_repo</span>（最后一项用于校验 Star）。</div>
              <div class="grid2" style="margin-top:8px">
                <div><span class="dim">Star 奖励仓库（owner/repo）</span><input id="sGithubStarRepo" type="text" autocomplete="off" placeholder="wcvjk8tnz8-create/Noxc" value="${esc(s.github_star_repo || 'wcvjk8tnz8-create/Noxc')}"></div>
                <div><span class="dim">Star 后奖励配额</span><input id="sGithubStarBonus" type="number" min="0" max="100" step="1" value="${esc(s.github_star_bonus ?? '5')}"></div>
              </div>
              <div class="hint">用户绑定 GitHub 后，在个人资料里点「领取 Star 奖励」；后端实时向 GitHub 校验确实点了 Star，每个本地账号只能领一次，奖励直接加到域名配额上。绑定本身不加配额。</div>
              <div style="margin-top:8px">
                <label class="check"><input type="checkbox" id="sGithubAutoRegister" ${String(s.github_auto_register ?? '1') !== '0' ? 'checked' : ''}> 首次用 GitHub 登录时自动创建本地账号</label>
              </div>
              <div style="margin-top:8px"><span class="dim">自定义回调地址（可选，须 https）</span><input id="sGithubRedirectUri" type="text" autocomplete="off" placeholder="留空则使用上方地址" value="${esc(s.github_redirect_uri || '')}"></div>
              <div class="hint">状态：<span>${d.github?.ready ? '已就绪' : '未就绪（需开启并填齐 Client ID / Secret）'}</span>${d.github?.fromEnv ? ' · 凭据来自 Worker 环境变量，后台只读' : ''}。Secret 与用户 access_token 只保存在服务端，页面只显示掩码。</div>
            </div>
            <div class="field">
              <label>用户配额</label>
              <div class="grid2">
                <div><span class="dim">新用户默认配额</span><input id="sDefaultQuota" type="number" min="-1" max="10000" step="1" value="${esc(s.default_quota ?? '5')}"></div>
                <div><span class="dim">同步到现有普通用户</span><label class="check" style="margin-top:6px"><input type="checkbox" id="sApplyQuota"> 覆盖所有现有普通用户的单独配额</label></div>
              </div>
              <div class="hint">填 -1 = 不限量；0 = 不允许申请。只影响新注册用户；勾选同步会覆盖所有现有普通用户的单独配额（管理员始终不限）。</div>
            </div>
            <div class="field">
              <label>积分规则</label>
              <div class="grid2">
                <div><span class="dim">每日签到奖励</span><input id="sCheckin" type="number" min="0" max="1000" value="${esc(pick(s.checkin_points, POINT_DEFAULTS.checkin))}"></div>
                <div><span class="dim">新用户初始积分</span><input id="sInitial" type="number" min="0" max="10000" value="${esc(pick(s.initial_points, POINT_DEFAULTS.initial))}"></div>
                <div><span class="dim">申请子域名消耗</span><input id="sCost" type="number" min="0" max="10000" value="${esc(pick(s.domain_cost, POINT_DEFAULTS.domainCost))}"></div>
                <div><span class="dim">单字域名消耗</span><input id="sShortCost" type="number" min="0" max="100000" value="${esc(pick(s.short_domain_cost, POINT_DEFAULTS.shortCost))}"></div>
              </div>
              <div style="margin-top:8px"><span class="dim">用户案例展示奖励积分（每账号一次性）</span><input id="sShowcaseReward" type="number" min="0" max="100000" value="${esc(pick(s.showcase_reward_points, SHOWCASE_REWARD_POINTS))}"></div>
              <div style="margin-top:8px"><span class="dim" data-en="Combo task reward points (once per account)">组合任务奖励积分（NodeLoc 绑定 + Star，每账号一次性）</span><input id="sComboReward" type="number" min="0" max="${COMBO_REWARD_CAP}" value="${esc(pick(s.combo_reward_points, COMBO_REWARD_POINTS))}"></div>
              <div class="hint">「单字域名长度上限」= ${esc(pick(s.short_domain_len, POINT_DEFAULTS.shortLen))}（长度不超过该值即按单字计价）。管理员不消耗积分。老用户首次进入按已有域名数补偿，已有域名不受影响。填 0 = 免费，保存后原样显示。用户首次把已开通域名开启「用户案例展示」即发放上面的奖励，关闭展示不回收、重复开启不叠加；填 0 = 关闭该奖励。</div>
            </div>
            <div class="field">
              <label>按根域名设置申请积分</label>
              <div class="grid2" id="rootCostsBox">
                ${(Array.isArray(d.rootDomains) ? d.rootDomains : []).map(function(r){
                  var rc = d.rootPointCosts || {};
                  var has = Object.prototype.hasOwnProperty.call(rc, r);
                  return '<div><span class="dim">.' + esc(String(r).toUpperCase()) + '</span>'
                    + '<input class="root-cost-input" data-root="' + esc(r) + '" type="number" min="0" max="100000" step="1" value="' + esc(has ? String(rc[r]) : '') + '" placeholder="留空 = 按全局规则"></div>';
                }).join('') || '<div class="hint">当前没有生效的根域名</div>'}
              </div>
              <div class="hint">可为 <b>0</b>（该后缀免费，普通用户也不扣分）；留空则按上方全局规则（含单字加价）。填写后该后缀下所有申请统一按此积分计算，单字域名不再额外加价。两个后缀可以分别设成不同数值、也可以一个免费一个收费。</div>
            </div>
            <div class="field">
              <label>按根域名设置每人注册次数</label>
              <div class="grid2" id="rootRegLimitsBox">
                ${(Array.isArray(d.rootDomains) ? d.rootDomains : []).map(function(r){
                  var rl = d.rootRegLimits || {};
                  var has = Object.prototype.hasOwnProperty.call(rl, r);
                  return '<div><span class="dim">.' + esc(String(r).toUpperCase()) + '</span>'
                    + '<input class="root-reg-limit-input" data-root="' + esc(r) + '" type="number" min="-1" max="10000" step="1" value="' + esc(has ? String(rl[r]) : '') + '" placeholder="留空 = 不限制"></div>';
                }).join('') || '<div class="hint">当前没有生效的根域名</div>'}
              </div>
              <div class="hint">填 <b>1</b> = 每人只能注册该后缀一次；填 <b>-1</b> = 每人无限次；<b>0</b> = 禁止申请该后缀；留空 = 不限制。按累计申请次数计，释放域名不退还次数；从设置生效后开始累计，<b>已注册用户与已有域名不受影响</b>。管理员开通不受限。</div>
            </div>
            <div class="field">
              <label>按后缀单独暂停新申请</label>
              <div class="grid2" id="rootApplyPausedBox">
                ${(Array.isArray(d.rootDomains) ? d.rootDomains : []).map(function(r){
                  var paused = (d.rootApplyPaused || []).indexOf(String(r).toLowerCase()) >= 0;
                  var forced = d.rootApplyPausedFromEnv && (d.rootApplyPaused || []).indexOf(String(r).toLowerCase()) >= 0;
                  return '<label class="check"><input type="checkbox" class="root-apply-paused-input" data-root="' + esc(r) + '"'
                    + (paused ? ' checked' : '') + (forced ? ' disabled' : '') + '><span>.' + esc(String(r).toUpperCase()) + ' 暂停申请</span></label>';
                }).join('') || '<div class="hint">当前没有生效的根域名</div>'}
              </div>
              <div class="hint">勾选后<b>只有该后缀不再接受新的域名申请</b>，其它后缀照常开放。首页后缀卡片标「暂停申请」、注册页切到该后缀会锁定并提示。<b>已注册域名的 DNS 记录、续期、转移、展示与签到全部不受影响</b>；WHOIS 仍可查询；管理员仍可自建。${d.rootApplyPausedFromEnv ? '<br><span class="badge warn">部分后缀由环境变量 ROOT_APPLY_PAUSED 强制暂停，后台不可取消。</span>' : ''}</div>
            </div>
            <div class="field">
              <label>全局字体（中文字体）</label>
              <div class="grid2">
                <div>
                  <span class="dim">正文字体</span>
                  <select id="sFontBody">
                    <option value="system"${(s.font_body || 'system') === 'system' ? ' selected' : ''}>系统默认（苹方 / 微软雅黑）</option>
                    <option value="noto"${s.font_body === 'noto' ? ' selected' : ''}>思源黑体 Noto Sans SC</option>
                    <option value="lxgw"${s.font_body === 'lxgw' ? ' selected' : ''}>霞鹜文楷 LXGW WenKai</option>
                    <option value="zcool"${s.font_body === 'zcool' ? ' selected' : ''}>站酷快乐体（圆润，偏标题）</option>
                  </select>
                </div>
                <div>
                  <span class="dim">标题字体</span>
                  <select id="sFontDisplay">
                    <option value="zcool"${(s.font_display || 'zcool') === 'zcool' ? ' selected' : ''}>站酷快乐体（圆润活泼）</option>
                    <option value="system"${s.font_display === 'system' ? ' selected' : ''}>系统默认（苹方 / 微软雅黑）</option>
                    <option value="noto"${s.font_display === 'noto' ? ' selected' : ''}>思源黑体 Noto Sans SC</option>
                    <option value="lxgw"${s.font_display === 'lxgw' ? ' selected' : ''}>霞鹜文楷 LXGW WenKai</option>
                  </select>
                </div>
              </div>
              <div class="hint">全局生效：前台、WHOIS、管理后台、条款页全部应用。拉丁字母与数字始终使用 Redaction 35（像素感），中文字体只接管中文字符。切换后刷新页面即可看到。</div>
            </div>
            <div class="field">
              <label>WHOIS 持有人邮箱</label>
              <select id="sWhois" style="max-width:260px">
                <option value="masked"${(s.whois_holder || 'masked') === 'masked' ? ' selected' : ''}>脱敏显示（ab***@gmail.com）</option>
                <option value="none"${s.whois_holder === 'none' ? ' selected' : ''}>不显示</option>
                <option value="full"${s.whois_holder === 'full' ? ' selected' : ''}>完整公开</option>
              </select>
              <div class="hint">本人与管理员始终可见完整地址，不受此项影响。</div>
            </div>
            <div class="field">
              <label>Spaceship 域名注册商（自动发现域名）</label>
              <div class="grid2">
                <div><span class="dim">API 地址</span><input id="sSpUrl" placeholder="https://spaceship.dev/api"></div>
                <div><span class="dim">API Key</span><input id="sSpKey" type="text" autocomplete="off" placeholder="留空则不修改"></div>
              </div>
              <div class="field" style="margin:8px 0 0">
                <span class="dim">API Secret</span><input id="sSpSecret" type="password" autocomplete="new-password" placeholder="留空则不修改">
                <div class="hint" id="spHint">在 Spaceship → API Manager 创建 Key（需 domains 读取权限）。本站只读取域名列表，不注册、不续费、不改 NS。</div>
              </div>
              <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
                <button class="btn sm" id="spTest" type="button">测试连接</button>
                <button class="btn sm primary" id="spFetch" type="button">拉取我的域名</button>
              </div>
              <div class="hint" id="spRoots" style="margin-top:8px">当前根域名：读取中…</div>
            </div>
            <div class="field">
              <label>新域名申请开关</label>
              <label class="check"><input type="checkbox" id="sApplyPaused"${d.applyPaused ? ' checked' : ''}${d.applyPausedFromEnv ? ' disabled' : ''}><span>暂停新域名申请</span></label>
              <div class="hint">暂停后普通用户无法提交新的子域名申请（注册页会锁定并展示下方提示语）；<b>已注册域名的 DNS 记录、续期、转移等全部不受影响</b>，管理员仍可自建域名。${d.applyPausedFromEnv ? '<br><span class="badge warn">已由环境变量 APPLY_PAUSED 强制开启，后台不可修改。</span>' : ''}</div>
              <div style="margin-top:8px"><span class="dim">暂停提示语（留空用默认文案）</span><input id="sApplyPausedMsg" maxlength="200" placeholder="站点已暂停新域名申请，请稍后再试。" value="${esc(d.applyPausedMessage || '')}"></div>
            </div>
            <div class="field">
              <label>根域名管理</label>
              <div id="rootAdmin" style="margin:2px 0 8px">读取中…</div>
              <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 8px">
                <button class="btn sm" id="anFetch" type="button">从 AnyNS 拉取域名</button>
                <span class="dim" style="font-size:12px">用「站点设置 → AnyNS」里的管理令牌拉取账号下的解析区域，勾选后即可添加为根域名或切换为 AnyNS 后端</span>
              </div>
              <div class="hint">「移除」后该后缀立即从注册页、WHOIS 与 DNS 中消失，<b>无需重新部署</b>：后台导入的直接删除，环境变量配置的写入屏蔽名单，可随时点「恢复」。已注册在该根域名下的子域名不会被删除。至少要保留一个根域名。每行右侧下拉可把该后缀的 DNS 写入后端切到 <b>AnyNS / Cloudflare / Spaceship</b>。</div>
            </div>
            <div class="alert info" style="margin-bottom:12px">
              Logo 可以是站内路径（<span class="mono">/img/logo.jpg</span>）或外链图片地址（<span class="mono">https://…</span>）。
              想换成本地图，把图片放进仓库的 <span class="mono">public/img/</span> 再推一次即可。<br>
              图标建议用 <span class="mono">.ico</span>（兼容最好，浏览器默认会请求 <span class="mono">/favicon.ico</span>），
              也可以用 <span class="mono">.png</span>。
            </div>
            <div class="row">
              <button class="btn primary" id="saveSet">保存</button>
              <button class="btn" id="resetLogo">恢复默认 Logo</button>
              <button class="btn ghost" id="reloadLogo">刷新预览</button>
            </div>
          </td>
        </tr>`;
      /* AI 模型探测：填好地址 / Key → 拉 /models → 自动选定一个 → 下拉改选。
         useTyped=true 时把「还没保存」的 Key 临时带上去探测，但不写进数据库。 */
      const aiModelHint = document.getElementById('aiModelHint');
      const aiModelList = document.getElementById('sAiModelList') as HTMLSelectElement | null;
      const aiModelInput = document.getElementById('sAiModel') as HTMLInputElement | null;

      /* 审核服务联动：Workers AI 不需要地址 / Key / 端点模式，隐藏它们，
         并把模型清单直接换成 Cloudflare 内置模型；自定义网关则反之。 */
      const syncAiProvider = (p?: string, workersModels?: string[]): boolean => {
        const sel = document.getElementById('sAiProvider') as HTMLSelectElement | null;
        const provider = p || sel?.value || 'custom';
        if (sel) sel.value = provider;
        const isWorkers = provider === 'workers-ai';
        const show = (id: string, visible: boolean) => {
          const el = document.getElementById(id);
          if (el) el.style.display = visible ? '' : 'none';
        };
        show('aiUrlBlock', !isWorkers);
        show('aiKeyBlock', !isWorkers);
        show('aiWorkersHint', isWorkers);
        const grid = document.getElementById('aiProviderGrid');
        if (grid) grid.style.gridTemplateColumns = isWorkers ? '1fr' : '';
        if (aiModelInput) {
          aiModelInput.placeholder = isWorkers
            ? '保存后自动选择 Workers AI 模型' : '保存后自动探测 /models';
        }
        if (aiModelHint) {
          aiModelHint.textContent = isWorkers
            ? 'Workers AI 使用 Cloudflare 内置模型，点「探测模型」可即时列出（无需联网、无需 Key）。'
            : '填好地址与 Key 后点「保存」会自动探测 /models，请从返回的清单里选模型（大小写要一致）。Base URL 本身不是端点，直接 POST 通常返回 404。';
        }
        const keyHint = document.getElementById('aiHint');
        if (isWorkers && keyHint) {
          keyHint.innerHTML = '<span class="badge ok">无需配置</span> Workers AI 直接调用 Cloudflare 绑定，不读取 API Key。';
        }
        if (isWorkers && aiModelList && workersModels && workersModels.length) {
          const cur = aiModelList.value;
          aiModelList.innerHTML = '<option value="">— 选择模型 —</option>'
            + workersModels.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
          if (workersModels.includes(cur)) aiModelList.value = cur;
        }
        const testResult = document.getElementById('aiTestResult');
        if (testResult) {
          testResult.textContent = isWorkers
            ? '自检直接调用 env.AI.run，无外部网络请求。'
            : '每个端点独立超时，成功的地址会被记住后续复用。诊断会列出网关返回的真实模型清单。';
        }
        return isWorkers;
      };
      const aiProviderSel = document.getElementById('sAiProvider') as HTMLSelectElement | null;
      if (aiProviderSel) {
        aiProviderSel.onchange = () => { syncAiProvider(); };
      }

      const probeModels = async (useTyped: boolean) => {
        const payload: Record<string, string> = {};
        // 带上「刚在下拉里选、还没保存」的 provider，让探测即时按新模式走
        payload.aiProvider = (document.getElementById('sAiProvider') as HTMLSelectElement)?.value || 'custom';
        if (useTyped) {
          payload.aiUrl = (document.getElementById('sAiUrl') as HTMLInputElement)?.value.trim() || '';
          payload.aiEndpointMode = (document.getElementById('sAiEndpointMode') as HTMLSelectElement)?.value || 'auto';
          const k = (document.getElementById('sAiKey') as HTMLInputElement)?.value.trim() || '';
          if (k && !k.startsWith('••')) payload.aiApiKey = k;
        }
        if (aiModelHint) aiModelHint.textContent = '正在探测模型…';
        try {
          const r = await api.post('/api/admin/ai-models', payload);
          if (!aiModelList) return;
          // 网关 /models 挂了也照样给内置官方清单，不让下拉变空
          const list: string[] = (r.models && r.models.length ? r.models : (r.chatModels || []));
          const cur = (aiModelInput?.value || '').trim();
          const chosen = String(r.selected || '') || cur || (r.chatModels || [])[0] || '';
          aiModelList.innerHTML = '<option value="">— 手动填写 —</option>'
            + list.map((m: string) => `<option value="${esc(m)}"${m === chosen ? ' selected' : ''}>${esc(m)}</option>`).join('');
          if (aiModelInput && chosen && !cur) aiModelInput.value = chosen;
          const src = r.source === 'gateway' ? '网关 /models'
            : r.source === 'workers-ai' ? 'Workers AI 内置清单' : '内置 Agnes 官方清单';
          if (aiModelHint) {
            aiModelHint.innerHTML = (r.ok ? '✓ ' : '! ')
              + esc(r.message || '探测异常') + `（来源：${src}），审核模型 <b>${esc(chosen || '未选定')}</b>`
              + (r.autoPicked ? '（已自动选择并保存）' : '')
              + (r.inList === false && chosen ? '；当前模型不在清单中，可从下拉改选' : '')
              + '。改选后点「保存」生效。';
          }
          const at = (r.attempts || []) as { url: string; status: number; sample: string }[];
          if (at.length && r.source !== 'gateway' && aiModelHint) {
            const last = at[at.length - 1];
            aiModelHint.innerHTML += `<br><span class="dim">/models 诊断：${esc(last.url)} → HTTP ${last.status} · ${esc(String(last.sample || '').slice(0, 140))}</span>`;
          }
        } catch (e) {
          if (aiModelHint) aiModelHint.textContent = '探测失败：' + ((e as any).message || e);
        }
      };
      const aiProbeBtn = document.getElementById('aiProbeBtn');
      if (aiProbeBtn) aiProbeBtn.onclick = () => probeModels(true);
      if (aiModelList) aiModelList.onchange = () => {
        if (aiModelInput) aiModelInput.value = aiModelList.value;
        if (aiModelHint) aiModelHint.textContent = aiModelList.value
          ? `已选 ${aiModelList.value}，点「保存」后生效。`
          : '可在上方输入框手动填写模型名，然后保存。';
      };

      const preview = () => {
        tb.querySelector('.logo-preview').src = document.getElementById('sLogo').value.trim() || '/img/logo.jpg';
      };
      document.getElementById('sLogo').addEventListener('input', preview);
      document.getElementById('reloadLogo').onclick = preview;
      document.getElementById('saveSet').onclick = async () => {
        // 只有「写入设置」这一步决定保存成败。模型探测 / Logo 刷新是附带动作，
        // 以前和它共用一个 try，刷新一抛错就把已保存的设置报成「保存失败」。
        try {
          await api.post('/api/admin/settings', {
            siteName: document.getElementById('sName').value,
            logoUrl: document.getElementById('sLogo').value,
            faviconUrl: document.getElementById('sFav').value,
            announcement: document.getElementById('sAnno').value,
            footerIcpHtml: document.getElementById('sFooterIcpHtml').value,
            footerContactHtml: document.getElementById('sFooterContactHtml').value,
            reservedLabels: document.getElementById('sReservedLabels').value,
            captchaEnabled: (document.getElementById('sCaptchaEnabled') as HTMLInputElement).checked,
            captchaImages: (document.getElementById('sCaptchaImages') as HTMLInputElement).value,
            nodelocEnabled: (document.getElementById('sNodelocEnabled') as HTMLInputElement).checked,
            ...(d.nodeloc?.fromEnv ? {} : {
              nodelocClientId: document.getElementById('sNodelocClientId').value,
              nodelocClientSecret: document.getElementById('sNodelocClientSecret').value,
              nodelocRedirectUri: document.getElementById('sNodelocRedirectUri').value,
            }),
            nodelocAutoRegister: (document.getElementById('sNodelocAutoRegister') as HTMLInputElement).checked,
            githubEnabled: (document.getElementById('sGithubEnabled') as HTMLInputElement).checked,
            ...(d.github?.fromEnv ? {} : {
              githubClientId: document.getElementById('sGithubClientId').value,
              githubClientSecret: document.getElementById('sGithubClientSecret').value,
            }),
            githubAutoRegister: (document.getElementById('sGithubAutoRegister') as HTMLInputElement).checked,
            githubRedirectUri: document.getElementById('sGithubRedirectUri').value,
            githubStarRepo: document.getElementById('sGithubStarRepo').value,
            githubStarBonus: document.getElementById('sGithubStarBonus').value,
            rootRegLimits: (function(){
              var o = {};
              document.querySelectorAll('#rootRegLimitsBox .root-reg-limit-input').forEach(function(el){
                o[el.getAttribute('data-root')] = (el as HTMLInputElement).value.trim();
              });
              return o;
            })(),
            rootApplyPaused: (function(){
              var a = [];
              document.querySelectorAll('#rootApplyPausedBox .root-apply-paused-input').forEach(function(el){
                if ((el as HTMLInputElement).checked) a.push(String(el.getAttribute('data-root') || '').toLowerCase());
              });
              return a;
            })(),
            maxAccountsPerIp: document.getElementById('sIpLimit').value,
            emailRule: document.getElementById('sEmailRule').value,
            whoisHolder: document.getElementById('sWhois').value,
            checkinPoints: document.getElementById('sCheckin').value,
            defaultQuota: document.getElementById('sDefaultQuota').value,
            applyQuotaToExisting: document.getElementById('sApplyQuota').checked,
            initialPoints: document.getElementById('sInitial').value,
            domainCost: document.getElementById('sCost').value,
            shortDomainCost: document.getElementById('sShortCost').value,
            showcaseRewardPoints: document.getElementById('sShowcaseReward').value,
            comboRewardPoints: document.getElementById('sComboReward').value,
            rootPointCosts: (function(){
              var o = {};
              document.querySelectorAll('#rootCostsBox .root-cost-input').forEach(function(el){
                o[el.getAttribute('data-root')] = (el as HTMLInputElement).value.trim();
              });
              return o;
            })(),
            dnsApiUrl: document.getElementById('sDnsUrl').value,
            dnsApiKey: document.getElementById('sDnsKey').value,
            dnsApiSecret: document.getElementById('sDnsSecret').value,
            domainValidDays: document.getElementById('sValidDays').value,
            renewWindowDays: document.getElementById('sRenewWindow').value,
            abuseEmail: document.getElementById('sAbuseEmail').value,
            abuseReportUrl: document.getElementById('sAbuseUrl').value,
            hostingPanelDomain: document.getElementById('sPanelDomain').value,
            hostingPanelName: document.getElementById('sPanelName').value,
            dnsheApiKey: document.getElementById('sDnsheKey').value,
            dnsheApiSecret: document.getElementById('sDnsheSecret').value,
            anynsApiToken: document.getElementById('sAnynsToken').value,
            anynsClearToken: document.getElementById('sAnynsClearToken').checked,
            anynsRoots: document.getElementById('sAnynsRoots').value,
            anynsZoneId: document.getElementById('sAnynsZoneId').value,
            anynsZoneIds: document.getElementById('sAnynsZoneIds').value,
            seusApiToken: document.getElementById('sSeusToken').value,
            seusClearToken: document.getElementById('sSeusClearToken').checked,
            dnsPausedRoots: document.getElementById('sDnsPausedRoots').value,
            dnsMigrationNotice: document.getElementById('sMigrationNotice').value,
            fontBody: document.getElementById('sFontBody').value,
            fontDisplay: document.getElementById('sFontDisplay').value,
            mailProvider: document.getElementById('sMailProvider').value,
            mailFrom: document.getElementById('sMailFrom').value,
            mailApiKey: document.getElementById('sMailKey').value,
            mailVerifyRequired: document.getElementById('sMailVerifyRequired').checked,
            r2PublicUrl: document.getElementById('sR2PublicUrl').value,
            spaceshipApiUrl: document.getElementById('sSpUrl').value,
            spaceshipApiKey: document.getElementById('sSpKey').value,
            spaceshipApiSecret: document.getElementById('sSpSecret').value,
            applyPaused: document.getElementById('sApplyPaused').checked,
            applyPausedMessage: document.getElementById('sApplyPausedMsg').value,
            aiEnabled: document.getElementById('sAiEnabled').checked,
            aiProvider: (document.getElementById('sAiProvider') as HTMLSelectElement)?.value || 'custom',
            aiUrl: document.getElementById('sAiUrl').value,
            aiEndpointMode: (document.getElementById('sAiEndpointMode') as HTMLSelectElement)?.value || 'auto',
            aiModel: document.getElementById('sAiModel').value,
            aiApiKey: document.getElementById('sAiKey').value,
            aiRoots: document.getElementById('sAiRoots').value,
            aiDnsUnlimitedRoots: document.getElementById('sAiDnsRoots').value,
          });
        } catch (e) {
          showDialog({ title: '保存失败', message: (e as any).message || String(e), tone: 'err' });
          return;
        }
        showDialog({
          title: '设置已保存',
          message: '已保存，刷新页面后生效',
          detail: '已尝试即时更新模型列表、导航 Logo 与页脚备案 / 联系方式；若没变化，点「刷新页面」即可。',
          tone: 'ok',
          onReload: () => location.reload(),
        });
        // 探测 /models 并自动选定模型（内部自带错误处理，失败不阻塞保存）
        Promise.resolve(probeModels(false)).catch(() => {});
        // 清掉品牌缓存再重拉一次，站点名 / Logo 不用刷新整页就能生效
        try {
          resetBranding();
          applyBranding(await loadBranding());
        } catch { /* 即时刷新失败只影响预览，设置已落库 */ }
      };
      document.getElementById('resetLogo').onclick = async () => {
        try {
          await api.post('/api/admin/settings/reset-logo', {});
          resetBranding();
          applyBranding(await loadBranding());
          settingsFeedback('已恢复默认 Logo'); load();
        } catch (e) { settingsFeedback((e as any).message || String(e), 'err'); }
      };

      /* 自检 / 诊断打通后，把「实际生效的模型」同步回输入框。
         否则页面仍显示旧模型名，用户随后点保存会把它写回去，
         又把刚打通的模型覆盖成无效值。 */
      const syncAiModel = (model: string) => {
        if (!model) return;
        const mi = document.getElementById('sAiModel') as HTMLInputElement | null;
        if (mi) mi.value = model;
        const ml = document.getElementById('sAiModelList') as HTMLSelectElement | null;
        if (ml) {
          const has = Array.from(ml.options).some((o) => o.value === model);
          if (!has) {
            const opt = document.createElement('option');
            opt.value = model; opt.textContent = model;
            ml.appendChild(opt);
          }
          ml.value = model;
        }
      };

      /* AI 连接自检：真实调用 chat/completions，回报每个候选模型的具体失败点 */
      const aiTestBtn = document.getElementById('aiTestBtn');
      if (aiTestBtn) aiTestBtn.onclick = async () => {
        const out = document.getElementById('aiTestResult');
        if (out) { out.textContent = '测试中…'; out.className = 'hint'; }
        try {
          const r = await api.post('/api/admin/ai-test', {});
          if (r.ok && r.model) syncAiModel(r.model);
          if (out) {
            out.className = 'hint';
            const tried = (r.attempts || []) as string[];
            out.innerHTML = r.ok
              ? `<span class="badge ok">可用</span> 模型 <span class="mono">${esc(r.model)}</span> · ${r.latencyMs} ms · 返回「${esc(r.sample || '')}」`
              : `<span class="badge warn">不可用</span> ${esc(r.message || '未知错误')}`
                + (r.detail ? '<br><span class="mono">' + esc(r.detail) + '</span>' : '')
                + (tried.length ? '<br><span class="dim">逐个模型：' + esc(tried.join(' | ').slice(0, 400)) + '</span>' : '');
          }
          settingsFeedback(r.ok ? 'AI 审核可用' : 'AI 审核不可用：' + (r.message || ''), r.ok ? 'ok' : 'err');
        } catch (e) { if (out) out.textContent = '测试失败：' + (e.message || e); }
      };

      /* 一键诊断：Key / 地址 / /models / chat 各自状态一次列清 */
      const aiDiagBtn = document.getElementById('aiDiagBtn');
      if (aiDiagBtn) aiDiagBtn.onclick = async () => {
        const box = document.getElementById('aiDiagOut');
        if (!box) return;
        box.style.display = '';
        box.textContent = '诊断中…（会真实请求网关，最多约 45 秒）';
        try {
          const r = await api.post('/api/admin/ai-diagnose', {});
          if (r.testOk && r.testModel) syncAiModel(r.testModel);
          box.textContent = (r.lines || []).join('\n');
          settingsFeedback(r.ok ? 'AI 审核链路可用' : '诊断完成，请查看下方明细', r.ok ? 'ok' : 'err');
        } catch (e) { box.textContent = '诊断失败：' + ((e as any).message || e); }
      };

      /* AI 批量审核：手动立即处理全部待审域名 / 查看队列状态。
         与整点 cron、新申请触发共用同一套后端批处理，靠领取锁互斥。 */
      const aiBatchHint = document.getElementById('aiBatchHint');
      const showBatchStatus = async () => {
        if (!aiBatchHint) return;
        try {
          const s = await api.get('/api/admin/ai-review-status');
          const last = s.lastResult;
          const base = `待审 ${s.pendingTotal} 个 · AI 名单内 ${s.aiCovered} 个 · 名单外人工 ${s.manualOnly} 个 · 超限转人工 ${s.exhausted} 个`;
          aiBatchHint.textContent = base + (last
            ? ` ｜ 上次运行：${last.reason || '已完成'}（${(Number(last.elapsedMs || 0) / 1000).toFixed(1)}s）`
            : ' ｜ 尚未运行过');
        } catch (e) { aiBatchHint.textContent = '队列状态读取失败'; }
      };
      showBatchStatus();
      const runAiBatch = async (reset: boolean) => {
        if (aiBatchHint) aiBatchHint.textContent = reset ? '正在清零并重新审核…' : '正在审核所有待审域名…';
        try {
          const r = await api.post('/api/admin/ai-review-run', { reset: !!reset });
          if (aiBatchHint) {
            aiBatchHint.textContent = (r.reason || '已完成')
              + `（耗时 ${(Number(r.elapsedMs || 0) / 1000).toFixed(1)}s）`
              + (r.details && r.details.length ? ' · ' + r.details.slice(0, 2).join(' | ') : '');
          }
          settingsFeedback(r.scanned
            ? `AI 批量审核完成：通过 ${r.approved} / 驳回 ${r.rejected} / 待重试 ${r.failed}`
            : (r.reason || '没有待审域名'), r.noConfig ? 'err' : 'ok');
          showBatchStatus();
        } catch (e) { if (aiBatchHint) aiBatchHint.textContent = '批量审核失败：' + ((e as any).message || e); }
      };
      const aiBatchBtn = document.getElementById('aiBatchBtn');
      if (aiBatchBtn) aiBatchBtn.onclick = () => runAiBatch(false);
      const aiBatchResetBtn = document.getElementById('aiBatchResetBtn');
      if (aiBatchResetBtn) aiBatchResetBtn.onclick = () => runAiBatch(true);

      // 有效期规则（expiry 已从 secrets 提到顶层，这里才真正读得到）
      {
        const ex = d.expiry || {};
        const vd = document.getElementById('sValidDays');
        const rw = document.getElementById('sRenewWindow');
        if (vd && Number.isFinite(Number(ex.validDays))) vd.value = ex.validDays;
        if (rw) {
          /* 自动口径下输入框必须留空：填了 182 再点保存会把「自动」固化成显式值，
             以后管理员把有效期改成 90 天，窗口就不会跟着变。 */
          rw.value = ex.renewWindowAuto ? '' : String(ex.renewWindowDays ?? '');
          rw.placeholder = `自动：${ex.renewWindowDays} 天`;
        }
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        set('sAbuseEmail', (d.items || {}).abuse_email);
        set('sAbuseUrl', (d.items || {}).abuse_report_url);
        set('sPanelDomain', (d.items || {}).hosting_panel_domain);
        set('sPanelName', (d.items || {}).hosting_panel_name);
      }
  
      // 邮件服务与验证码
      {
        const m = d.mail || {};
        const pv = document.getElementById('sMailProvider');
        const fm = document.getElementById('sMailFrom');
        const ky = document.getElementById('sMailKey');
        const rq = document.getElementById('sMailVerifyRequired');
        const hint = document.getElementById('mailHint');
        if (pv) pv.value = m.provider || '';
        if (fm) fm.value = m.from || '';
        if (rq) rq.checked = !!m.verifyRequired;
        if (m.fromEnv) {
          [pv, fm, ky, rq].forEach((el) => { if (el) el.disabled = true; });
          if (ky) ky.value = m.keyMasked || '';
          hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> 后台不可修改。';
        } else if (m.enabled) {
          if (ky) { ky.placeholder = m.keyMasked || '已配置，留空不修改'; ky.value = ''; }
          hint.innerHTML = '<span class="badge ok">已启用</span> 服务商 <b>' + esc(m.provider) + '</b>，发件人 <span class="mono">' + esc(m.from) + '</span>。需修改时填入新 Key，留空保持原值。';
        } else {
          hint.innerHTML = '未配置。发件人建议填 <span class="mono">verify@你的域名</span>，并先在服务商完成域名验证。';
        }
      }
  
      // R2 头像公网地址
      {
        const el = document.getElementById('sR2PublicUrl');
        const hint = document.getElementById('r2Hint');
        if (el) el.value = d.r2PublicUrl || '';
        if (d.r2FromEnv) {
          if (el) el.disabled = true;
          if (hint) hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> 后台不可修改';
        } else if (hint) {
          hint.textContent = d.r2PublicUrl
            ? '已配置：' + d.r2PublicUrl
            : '未配置，头像走 /api/avatar/<key> 代理读取（桶无需公开）';
        }
      }
  
      // AI 自动审核：Key 只回掩码，留空表示不修改
      {
        const a = d.ai || {};
        const setv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        const isWorkers = a.provider === 'workers-ai';
        const en = document.getElementById('sAiEnabled');
        if (en) en.checked = !!a.enabled;
        setv('sAiUrl', a.url);
        const modeEl = document.getElementById('sAiEndpointMode') as HTMLSelectElement | null;
        if (modeEl) modeEl.value = a.mode || 'auto';
        setv('sAiModel', a.model);
        setv('sAiRoots', a.roots);
        setv('sAiDnsRoots', a.dnsUnlimitedRoots);
        // 先联动显隐，再按需覆盖 Key 提示（syncAiProvider 会写「无需配置」）
        syncAiProvider(a.provider || 'custom', a.workersAiModels);
        const k = document.getElementById('sAiKey');
        const hint = document.getElementById('aiHint');
        if (isWorkers) {
          if (hint) {
            hint.innerHTML = a.workersAiAvailable
              ? '<span class="badge ok">已绑定 env.AI</span> 无需 API Key，直接调用 Cloudflare Workers AI。'
              : '<span class="badge warn">未绑定</span> 请在 <span class="mono">wrangler.toml</span> 加 <span class="mono">[ai] binding = "AI"</span> 后重新部署，或改回自定义 API。';
          }
        } else if (a.fromEnv) {
          [k].forEach((el) => { if (el) el.disabled = true; });
          if (k) k.value = a.keyMasked || '';
          if (hint) hint.innerHTML = '<span class="badge ok">已由 Worker Secret 配置</span> 后台不可修改。';
        } else if (a.ready) {
          if (k) { k.placeholder = a.keyMasked || '已配置，留空不修改'; k.value = ''; }
          if (hint) hint.innerHTML = '<span class="badge ok">已启用</span> 当前 Key ' + esc(a.keyMasked || '') + '。需更换时填入新 Key，留空保持原值。';
        } else {
          if (hint) hint.innerHTML = '未配置 Key：AI 不会调用，申请照常进入人工审核。也可用 <span class="mono">npx wrangler secret put AI_API_KEY</span> 配置。';
        }
        // 自定义网关配好 Key、或 Workers AI 已绑定时，打开设置页顺带核对模型列表
        if (a.ready || (isWorkers && a.workersAiAvailable)) {
          if (aiModelHint && a.model) {
            aiModelHint.innerHTML = `当前审核模型 <b>${esc(a.model)}</b>，正在核对可用模型列表…`;
          }
          probeModels(false);
        }
      }

      // AnyNS 站点级管理 API：令牌只回掩码，留空不修改；迁移期暂停名单也在这里管
      {
        const a = d.anyns || {};
        const tokEl = document.getElementById('sAnynsToken') as HTMLInputElement | null;
        const rootsEl = document.getElementById('sAnynsRoots') as HTMLInputElement | null;
        const zoneEl = document.getElementById('sAnynsZoneId') as HTMLInputElement | null;
        const zonesEl = document.getElementById('sAnynsZoneIds') as HTMLInputElement | null;
        const pausedEl = document.getElementById('sDnsPausedRoots') as HTMLInputElement | null;
        const noticeEl = document.getElementById('sMigrationNotice') as HTMLInputElement | null;
        const hint = document.getElementById('anynsHint');
        if (rootsEl) rootsEl.value = a.roots || '';
        if (zoneEl) zoneEl.value = a.zoneId || '';
        if (zonesEl) zonesEl.value = a.zoneIds || '';
        if (pausedEl) pausedEl.value = a.dnsPausedRoots || '';
        if (noticeEl) noticeEl.value = a.migrationNotice || '';
        const pauseHint = document.getElementById('dnsPauseStateHint');
        if (pauseHint) {
          pauseHint.innerHTML = (a.dnsPausedRoots || '').trim()
            ? '<span class="badge warn">当前暂停中</span> ' + esc(a.dnsPausedRoots) + ' 下的子域名暂不能编辑 DNS 记录；清空第一格保存即恢复。'
            : '<span class="badge ok">解析已恢复</span> 当前没有暂停任何后缀，meoy.top 等域名的 DNS 记录可正常增删改。';
        }
        if (a.fromEnv) {
          if (tokEl) { tokEl.disabled = true; tokEl.placeholder = '已由 Worker Secret 配置，后台只读'; }
          if (hint) hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> ANYNS_API_TOKEN 优先级更高，后台修改的令牌不会生效。';
        } else if (a.tokenSet) {
          if (tokEl) tokEl.placeholder = (a.tokenMasked || '已配置') + '（留空不修改）';
          if (hint) hint.innerHTML = '<span class="badge ok">已配置</span> 站点后端会用这个 nhtdns_ 管理令牌给根域名 zone 写记录。要换令牌填新值；要停用它勾选「清除」。';
        } else {
          if (tokEl) tokEl.placeholder = 'nhtdns_...（留空则暂不启用，原 DNS 后端照常工作）';
          if (hint) hint.innerHTML = '未配置。meoy.top 的记录仍走原来的 Cloudflare / Spaceship 后端，部署不中断。';
        }
      }

      // 第三方域名接入：站点级 SEUS MCP Token 只回掩码，令牌本体绝不下发。
      // 只有后台这一个输入框，没有环境变量 / Worker Secret 优先级分支。
      {
        const a = d.seus || {};
        const tokEl = document.getElementById('sSeusToken') as HTMLInputElement | null;
        const hint = document.getElementById('seusHint');
        if (a.tokenSet) {
          if (tokEl) tokEl.placeholder = (a.tokenMasked || '已配置') + '（留空不修改）';
          if (hint) hint.innerHTML = '<span class="badge ok">已配置</span> 用户提交申请后，站点会用这个 mbt_ Token 调 SEUS API 查找托管区域；改动保存即生效。';
        } else if (tokEl) {
          tokEl.placeholder = '留空也能用（用户连接时临时填自己的 Token）';
          if (hint) hint.innerHTML = '<span class="badge warn">留空</span> 未配置站点级令牌时，用户可在「用 API 连接」时临时填自己的 mbt_ Token（仅本次使用、不保存）。';
        }
      }

      // 自定义 DNS 提供商：URL 可回显，Key/Secret 只显示掩码；留空表示不修改
      {
        const p = d.dnsProvider || {};
        const urlEl = document.getElementById('sDnsUrl');
        const kEl = document.getElementById('sDnsKey');
        const sEl = document.getElementById('sDnsSecret');
        const hint = document.getElementById('dnsProvHint');
        if (urlEl) urlEl.value = p.url || '';
        if (p.fromEnv) {
          urlEl.disabled = true; kEl.disabled = true; sEl.disabled = true;
          hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> 后台不可修改。当前：<span class="mono">' + esc(p.url) + '</span>';
        } else if (p.custom) {
          if (kEl) kEl.placeholder = p.keyMasked || '已配置，留空不修改';
          if (sEl) sEl.placeholder = '已配置，留空不修改';
          hint.innerHTML = '<span class="badge ok">已启用自定义接口</span> DNS 读写走 <span class="mono">' + esc(p.url) + '</span>。清空 URL 即恢复 Cloudflare。';
        } else {
          hint.innerHTML = '当前使用 <b>Cloudflare</b>（免费版单区域约 200 条记录上限）。';
        }
      }
  
      // DNSHE 凭证：后端只回传掩码，不回传明文；留空表示不修改
      {
        const sec = d.secrets || {};
        const keyEl = document.getElementById('sDnsheKey');
        const secEl = document.getElementById('sDnsheSecret');
        const hint = document.getElementById('dnsheHint');
        if (sec.fromEnv) {
          keyEl.disabled = true; secEl.disabled = true;
          keyEl.value = sec.dnsheApiKeyMasked || '';
          secEl.value = '••••••••';
          hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> 后台不可修改（优先级更高）。';
        } else if (sec.dnsheApiKeySet) {
          keyEl.placeholder = sec.dnsheApiKeyMasked || '已配置，留空不修改';
          secEl.placeholder = '已配置，留空不修改';
          hint.innerHTML = '<span class="badge ok">已配置</span> 需修改时填入新值，留空则保持原值。';
        } else {
          hint.innerHTML = '留空则使用公开模式（免认证，官方限制 <b>2 次/分钟/IP</b>）。填写后额度更高、查询更稳定。';
        }
      }
  
      /* ---------- Spaceship：配置状态 + 拉取域名 + 勾选添加 ---------- */
      {
        const sp = d.spaceship || {};
        const u = document.getElementById('sSpUrl');
        const k = document.getElementById('sSpKey');
        const sc = document.getElementById('sSpSecret');
        const hint = document.getElementById('spHint');
        const rootsEl = document.getElementById('spRoots');
        if (u) u.value = sp.url || '';
        if (sp.fromEnv) {
          [u, k, sc].forEach((e) => { if (e) e.disabled = true; });
          if (k) k.value = sp.keyMasked || '';
          if (hint) hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> 后台不可修改。';
        } else if (sp.enabled) {
          if (k) k.placeholder = sp.keyMasked || '已配置，留空不修改';
          if (sc) sc.placeholder = '已配置，留空不修改';
          if (hint) hint.innerHTML = '<span class="badge ok">已配置</span> 点「拉取我的域名」即可查看账号下的域名并选择添加。';
        } else if (hint) {
          hint.innerHTML = '未配置。填写 API Key / Secret 并保存后即可自动发现域名。';
        }
        const showRoots = (list) => {
          if (rootsEl) rootsEl.textContent = '当前根域名：' + ((list && list.length) ? list.join('、') : '（未配置）');
        };
        showRoots(d.rootDomains);
  
        /* 根域名管理：列出来源、移除、恢复 */
        const renderRoots = async () => {
          const box = document.getElementById('rootAdmin');
          if (!box) return;
          try {
            const r = await api.get('/api/admin/roots');
            const items = r.items || [];
            const removed = r.disabled || [];
            const line = (x, gone) => `<div class="row" style="gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
              <span class="mono" style="min-width:150px">${esc(gone ? x : x.domain)}</span>
              ${gone
                ? '<span class="badge warn">已移除</span>'
                : `<span class="badge ${x.source === 'dynamic' || x.source === 'external' ? 'ok' : ''}">${x.source === 'dynamic' ? '后台导入' : x.source === 'external' ? '第三方接入' : '环境变量'}</span><span class="dim" style="font-size:12px">${x.hasZone ? '已配 Zone' : '未配 Zone'}</span>
                   ${x.lockedBackend === 'seus'
                     ? `<span class="badge ok" style="font-size:11px">SEUS DNS · 第三方接入（固定）</span>
                        <select class="input" disabled title="第三方接入域名固定使用 SEUS DNS，不能切换" style="width:auto;padding:5px 8px;font-size:12px;opacity:.6">
                          <option selected>SEUS DNS（固定）</option>
                        </select>`
                     : `<span class="badge ${x.backend === 'anyns' || x.backend === 'spaceship' ? 'ok' : ''}" style="font-size:11px">${x.backend === 'anyns' ? 'ANYNS DNS' + (x.anynsZoneId ? ' · #' + esc(x.anynsZoneId) : '') : x.backend === 'spaceship' ? 'Spaceship DNS' : 'Cloudflare DNS'}${x.backendAuto ? ' · 自动' : ''}</span>
                   <select class="input" data-backend="${esc(x.domain)}" title="DNS 记录写入后端" style="width:auto;padding:5px 8px;font-size:12px">
                     <option value="auto"${x.backendAuto ? ' selected' : ''}>自动</option>
                     <option value="spaceship"${!x.backendAuto && x.backend === 'spaceship' ? ' selected' : ''}>Spaceship</option>
                     <option value="cloudflare"${!x.backendAuto && x.backend === 'cloudflare' ? ' selected' : ''}>Cloudflare</option>
                     <option value="anyns"${!x.backendAuto && x.backend === 'anyns' ? ' selected' : ''}>AnyNS</option>
                   </select>`}`}
              <span style="flex:1"></span>
              ${gone
                ? `<button class="btn sm" data-restore="${esc(x)}">恢复</button>`
                : `<button class="btn sm ghost" data-rm="${esc(x.domain)}">移除</button>`}
            </div>`;
            box.innerHTML = (items.map((x) => line(x, false)).join('') || '<div class="dim">（无生效的根域名）</div>')
              + (removed.length
                  ? '<div style="margin-top:10px"><b style="font-size:13px">已移除（可恢复）</b></div>' + removed.map((x) => line(x, true)).join('')
                  : '');
            box.querySelectorAll('[data-backend]').forEach((sel) => {
              sel.onchange = async () => {
                const dmn = sel.dataset.backend;
                const v = sel.value === 'auto' ? '' : sel.value;
                sel.disabled = true;
                try {
                  await api.post('/api/admin/roots/' + encodeURIComponent(dmn) + '/backend', { backend: v });
                  settingsFeedback('已切换 ' + dmn + ' 的 DNS 写入后端');
                  renderRoots();
                } catch (e) { settingsFeedback(e.message, 'err'); renderRoots(); }
              };
            });
            box.querySelectorAll('[data-rm]').forEach((b) => {
              b.onclick = async () => {
                const dmn = b.dataset.rm;
                if (!confirm('确定移除根域名 ' + dmn + ' 吗？\n\n该后缀将不再可选；已注册在该根域名下的子域名不会被删除。')) return;
                b.disabled = true;
                try {
                  const q = await api.del('/api/admin/roots/' + encodeURIComponent(dmn));
                  settingsFeedback('已移除 ' + dmn); showRoots(q.rootDomains); renderRoots();
                } catch (e) { settingsFeedback(e.message, 'err'); b.disabled = false; }
              };
            });
            box.querySelectorAll('[data-restore]').forEach((b) => {
              b.onclick = async () => {
                b.disabled = true;
                try {
                  const q = await api.post('/api/admin/roots/' + encodeURIComponent(b.dataset.restore) + '/restore', {});
                  settingsFeedback('已恢复 ' + b.dataset.restore); showRoots(q.rootDomains); renderRoots();
                } catch (e) { settingsFeedback(e.message, 'err'); b.disabled = false; }
              };
            });
          } catch (e) {
            box.innerHTML = '<span style="color:var(--danger)">读取失败：' + esc(e.message) + '</span>';
          }
        };
        renderRoots();

        /* 第三方域名接入审批：只有「SEUS 已连接」的申请能批准 */
        const renderExternalReqs = async () => {
          const box = document.getElementById('externalReqBox');
          if (!box) return;
          try {
            const r = await api.get('/api/admin/external-domains');
            const list: any[] = r.items || [];
            const stateText: Record<string, string> = { pending: '待站长批准', approved: '已通过', rejected: '已驳回' };
            box.innerHTML = '<table><thead><tr><th>域名</th><th>申请人</th><th>TXT 验证</th><th>连接状态</th><th>状态</th><th class="right">操作</th></tr></thead><tbody>'
              + (list.length ? list.map((x) => `<tr>
                  <td class="mono">${esc(x.fqdn)}<div class="hint">${esc(x.ns ? x.ns.join(' / ') : '')}</div></td>
                  <td>${esc(x.userEmail || ('#' + x.userId))}<div class="hint">${esc(x.note || '')}</div></td>
                  <td>${x.verified
                    ? '<span class="badge ok">TXT 已验证</span>'
                    : '<span class="badge warn">待 TXT 验证</span>'}</td>
                  <td>${x.connected
                    ? `<span class="badge ok">SEUS 已连接${x.zoneId ? ' · #' + esc(x.zoneId) : ''}</span>${x.nsDelegated ? ' <span class="badge ok">NS 已生效</span>' : '<div class="hint">NS 待确认</div>'}`
                    : '<span class="badge warn">未连接</span>'}
                    <div class="hint">${x.apiSource === 'user' ? '用户临时 Token' : x.apiSource === 'site' ? '站点级 Token' : ''}</div></td>
                  <td><span class="badge ${x.status === 'approved' ? 'ok' : (x.status === 'rejected' ? 'warn' : '')}">${esc(stateText[x.status] || x.status)}</span>
                    ${x.reviewNote ? `<div class="hint">${esc(x.reviewNote)}</div>` : ''}</td>
                  <td class="right nowrap">${x.status === 'pending' ? `
                    <button class="btn sm ok" type="button" data-exact="approve" data-id="${x.id}"${x.connected && x.verified ? '' : ` disabled title="${!x.verified ? '需先完成 TXT 所有权验证' : '需先用 SEUS API 连接'}"`}>批准</button>
                    <button class="btn sm" type="button" data-exact="reject" data-id="${x.id}">驳回</button>` : '<span class="hint">已处理</span>'}</td>
                </tr>`).join('') : '<tr><td colspan="5" class="empty">暂无接入申请</td></tr>')
              + '</tbody></table>';
            box.querySelectorAll('[data-exact]').forEach((b: any) => {
              b.onclick = async () => {
                const act = b.dataset.exact, id = b.dataset.id;
                let note = '';
                if (act === 'reject') {
                  const v = prompt('驳回原因（选填）：');
                  if (v === null) return;
                  note = v;
                }
                b.disabled = true;
                try {
                  await api.post(`/api/admin/external-domains/${id}/${act}`, { note });
                  settingsFeedback(act === 'approve' ? '已批准，DNS 后端锁定 SEUS' : '已驳回申请');
                  await renderExternalReqs();
                  renderRoots();
                } catch (e: any) { b.disabled = false; settingsFeedback(e.message, 'err'); }
              };
            });
          } catch (e: any) {
            box.innerHTML = '<span style="color:var(--danger)">读取失败：' + esc(e.message) + '</span>';
          }
        };
        renderExternalReqs();
  
        const testBtn = document.getElementById('spTest');
        if (testBtn) testBtn.onclick = async () => {
          testBtn.disabled = true;
          try {
            const r = await api.post('/api/admin/spaceship/test', {});
            settingsFeedback('连接成功，账号下共 ' + r.total + ' 个域名');
          } catch (e) { settingsFeedback(e.message, 'err'); }
          testBtn.disabled = false;
        };
  
        const fetchBtn = document.getElementById('spFetch');
        if (fetchBtn) fetchBtn.onclick = async () => {
          fetchBtn.disabled = true;
          fetchBtn.textContent = '拉取中…';
          try {
            const r = await api.get('/api/admin/spaceship/domains');
            fetchBtn.disabled = false;
            fetchBtn.textContent = '拉取我的域名';
            openSpaceshipPicker(r.items || [], showRoots);
          } catch (e) {
            fetchBtn.disabled = false;
            fetchBtn.textContent = '拉取我的域名';
            settingsFeedback(e.message, 'err');
          }
        };

        /* AnyNS：用站点设置里的管理令牌拉取解析区域 → 勾选添加 / 切换后端 */
        const anFetchBtn = document.getElementById('anFetch');
        if (anFetchBtn) anFetchBtn.onclick = async () => {
          anFetchBtn.disabled = true;
          anFetchBtn.textContent = '拉取中…';
          try {
            const r = await api.get('/api/admin/anyns/domains');
            anFetchBtn.disabled = false;
            anFetchBtn.textContent = '从 AnyNS 拉取域名';
            openAnynsPicker(r.items || [], showRoots, renderRoots);
          } catch (e) {
            anFetchBtn.disabled = false;
            anFetchBtn.textContent = '从 AnyNS 拉取域名';
            settingsFeedback(e.message, 'err');
          }
        };
      }
      return;
    }
  
    /* 第三方邮箱注册申请：通过即写入精确白名单，任何规则模式下都放行 */
    if (tab === 'emailreq') {
      const d = await api.get('/api/admin/email-requests');
      const allow: any[] = d.allowlist || [];
      const items: any[] = d.items || [];
      const stateText: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
      const manage = `
        <tr><td colspan="5" style="background:transparent">
          <div style="padding:6px 2px 14px">
            <b>精确邮箱白名单</b>
            <div class="hint" style="margin:4px 0 10px">命中白名单的邮箱在任何注册规则下都能注册。通过下方申请会自动加入白名单。</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
              <input id="erNewEmail" class="input" type="email" placeholder="name@example.com" style="flex:1;min-width:180px;padding:8px 10px">
              <input id="erNewNote" class="input" type="text" maxlength="200" placeholder="备注（选填）" style="flex:1;min-width:140px;padding:8px 10px">
              <button class="btn sm primary" id="erAdd" type="button">添加白名单</button>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${allow.length ? allow.map((a) => `
                <span class="badge" style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px">
                  <span class="mono">${esc(a.email)}</span>
                  ${a.note ? `<span class="dim" style="font-size:11px">${esc(a.note)}</span>` : ''}
                  <button class="btn sm" type="button" data-erremove="${esc(a.email)}" title="移除" style="padding:0 5px">×</button>
                </span>`).join('') : '<span class="hint">暂无白名单邮箱</span>'}
            </div>
          </div>
        </td></tr>`;
      const rows = items.map((r) => `
        <tr>
          <td class="mono">${esc(r.email)}</td>
          <td class="cell-detail">
            ${esc(r.reason || '（未填写）')}
            ${r.contact ? `<div class="hint mono">${esc(r.contact)}</div>` : ''}
            ${r.note ? `<div class="hint">· ${esc(r.note)}</div>` : ''}
          </td>
          <td><span class="badge ${r.status === 'approved' ? 'ok' : (r.status === 'rejected' ? 'warn' : '')}">${esc(stateText[r.status] || r.status)}</span></td>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(r.created_at)}</td>
          <td class="right nowrap">
            ${r.status === 'pending' ? `
              <button class="btn sm ok" type="button" data-eract="approve" data-id="${r.id}">通过并加白名单</button>
              <button class="btn sm" type="button" data-eract="reject" data-id="${r.id}">驳回</button>` : '<span class="hint">已处理</span>'}
          </td>
        </tr>`).join('');
      tb.innerHTML = manage + (rows || `<tr><td colspan="5" class="empty">${d.unavailable ? '数据表尚未初始化，请稍后重试' : '暂无邮箱注册申请'}</td></tr>`);

      tb.querySelectorAll('[data-eract]').forEach((b: any) => {
        b.onclick = async () => {
          const id = b.dataset.id, act = b.dataset.eract;
          let note = '';
          if (act === 'reject') {
            const v = prompt('驳回原因（选填）：');
            if (v === null) return;
            note = v;
          }
          b.disabled = true;
          try {
            await api.post(`/api/admin/email-requests/${id}/${act}`, { note });
            settingsFeedback(act === 'approve' ? '已通过并加入白名单' : '已驳回申请');
            load();
          } catch (e) { b.disabled = false; settingsFeedback(e.message, 'err'); }
        };
      });
      tb.querySelectorAll('[data-erremove]').forEach((b: any) => {
        b.onclick = async () => {
          try {
            await api.del('/api/admin/email-allowlist/' + encodeURIComponent(b.dataset.erremove));
            settingsFeedback('已移除白名单');
            load();
          } catch (e) { settingsFeedback(e.message, 'err'); }
        };
      });
      const addBtn = document.getElementById('erAdd') as HTMLButtonElement | null;
      if (addBtn) addBtn.onclick = async () => {
        const email = (document.getElementById('erNewEmail') as HTMLInputElement)?.value.trim() || '';
        const note = (document.getElementById('erNewNote') as HTMLInputElement)?.value.trim() || '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return settingsFeedback('请填写有效的邮箱地址', 'err');
        addBtn.disabled = true;
        try {
          await api.post('/api/admin/email-allowlist', { email, note });
          settingsFeedback('已加入白名单');
          load();
        } catch (e) { addBtn.disabled = false; settingsFeedback(e.message, 'err'); }
      };
      return;
    }

    if (tab === 'audit') {
      const d = await api.get('/api/admin/audit');
      tb.innerHTML = d.items.map((a) => `
        <tr>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(a.created_at)}</td>
          <td class="mono" style="color:var(--muted)">${esc(a.email || '系统')}</td>
          <td><span class="badge">${esc(a.action)}</span></td>
          <td class="mono">${esc(a.target || '')}</td>
          <td class="cell-detail" title="${esc(a.detail || '')}">${esc(a.detail || '')}</td>
        </tr>`).join('');
    }
  }
  
  function bindSubActions(tb) {
    const call = async (id, act, body = {}) => {
      if (act === 'reject' || act === 'suspend') {
        const reason = prompt(act === 'reject' ? '驳回原因：' : '停用原因：');
        if (reason === null) return;
        body.reason = reason;
      }
      if (act === 'del' && !confirm('删除该子域名并清空其 DNS 记录？')) return;
      try {
        if (act === 'del') await api.del('/api/admin/subdomains/' + id);
        else await api.post(`/api/admin/subdomains/${id}/${act}`, body);
        settingsFeedback('操作成功'); load();
      } catch (e) { settingsFeedback(e.message, 'err'); }
    };
    tb.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => call(b.dataset.id, b.dataset.act));
  }
  
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      tab = t.dataset.tab;
      load();
    };
  });
  
  mountShell('admin').then(async (u) => {
    applyBranding(await loadBranding());
    if (u && u.role !== 'admin') {
      document.querySelector('.wrap').innerHTML =
        '<div class="card"><div class="alert danger">当前账号没有管理员权限。</div><a href="/dashboard">返回我的域名</a></div>';
      return;
    }
    load();
  }).catch((e) => console.error("初始化失败", e));
  
}
