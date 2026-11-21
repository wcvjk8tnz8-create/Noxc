/**
 * Profile 页面控制器（由 profile.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, toast, openModal, closeModal, loadBranding, applyBranding, mountShell, MeoyRenderAvatars, refreshRuntime } from '../lib/runtime';
import { nodelocStartUrl } from '../lib/oauthUrl';

import type { LegacyCtx } from '../lib/types';

export async function mountProfile(_root: HTMLElement | null): Promise<void> {
  
  let me = null, data = null, curAvatar = '/img/avatar/miku-headset.webp';
  
  mountShell('profile').then(async () => {
    applyBranding(await loadBranding());
    await load();
  }).catch((e) => console.error("初始化失败", e));

  /* NodeLoc 第三方账号：站点启用后才显示；绑定 / 解绑都不影响邮箱密码登录 */
  function refreshNodelocState() {
    api.get('/api/auth/nodeloc/status').then((st) => {
      const state = document.getElementById('nodelocState');
      const btn = document.getElementById('btnNodelocBind') as HTMLButtonElement | null;
      // 已绑定时直接显示读到的邮箱（纯 ASCII，中英模式都不会夹生）
      if (state) state.textContent = st && st.linked ? (st.email || '已绑定') : '未绑定';
      if (btn) btn.textContent = st && st.linked ? '解除绑定' : '绑定';
    }).catch(() => { /* 接口不可用时保持「未绑定」，不打断页面 */ });
  }
  api.get('/api/config').then((cfg) => {
    if (!cfg || !cfg.nodelocEnabled) return;
    const row = document.getElementById('nodelocRow');
    if (row) row.hidden = false;
    refreshNodelocState();
  }).catch(() => {});

  const nlBtn = document.getElementById('btnNodelocBind');
  if (nlBtn) nlBtn.onclick = async () => {
    try {
      const st = await api.get('/api/auth/nodeloc/status');
      if (st && st.linked) {
        if (!window.confirm('确定要解除 NodeLoc 账号绑定吗？解除后仍可用邮箱密码登录。')) return;
        await api.post('/api/auth/nodeloc/unbind', {});
        toast('已解除 NodeLoc 绑定');
        refreshNodelocState();
      } else {
        location.href = nodelocStartUrl('?bind=1');
      }
    } catch (e) { toast(e.message, 'err'); }
  };
  const oauthQ = new URLSearchParams(location.search);
  if (oauthQ.get('oauth') === 'bound') {
    const bonus = Number(oauthQ.get('bonus') || 0);
    toast(bonus > 0 ? `NodeLoc 账号已绑定，配额 +${bonus}` : 'NodeLoc 账号已绑定');
  }

  async function load() {
    try {
      data = await api.get('/api/profile');
    } catch (e) { toast(e.message, 'err'); return; }
    const p = data.profile || {};
    curAvatar = p.avatar || '/img/avatar/miku-headset.webp';
    const nick = p.nickname || String(data.email || '').split('@')[0];
  
    document.getElementById('pcName').textContent = nick;
    document.getElementById('pcUid').textContent = p.uid || '—';
    document.getElementById('pcMail').textContent = data.email || '—';
    document.getElementById('pcCreated').textContent = fmtTime(data.createdAt);
    document.getElementById('pcLogin').textContent = data.lastLoginAt ? fmtTime(data.lastLoginAt) : '—';
    document.getElementById('pcBio').textContent = p.bio || '';
    document.getElementById('pcDomains').textContent = `${data.domains} Domains`;
    document.getElementById('pcRole').textContent = data.role === 'admin' ? '管理员' : '用户';
    // 等级：按域名数与记录数粗算，纯装饰
    const lv = 1 + Math.floor((data.domains * 3 + data.records) / 2);
    document.getElementById('pcLv').textContent = 'LV ' + lv;
    setAvatar(curAvatar);
  
    document.getElementById('fNick').value = p.nickname || '';
    document.getElementById('fMail').value = data.email || '';
    document.getElementById('fBio').value = p.bio || '';
    document.getElementById('fAvUrl').value = p.avatar || '';
    document.getElementById('secUid').textContent = p.uid || '—';
    document.getElementById('secMail').textContent = data.email || '—';
  }
  
  function setAvatar(url) {
    // 顶栏头像必须跟着变（同一个用户，两处不能不一致）
    try { window.MeoyRenderAvatars && window.MeoyRenderAvatars(url); } catch (e) {}
    curAvatar = url || '/img/avatar/miku-headset.webp';
    const av = document.getElementById('pcAv');
    const pv = document.getElementById('fAvPreview');
    if (av) av.src = curAvatar;
    if (pv) pv.src = curAvatar;
    const u = document.getElementById('fAvUrl');
    if (u) u.value = curAvatar;
  }
  
  /* ---------- 头像选择弹窗（内置角色库：Miku / GUMI / VOCALOID / Ave Mujica） ---------- */
  function openAvatarPicker(afterPick) {
    const list = (data && data.avatars) || [];
    const groups = ['all', ...new Set(list.map((a) => a.group || '其它'))];
    const countOf = (g) => g === 'all' ? list.length : list.filter((a) => (a.group || '其它') === g).length;
    const gname = (g) => g === 'all' ? '全部' : (g === 'Ave Mujica' ? 'Mujica' : g);
    let picked = curAvatar;
    let group = 'all';
  
    openModal('选择头像', `
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:11px;gap:8px;flex-wrap:wrap">
        <div class="av-filters" id="avFilters">
          ${groups.map((g) => `<button type="button" class="av-flt${g === group ? ' on' : ''}" data-g="${esc(g)}">${esc(gname(g))} <b>${countOf(g)}</b></button>`).join('')}
        </div>
        <button class="btn sm" id="btnUploadAv2" style="display:none">上传本地图片</button>
      </div>
      <div class="av-grid" id="avGrid"></div>
      <div class="row end" style="margin-top:14px">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" id="okAv">保存修改</button>
      </div>`);
  
    const grid = document.getElementById('avGrid');
    const draw = () => {
      const arr = group === 'all' ? list : list.filter((a) => (a.group || '其它') === group);
      grid.innerHTML = arr.map((a) => `
        <div class="av-cell${a.url === picked ? ' on' : ''}" data-av="${esc(a.url)}" title="${esc(a.label)}">
          <button class="av-item${a.url === picked ? ' on' : ''}" type="button"><img src="${esc(a.url)}" alt="${esc(a.label)}" loading="lazy"></button>
          <span class="av-label">${esc(a.label)}</span>
        </div>`).join('') || '<div class="hint" style="grid-column:1/-1">暂无头像</div>';
      grid.querySelectorAll('.av-cell').forEach((b) => {
        b.onclick = () => {
          picked = b.dataset.av;
          grid.querySelectorAll('.av-cell, .av-item').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          const inner = b.querySelector('.av-item');
          if (inner) inner.classList.add('on');
        };
      });
    };
    draw();
  
    document.querySelectorAll('#avFilters .av-flt').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('#avFilters .av-flt').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        group = b.dataset.g;
        draw();
      };
    });
  
    const b2 = document.getElementById('btnUploadAv2');
    if (b2) b2.onclick = () => { closeModal(); pickFile(); };
  
    document.getElementById('okAv').onclick = () => {
      closeModal();
      if (afterPick) afterPick(picked);
    };
  }
  
  document.getElementById('btnPickAv').onclick = () => openAvatarPicker((u) => { setAvatar(u); saveNow(); });
  document.getElementById('btnPickAv2').onclick = () => openAvatarPicker((u) => setAvatar(u));
  
  document.getElementById('fAvUrl').addEventListener('change', () => {
    const v = document.getElementById('fAvUrl').value.trim();
    if (v) setAvatar(v);
  });
  
  document.getElementById('btnSave').onclick = () => saveNow();
  
  
  /* ---------- 上传自定义头像（R2） ---------- */
  const fileInput = document.getElementById('fAvFile');
  const upTip = document.getElementById('upTip');
  
  function pickFile() { fileInput.click(); }
  /* 自定义上传默认关闭（当前不绑定 R2）。
     后台在 /api/config 里返回 avatarUpload: true 时才显示并启用。 */
  const btnUp = document.getElementById('btnUploadAv');
  if (btnUp) btnUp.onclick = pickFile;
  try {
    api.get('/api/config').then((cfg) => {
      if (cfg && cfg.avatarUpload === true) {
        [btnUp, document.getElementById('btnUploadAv2')].forEach((b) => { if (b) b.style.display = ''; });
      }
    }).catch((e) => console.error("初始化失败", e));
  } catch (e) {}
  
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const maxKb = 2048;
    if (f.size > maxKb * 1024) { upTip.textContent = `图片不能超过 ${maxKb} KB`; upTip.style.color = 'var(--danger)'; return; }
    upTip.textContent = '上传中…'; upTip.style.color = '';
    const fd = new FormData();
    fd.append('file', f);
    try {
      // 走原生 fetch：需要 multipart，api.req 会强制 JSON
      const r = await fetch('/api/profile/avatar', { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!j.success) throw new Error(j.message || '上传失败');
      setAvatar(j.url);
      upTip.textContent = '上传成功，记得点「保存修改」';
      upTip.style.color = 'var(--ok)';
      toast('头像已上传');
    } catch (e) {
      upTip.textContent = e.message;
      upTip.style.color = 'var(--danger)';
    }
    fileInput.value = '';
  });
  
  async function saveNow() {
    const btn = document.getElementById('btnSave');
    btn.disabled = true;
    try {
      await api.put('/api/profile', {
        nickname: document.getElementById('fNick').value,
        bio: document.getElementById('fBio').value,
        avatar: document.getElementById('fAvUrl').value.trim() || curAvatar,
      });
      toast('资料已保存');
      await load();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  }
  
  /* ---------- 修改密码 ---------- */
  document.getElementById('btnPwd').onclick = () => {
    openModal('修改密码', `
      <div class="field"><label>原密码</label><input id="pOld" type="password" autocomplete="current-password"></div>
      <div class="field"><label>新密码（至少 8 位）</label><input id="pNew" type="password" autocomplete="new-password"></div>
      <div class="row end">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" id="okPwd">确认修改</button>
      </div>`);
    document.getElementById('okPwd').onclick = async () => {
      try {
        await api.post('/api/auth/password', {
          oldPassword: document.getElementById('pOld').value,
          newPassword: document.getElementById('pNew').value,
        });
        toast('密码已修改，其它设备已登出');
        closeModal();
      } catch (e) { toast(e.message, 'err'); }
    };
  };
  
  /* ---------- 更换邮箱：验证码发到新邮箱，验证通过即写入 ----------
     NodeLoc 登录建出来的 nl.<hex>@oauth.local 占位账号、以及第三方邮箱
     用户，都能在这里换成自己真正收得到邮件的地址，不用等管理员。 */
  const btnChangeMail = document.getElementById('btnChangeMail');
  if (btnChangeMail) btnChangeMail.onclick = () => {
    const cur = String((data && data.email) || '');
    openModal('更换邮箱', `
      <div class="field">
        <label>当前邮箱</label>
        <input id="chgCur" disabled value="${esc(cur)}">
      </div>
      <div class="field">
        <label>新邮箱</label>
        <input id="chgMail" type="email" autocomplete="off" placeholder="填入你能收到邮件的新地址">
        <div class="hint">验证码会发到这个新邮箱，收到后填在下面即可完成更换。更换后请用新邮箱登录。</div>
      </div>
      <div class="field">
        <label>验证码</label>
        <div class="row" style="gap:8px;align-items:center">
          <input id="chgCode" inputmode="numeric" maxlength="6" placeholder="6 位验证码" style="flex:1;min-width:0">
          <button type="button" class="btn sm" id="btnChgSend">发送验证码</button>
        </div>
        <div class="hint" id="chgTip"></div>
      </div>
      <div class="row end">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" id="btnChgOk">确认更换</button>
      </div>`);

    const sendBtn = document.getElementById('btnChgSend') as HTMLButtonElement | null;
    const okBtn = document.getElementById('btnChgOk') as HTMLButtonElement | null;
    const tip = document.getElementById('chgTip');
    const newMail = () => String((document.getElementById('chgMail') as HTMLInputElement | null)?.value || '').trim();
    const say = (msg, bad = false) => {
      if (!tip) return;
      tip.textContent = msg;
      tip.style.color = bad ? 'var(--danger)' : 'var(--ok)';
    };
    let left = 0, timer: any = null;
    const tick = () => {
      if (!sendBtn || !sendBtn.isConnected) { if (timer) clearInterval(timer); return; }
      if (left <= 0) { sendBtn.disabled = false; sendBtn.textContent = '发送验证码'; if (timer) clearInterval(timer); return; }
      sendBtn.disabled = true;
      // 纯数字倒计时：不带中文，英文模式不会夹生
      sendBtn.textContent = `${left}s`;
      left--;
    };

    if (sendBtn) sendBtn.onclick = async () => {
      const mail = newMail();
      if (!mail) { say('请先填写新邮箱', true); return; }
      sendBtn.disabled = true;
      try {
        await api.post('/api/profile/email/send', { email: mail });
        say('验证码已发送到新邮箱，10 分钟内有效');
        left = 60;
        tick();
        timer = setInterval(tick, 1000);
      } catch (e) { sendBtn.disabled = false; say(e.message || '发送失败，请稍后重试', true); }
    };

    if (okBtn) okBtn.onclick = async () => {
      const mail = newMail();
      const code = String((document.getElementById('chgCode') as HTMLInputElement | null)?.value || '').trim();
      if (!mail || !code) { say('请填写新邮箱和验证码', true); return; }
      okBtn.disabled = true;
      try {
        await api.post('/api/profile/email/confirm', { email: mail, code });
        if (timer) clearInterval(timer);
        closeModal();
        toast('邮箱已更换，下次请用新邮箱登录');
        await load();
        try { refreshRuntime(); } catch (e) { /* 顶栏刷新失败不影响本次修改 */ }
      } catch (e) { okBtn.disabled = false; say(e.message || '更换失败，请稍后重试', true); }
    };
  };

  /* ---------- 壁纸切换联动资料卡横幅 ---------- */
  (function syncBanner() {
    const apply = () => {
      const b = document.getElementById('bg');
      const img = b && getComputedStyle(b).backgroundImage;
      const m = img && img.match(/url\("?([^")]+)"?\)/);
      const el = document.getElementById('pcBanner');
      if (el && m) el.src = m[1];
    };
    setTimeout(apply, 600);
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('.bgswitch button')) setTimeout(apply, 100);
    });
  })();
  
}
