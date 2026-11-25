/**
 * Rewards 页面控制器（由 rewards.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, toast, copyText, mountShell } from '../lib/runtime';
import { applyI18n } from '../lib/i18n';

import type { LegacyCtx } from '../lib/types';

export async function mountRewards(_root: HTMLElement | null): Promise<void> {
  
  let isAdmin = false;
  let previewType = '';
  
  async function loadMine() {
    try {
      const d = await api.get('/api/redeem/mine');
      const box = document.getElementById('myLogs');
      if (!d.items.length) { box.innerHTML = '<div class="empty">还没有兑换记录</div>'; return; }
      box.innerHTML = `<table>
        <thead><tr><th>兑换码</th><th>类型</th><th>域名</th><th>时间</th></tr></thead>
        <tbody>${d.items.map((l) => `<tr>
          <td class="mono">${esc(l.code)}</td>
          <td>${l.type === 'permanent' ? '<span class="badge inf">永久化</span>'
              : l.type === 'points' ? '<span class="badge inf">积分 +' + l.value + '</span>'
              : '<span class="badge ok">配额 +' + l.value + '</span>'}</td>
          <td>${l.fqdn ? '<span class="fqdn">' + esc(l.fqdn) + '</span>' : '—'}</td>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(l.created_at)}</td>
        </tr>`).join('')}</tbody></table>`;
    } catch (e) { document.getElementById('myLogs').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }
  
  /** V 码需要选择域名：列出自己已注册且非永久的域名 */
  async function loadPermOptions() {
    try {
      const d = await api.get('/api/subdomains');
      const opts = (d.items || []).filter((s) => s.status === 'approved' && !(s.expiry && s.expiry.perpetual));
      const sel = document.getElementById('permSel');
      if (!opts.length) {
        sel.innerHTML = '<option value="">（没有可永久化的域名）</option>';
        return;
      }
      sel.innerHTML = opts.map((s) => `<option value="${s.id}">${esc(s.fqdn)}</option>`).join('');
    } catch {}
  }
  
  document.getElementById('btnPreview').onclick = async () => {
    const code = document.getElementById('code').value.trim();
    const tip = document.getElementById('previewTip');
    const permRow = document.getElementById('permRow');
    permRow.style.display = 'none';
    previewType = '';
    if (!code) { tip.textContent = '请输入兑换码'; return; }
    try {
      const r = await api.get('/api/redeem/preview?code=' + encodeURIComponent(code));
      previewType = r.type;
      tip.innerHTML = r.usable
        ? `<span style="color:var(--ok)">可用：${esc(r.typeText)}${(r.type === 'quota' || r.type === 'points') ? ' ×' + r.value : ''}</span>`
        : `<span style="color:var(--danger)">不可用：${esc(r.reason)}</span>`;
      if (r.usable && r.type === 'permanent') {
        permRow.style.display = '';
        await loadPermOptions();
      }
    } catch (e) {
      tip.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
    }
  };
  
  document.getElementById('btnRedeem').onclick = async () => {
    const code = document.getElementById('code').value.trim();
    if (!code) return toast('请输入兑换码', 'err');
    const btn = document.getElementById('btnRedeem');
    btn.disabled = true;
    try {
      const body: Record<string, any> = { code };
      if (previewType === 'permanent') {
        const sid = document.getElementById('permSel').value;
        if (!sid) { btn.disabled = false; return toast('请选择要永久化的域名', 'err'); }
        body.subdomainId = Number(sid);
      }
      const r = await api.post('/api/redeem/redeem', body);
      toast(r.type === 'permanent' ? `已永久化 ${r.fqdn}`
        : r.type === 'points' ? (r.unlimited ? '当前账号积分不限，无需叠加' : `积分 +${r.added}，当前 ${r.after}`)
        : `配额 +${r.added}，当前 ${r.after < 0 ? '∞' : r.after}`);
      document.getElementById('code').value = '';
      document.getElementById('previewTip').textContent = '输入兑换码后点「识别」，可先确认它是什么类型。';
      document.getElementById('permRow').style.display = 'none';
      loadMine();
      loadPermOptions();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  };
  
  /* ---------------- 组合任务奖励：绑定 NodeLoc + Star 项目 ---------------- */
  async function loadCombo() {
    const box = document.getElementById('comboStatus');
    if (!box) return;
    try {
      const d = await api.get('/api/points/rewards');
      /* 动态注入的文案一律用叶子节点的 data-en 整段替换，
         避免 <b> 把一句话拆成多个文本节点后词典翻不全。 */
      const done = (v: boolean) => v
        ? '<span class="badge ok" data-en="Done">已完成</span>'
        : '<span class="badge warn" data-en="Pending">未完成</span>';
      const starUrl = 'https://github.com/wcvjk8tnz8-create/Noxc';
      const note = d.isAdmin
        ? '<span data-en="Admin accounts are not eligible for point rewards.">管理员账号不参与积分奖励。</span>'
        : d.claimed
        ? `<span data-en="Claimed +${d.amount} points (once per account).">已领取 +${d.amount} 积分，每个账号仅一次。</span>`
        : d.allDone
        ? `<span data-en="Both tasks are done. Click Check & claim to receive +${d.points} points.">两项都完成了，点「检查并领取」即可入账 +${d.points} 积分。</span>`
        : `<span data-en="${(d.nodelocLinked ? 0 : 1) + (d.starClaimed ? 0 : 1)} task(s) left. Finish both to receive +${d.points} points.">还差 ${(d.nodelocLinked ? 0 : 1) + (d.starClaimed ? 0 : 1)} 项；全部完成后才发 +${d.points} 积分。</span>`;
      box.innerHTML = `<table>
        <thead><tr>
          <th><span data-en="Task">任务</span></th>
          <th><span data-en="Status">状态</span></th>
          <th><span data-en="Action">操作</span></th>
        </tr></thead>
        <tbody>
          <tr>
            <td><span data-en="1. Link your NodeLoc account">① 绑定 NodeLoc 账号</span></td>
            <td>${done(d.nodelocLinked)}</td>
            <td>${d.nodelocLinked ? '—' : '<a href="/profile" data-en="Link now">去绑定</a>'}</td>
          </tr>
          <tr>
            <td><span data-en="2. Star the project and claim the Star reward">② 给项目点 Star 并领取 Star 奖励</span></td>
            <td>${done(d.starClaimed)}</td>
            <td>${d.starClaimed ? '—'
              : '<a href="' + starUrl + '" target="_blank" rel="noopener noreferrer" data-en="Star">去 Star</a> · <a href="/profile" data-en="Claim">领取</a>'}</td>
          </tr>
        </tbody></table>
        <div class="hint" style="margin-top:10px">${note}</div>`;
    } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  const comboBtn = document.getElementById('btnComboCheck');
  if (comboBtn) comboBtn.onclick = async () => {
    comboBtn.disabled = true;
    try {
      const d = await api.get('/api/points/rewards?check=1');
      toast(d.granted > 0 ? `组合任务奖励已到账 +${d.granted} 积分`
        : d.claimed ? '这个奖励已经领过了'
        : d.allDone ? '资格校验中，请稍后再试' : '请先完成上面两项任务');
      await loadCombo();
    } catch (e) { toast(e.message, 'err'); }
    comboBtn.disabled = false;
  };

  /* ---------------- 管理员 · 编辑已生成的券 ----------------
     旧版券生成后只能「停用 / 删除」，总使用量、面值、有效期、备注都改不了，
     管理员只能删了重发（旧码上的兑换记录还留着）。这里做行内编辑表单，
     部分更新：只提交真正变化的字段，后端按字段校验并写审计。 */
  let editingRow: any = null;
  function toLocalInput(ms: any): string {
    const n = Number(ms);
    if (!n) return '';
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function fromLocalInput(s: string): number | null {
    if (!s) return null;
    const n = new Date(s).getTime();
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function hideEdit() {
    editingRow = null;
    const box = document.getElementById('editBox');
    if (box) box.style.display = 'none';
  }
  function openEdit(r: any) {
    editingRow = r;
    const box = document.getElementById('editBox');
    if (!box) return;
    const typeText = r.type === 'permanent' ? 'V 码 · 域名永久化'
      : r.type === 'points' ? 'DC 码 · 积分' : 'PE 码 · 配额';
    document.getElementById('editTitle').textContent = '编辑 · ' + r.code;
    document.getElementById('editMeta').textContent = `${typeText} · 当前已用 ${r.used_count} / ${r.max_uses}`;
    const val = document.getElementById('eValue') as HTMLInputElement;
    val.value = String(r.value);
    val.disabled = r.type === 'permanent';
    (document.getElementById('eMax') as HTMLInputElement).value = String(r.max_uses);
    (document.getElementById('eUsed') as HTMLInputElement).value = String(r.used_count);
    (document.getElementById('eExpiry') as HTMLInputElement).value = toLocalInput(r.expires_at);
    (document.getElementById('eNote') as HTMLInputElement).value = String(r.note || '');
    box.style.display = '';
    try { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch { /* 老浏览器 */ }
  }
  async function saveEdit() {
    if (!editingRow) return;
    const btn = document.getElementById('btnEditSave') as HTMLButtonElement;
    const body: Record<string, any> = {
      maxUses: Number((document.getElementById('eMax') as HTMLInputElement).value),
      expiresAt: fromLocalInput((document.getElementById('eExpiry') as HTMLInputElement).value),
      note: (document.getElementById('eNote') as HTMLInputElement).value.trim(),
    };
    if (editingRow.type !== 'permanent') {
      body.value = Number((document.getElementById('eValue') as HTMLInputElement).value);
    }
    const used = Number((document.getElementById('eUsed') as HTMLInputElement).value);
    if (used !== Number(editingRow.used_count)) body.usedCount = used;  // 只有真改了才走乐观锁
    btn.disabled = true;
    try {
      const r = await api.put('/api/redeem/admin/' + editingRow.id, body);
      toast(r.unchanged ? '没有需要保存的修改' : '兑换码已更新');
      hideEdit();
      loadAdminList();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  }

  /* ---------------- 管理员 ---------------- */
  async function loadAdminList() {
    try {
      const d = await api.get('/api/redeem/admin/list');
      const box = document.getElementById('listWrap');
      if (!d.items.length) { box.innerHTML = '<div class="empty">还没有兑换码</div>'; return; }
      box.innerHTML = `<table>
        <thead><tr><th>兑换码</th><th>类型</th><th>用量 / 总量</th><th>状态</th><th>备注</th><th class="right">操作</th></tr></thead>
        <tbody>${d.items.map((r) => {
          const dead = r.status !== 'active' || (r.expires_at && r.expires_at < Date.now());
          return `<tr${dead ? ' style="opacity:.6"' : ''}>
            <td class="mono">${esc(r.code)}</td>
            <td>${r.type === 'permanent' ? '<span class="badge inf">永久化</span>'
                : r.type === 'points' ? '<span class="badge inf">积分 ' + r.value + '</span>'
                : '<span class="badge ok">配额 ' + r.value + '</span>'}</td>
            <td>${r.used_count} / ${r.max_uses}</td>
            <td>${r.status === 'active' ? '<span class="badge ok">启用</span>' : '<span class="badge warn">停用</span>'}</td>
            <td style="color:var(--muted)" data-no-i18n>${esc(r.note || '—')}${r.expires_at
              ? '<div class="hint">到期 ' + esc(fmtTime(r.expires_at)) + '</div>' : ''}</td>
            <td class="right nowrap">
              <button class="btn sm" data-ed="${r.id}" data-en="Edit">编辑</button>
              <button class="btn sm" data-tg="${r.id}">${r.status === 'active' ? '停用' : '启用'}</button>
              <button class="btn sm danger" data-rm="${r.id}">删除</button>
            </td>
          </tr>`;
        }).join('')}</tbody></table>`;
      box.querySelectorAll('[data-tg]').forEach((b) => {
        b.onclick = async () => {
          try { await api.post('/api/redeem/admin/' + b.dataset.tg + '/toggle', {}); loadAdminList(); }
          catch (e) { toast(e.message, 'err'); }
        };
      });
      box.querySelectorAll('[data-rm]').forEach((b) => {
        b.onclick = async () => {
          if (!confirm('确定删除该兑换码？')) return;
          try {
            await api.del('/api/redeem/admin/' + b.dataset.rm);
            if (editingRow && String(editingRow.id) === b.dataset.rm) hideEdit();
            toast('已删除'); loadAdminList();
          } catch (e) { toast(e.message, 'err'); }
        };
      });
      /* 编辑按钮带整行数据，避免再发一次接口；动态节点补跑一次 i18n */
      const items = d.items as any[];
      box.querySelectorAll('[data-ed]').forEach((b) => {
        b.onclick = () => {
          const r = items.find((x) => String(x.id) === String((b as HTMLElement).dataset.ed));
          if (r) openEdit(r);
        };
      });
      try { applyI18n(box); } catch { /* i18n 未就绪时保持中文 */ }
    } catch (e) { document.getElementById('listWrap').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  const editSaveBtn = document.getElementById('btnEditSave');
  if (editSaveBtn) editSaveBtn.onclick = saveEdit;
  const editCancelBtn = document.getElementById('btnEditCancel');
  if (editCancelBtn) editCancelBtn.onclick = hideEdit;
  
  document.getElementById('gType').onchange = (e) => {
    const v = e.target.value;
    document.getElementById('gValueWrap').style.display = (v === 'quota' || v === 'points') ? '' : 'none';
    const label = document.getElementById('gValueLabel');
    const input = document.getElementById('gValue') as HTMLInputElement;
    if (label) label.textContent = v === 'points' ? '积分数量' : '配额数量';
    if (input) { input.value = v === 'points' ? '3000' : '1'; }
  };
  
  document.getElementById('btnGen').onclick = async () => {
    const btn = document.getElementById('btnGen');
    btn.disabled = true;
    try {
      const type = document.getElementById('gType').value;
      const r = await api.post('/api/redeem/admin/generate', {
        type,
        count: Number(document.getElementById('gCount').value) || 1,
        value: Number(document.getElementById('gValue').value) || 1,
        maxUses: Number(document.getElementById('gMax').value) || 10000,
        days: Number(document.getElementById('gDays').value) || 0,
        note: document.getElementById('gNote').value.trim(),
      });
      const out = document.getElementById('genOut');
      out.innerHTML = `<div class="alert ok" style="margin:0">
        已生成 ${r.count} 张 ${type === 'permanent' ? 'V' : type === 'points' ? 'DC' : 'PE'} 码${type === 'points' ? '（注册域名时最多抵扣 ' + r.value + ' 积分，也可在此兑换）' : ''}：
        <div class="mono" style="margin-top:7px;font-size:12px;line-height:2;word-break:break-all">
          ${r.codes.map((c) => esc(c)).join('<br>')}
        </div>
        <button class="btn sm" id="btnCopyAll" style="margin-top:9px">复制全部</button>
      </div>`;
      const cb = document.getElementById('btnCopyAll');
      if (cb) cb.onclick = () => { copyText(r.codes.join('\n')); };
      loadAdminList();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  };
  
  document.getElementById('btnPurge').onclick = async () => {
    const btn = document.getElementById('btnPurge');
    const first = confirm('确定清空全部券？此操作不可恢复。\n\n兑换记录会保留（便于追溯谁用过）。');
    if (!first) return;
    const again = confirm('再次确认：真的要删除所有券吗？');
    if (!again) return;
    btn.disabled = true;
    try {
      const r = await api.del('/api/redeem/admin/all?confirm=1');
      toast(`已清空 ${r.deleted} 张券`);
      loadAdminList();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  };
  
  (async () => {
    const me = await mountShell('rewards');
    isAdmin = !!(me && me.role === 'admin');
    if (isAdmin) {
      document.getElementById('adminBox').style.display = '';
      document.getElementById('adminList').style.display = '';
      loadAdminList();
    }
    loadMine();
    loadPermOptions();
    loadCombo();
  })();
  
}
