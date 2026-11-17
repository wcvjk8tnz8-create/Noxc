/**
 * Login 页面控制器（由 index.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, toast, loadBranding, applyBranding } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountLogin(_root: HTMLElement | null): Promise<void> {
  
  // 登录页顶栏不再放壁纸切换器（新版式留白优先）。
  // 兼容旧结构：若页面里仍有 #bgsw，保持为空即可，不再注入任何按钮。
  const bgsw = document.getElementById('bgsw');
  if (bgsw) bgsw.innerHTML = '';
  loadBranding().then((b) => {
    applyBranding(b);
    const navLogo = document.getElementById('navLogo') as HTMLImageElement | null;
    if (navLogo) navLogo.src = b.logoUrl;
  });
  
  const tabLogin = document.getElementById('tabLogin'), tabReg = document.getElementById('tabReg');
  const paneLogin = document.getElementById('paneLogin'), paneReg = document.getElementById('paneReg');
  const paneReset = document.getElementById('paneReset');
  /* 三个面板：login / reg / reset（忘记密码）。
     重置面板没有顶部 tab，显示时两个 tab 都取消高亮。 */
  function switchTo(which) {
    const login = which === 'login', reg = which === 'reg', reset = which === 'reset';
    tabLogin.classList.toggle('active', login);
    tabReg.classList.toggle('active', reg);
    paneLogin.classList.toggle('hidden', !login);
    paneReg.classList.toggle('hidden', !reg);
    if (paneReset) paneReset.classList.toggle('hidden', !reset);
  }
  tabLogin.onclick = () => switchTo('login');
  tabReg.onclick = () => switchTo('reg');
  document.getElementById('navReg').onclick = (e) => { e.preventDefault(); switchTo('reg'); };
  
  document.getElementById('btnLogin').onclick = async () => {
    const email = document.getElementById('lEmail').value.trim();
    const password = document.getElementById('lPass').value;
    const remember = document.getElementById('lRemember').checked;
    if (!email || !password) return toast('请输入邮箱和密码', 'err');
    try {
      const d = await api.post('/api/auth/login', { email, password, remember });
      toast('登录成功' + (d.user.role === 'admin' ? '，管理员（不限配额）' : ''));
      setTimeout(() => location.href = '/dashboard', 400);
    } catch (e) { toast(e.message, 'err'); }
  };
  
  document.getElementById('btnReg').onclick = async () => {
    const email = document.getElementById('rEmail').value.trim();
    const password = document.getElementById('rPass').value;
    if (!email || !password) return toast('请输入邮箱和密码', 'err');
    if (password.length < 8) return toast('密码至少 8 位', 'err');
    if (!document.getElementById('rAgree').checked) return toast('请先勾选同意《服务条款与免责声明》', 'err');
    try {
      const body: Record<string, any> = { email, password, agreeTerms: true };
      const codeEl = document.getElementById('rCode');
      if (codeEl && codeEl.offsetParent !== null) {
        if (!codeEl.value.trim()) return toast('请填写邮箱验证码', 'err');
        body.code = codeEl.value.trim();
      }
      const d = await api.post('/api/auth/register', body);
      toast(d.isFirstAdmin ? '注册成功，已设为管理员（不限配额）' : '注册成功');
      setTimeout(() => location.href = '/dashboard', 400);
    } catch (e) { toast(e.message, 'err'); }
  };
  
  /* ---------- 忘记密码 ---------- */
  
  document.getElementById('forgotLink').onclick = (e) => { e.preventDefault(); switchTo('reset'); };
  document.getElementById('backLogin').onclick = (e) => { e.preventDefault(); switchTo('login'); };
  
  /* 发送验证码（register / reset） */
  async function sendCode(scene, emailInput, btn, hint) {
    const email = document.getElementById(emailInput).value.trim();
    if (!email) return toast('请先填写邮箱', 'err');
    const old = btn.textContent;
    btn.disabled = true;
    let left = 60;
    btn.textContent = left + 's';
    const t = setInterval(() => {
      left--;
      if (left <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = old; }
      else btn.textContent = left + 's';
    }, 1000);
    try {
      await api.post('/api/auth/verify/send', { email, scene });
      toast('验证码已发送，请查收邮件');
      if (hint) hint.textContent = '验证码已发送，10 分钟内有效';
    } catch (e) {
      clearInterval(t);
      btn.disabled = false;
      btn.textContent = old;
      toast(e.message, 'err');
      if (hint) hint.textContent = e.message;
    }
  }
  document.getElementById('btnSendReset').onclick = () =>
    sendCode('reset', 'fEmail', document.getElementById('btnSendReset'), document.getElementById('fCodeHint'));
  document.getElementById('btnSendReg').onclick = () =>
    sendCode('register', 'rEmail', document.getElementById('btnSendReg'), document.getElementById('rCodeHint'));
  
  document.getElementById('btnReset').onclick = async () => {
    const email = document.getElementById('fEmail').value.trim();
    const code = document.getElementById('fCode').value.trim();
    const password = document.getElementById('fPass').value;
    if (!email || !code) return toast('请填写邮箱与验证码', 'err');
    if (!password || password.length < 8) return toast('新密码至少 8 位', 'err');
    try {
      await api.post('/api/auth/reset', { email, code, password });
      toast('密码已重置，请使用新密码登录');
      document.getElementById('lEmail').value = email;
      switchTo('login');
    } catch (e) { toast(e.message, 'err'); }
  };
  
  api.get('/api/rules').then((r) => {
    // 文案由后端按当前规则下发（默认：白名单 ∪ 任意含 "edu" 的邮箱），
    // 不在前端拼域名列表，避免英文模式下出现动态中文或中英夹生。
    document.getElementById('mailHint').textContent =
      r.emailRuleHint || '支持白名单邮箱，以及任何包含 "edu" 的邮箱注册';
    document.getElementById('ipRule').textContent =
      `同一网络最多注册 ${r.maxAccountsPerIp} 个账号，超限账号一经发现将被全部封禁。`;
    document.getElementById('agreeLabel').innerHTML =
      `我已阅读并同意<a href="/terms" target="_blank">《服务条款与免责声明》</a>，了解并接受禁止滥用与免责条款`;
  }).catch((e) => console.error("初始化失败", e));
  
  // 后台开启「注册需要验证码」时才显示验证码输入框
  api.get('/api/config').then((cfg) => {
    if (cfg && (cfg.mailVerifyRequired || cfg.verifyRequired)) {
      const f = document.getElementById('rCodeField');
      if (f) f.style.display = '';
    }
  }).catch((e) => console.error("初始化失败", e));
  
  // 登录态探测已由 head 脚本完成（命中则直接跳控制台），这里不再重复请求
  
  // 从 WHOIS 页带名称过来：/?q=xxx
  const preQ = new URLSearchParams(location.search).get('q');
  if (preQ) { switchTo('reg'); document.getElementById('rEmail').focus(); }

  /* ---------- 第三方邮箱注册申请 ----------
     邮箱不符合当前规则时，访客可提交申请；管理员在后台通过后写入
     email_allowlist，该地址即在任何规则模式下都能注册。 */
  const REQ_STATUS_TEXT: Record<string, string> = {
    none: '',
    pending: '申请已提交，请等待管理员审核',
    approved: '申请已通过，请直接用该邮箱注册',
    rejected: '申请被驳回，24 小时后可重新提交',
    unnecessary: '该邮箱已符合注册规则，直接注册即可',
    registered: '该邮箱已注册，请直接登录',
    cooldown: '24 小时内已提交过，请稍后再试',
    expired: '可以重新提交申请',
    unknown: '申请服务暂不可用，请稍后再试',
  };

  function openEmailRequest() {
    const old = document.getElementById('erMask');
    if (old) old.remove();
    const mask = document.createElement('div');
    mask.id = 'erMask';
    mask.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(16,26,22,.42);backdrop-filter:blur(6px);display:grid;place-items:center;padding:16px';
    mask.innerHTML = `
      <div class="card" role="dialog" aria-modal="true" aria-label="申请使用第三方邮箱注册"
           style="width:min(460px,94vw);max-height:88vh;overflow:auto;padding:20px">
        <h2 class="auth-title" style="font-size:19px;margin:0 0 6px">申请使用第三方邮箱注册</h2>
        <p class="auth-sub" style="margin:0 0 6px">当前规则放行的邮箱可直接注册。</p>
        <p class="auth-sub" style="margin:0 0 16px">其它邮箱请提交申请，管理员通过后即可使用，不会向你发送邮件。</p>
        <div class="field"><label>邮箱</label><input id="erEmail" type="email" placeholder="name@example.com" autocomplete="username"></div>
        <div class="field"><label>申请理由（选填）</label><textarea id="erReason" rows="3" maxlength="300" style="width:100%;resize:vertical" placeholder="简单说明用途，方便管理员审核"></textarea></div>
        <div class="field"><label>联系方式（选填）</label><input id="erContact" type="text" maxlength="120" placeholder="Telegram / 其它联系方式"></div>
        <input id="erWebsite" type="text" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
        <div class="hint" id="erStatus" style="min-height:18px;margin:2px 0 12px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn sm" id="erCheck" type="button">查询状态</button>
          <button class="btn" id="erCancel" type="button">取消</button>
          <button class="btn primary" id="erSubmit" type="button">提交申请</button>
        </div>
      </div>`;
    document.body.appendChild(mask);

    const el = (id: string) => document.getElementById(id) as HTMLInputElement | null;
    const statusEl = document.getElementById('erStatus');
    const close = () => mask.remove();
    const showStatus = (s: string) => { if (statusEl) statusEl.textContent = REQ_STATUS_TEXT[s] || s; };
    const mailValue = () => (el('erEmail')?.value || '').trim().toLowerCase();

    (el('erEmail') as HTMLInputElement).value = (document.getElementById('rEmail') as HTMLInputElement)?.value || '';
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    document.getElementById('erCancel')!.onclick = close;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);

    document.getElementById('erCheck')!.onclick = async () => {
      const mail = mailValue();
      if (!mail) return toast('请先填写邮箱', 'err');
      try {
        const r = await api.get('/api/email-request/status?email=' + encodeURIComponent(mail));
        const s = String(r.status || 'none');
        showStatus(s === 'none' ? '暂无申请记录，可以提交申请' : s);
      } catch (e) { toast(e.message, 'err'); }
    };

    document.getElementById('erSubmit')!.onclick = async () => {
      const mail = mailValue();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) return toast('请填写有效的邮箱地址', 'err');
      const btn = document.getElementById('erSubmit') as HTMLButtonElement;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '提交中…';
      try {
        const r = await api.post('/api/email-request', {
          email: mail,
          reason: el('erReason')?.value || '',
          contact: el('erContact')?.value || '',
          website: el('erWebsite')?.value || '',
        });
        showStatus(String(r.status || 'pending'));
        if (r.status === 'pending') toast('申请已提交，请等待管理员审核');
      } catch (e) {
        showStatus('提交失败，请稍后再试');
        toast(e.message, 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    };
    (el('erEmail') as HTMLInputElement).focus();
  }

  const reqLink = document.getElementById('emailReqLink');
  if (reqLink) reqLink.onclick = (e) => { e.preventDefault(); openEmailRequest(); };
}
