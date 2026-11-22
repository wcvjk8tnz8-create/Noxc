/**
 * Noxc · 修改密码弹窗（邮箱验证码版）
 *
 * 控制台「域名管理」与个人资料「安全设置」各有一个 #btnPwd，以前两处各自
 * 复制了一份「原密码 + 新密码」弹窗，改口径时极易漏掉一处。现在统一收敛到
 * 这里：验证码发到当前账号邮箱，校验通过才写新密码，不再要求原密码。
 *
 * 故意不把 email 放在前端传参里 —— 后端 /api/auth/password/send-code 与
 * /api/auth/password 都从会话里取 u.email，防止拿自己邮箱的码改别人账号。
 */
import { api, esc, toast, openModal, closeModal } from './runtime';

export function openPasswordChangeModal(): void {
  openModal('修改密码', `
    <div class="field">
      <label>当前账号邮箱</label>
      <input id="pwdMail" disabled placeholder="验证码将发送至当前账号邮箱">
      <div class="hint">修改密码需通过账号邮箱的验证码确认，不再需要输入原密码。</div>
    </div>
    <div class="field">
      <label>验证码</label>
      <div class="row" style="gap:8px;align-items:center">
        <input id="pwdCode" inputmode="numeric" maxlength="6" placeholder="6 位验证码" style="flex:1;min-width:0">
        <button type="button" class="btn sm" id="btnPwdSend">发送验证码</button>
      </div>
      <div class="hint" id="pwdTip">验证码 10 分钟内有效</div>
    </div>
    <div class="field">
      <label>新密码（至少 8 位）</label>
      <input id="pwdNew" type="password" autocomplete="new-password" placeholder="至少 8 位">
    </div>
    <div class="row end">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" id="btnPwdOk">确认修改</button>
    </div>`);

  const sendBtn = document.getElementById('btnPwdSend') as HTMLButtonElement | null;
  const okBtn = document.getElementById('btnPwdOk') as HTMLButtonElement | null;
  const tip = document.getElementById('pwdTip');
  const mailEl = document.getElementById('pwdMail') as HTMLInputElement | null;
  const codeEl = document.getElementById('pwdCode') as HTMLInputElement | null;
  const newEl = document.getElementById('pwdNew') as HTMLInputElement | null;

  const say = (msg: string, bad = false) => {
    if (!tip) return;
    tip.textContent = msg;
    tip.style.color = bad ? 'var(--danger)' : 'var(--ok)';
  };

  let left = 0, timer: any = null;
  const tick = () => {
    if (!sendBtn || !sendBtn.isConnected) { if (timer) clearInterval(timer); return; }
    if (left <= 0) {
      sendBtn.disabled = false;
      sendBtn.textContent = '发送验证码';
      if (timer) clearInterval(timer);
      return;
    }
    sendBtn.disabled = true;
    // 纯数字倒计时：不带中文，英文模式不会夹生
    sendBtn.textContent = `${left}s`;
    left--;
  };

  if (sendBtn) sendBtn.onclick = async () => {
    sendBtn.disabled = true;
    try {
      const r: any = await api.post('/api/auth/password/send-code', {});
      if (mailEl && r?.email) mailEl.value = esc(String(r.email));
      say('验证码已发送到当前账号邮箱，10 分钟内有效');
      left = 60;
      tick();
      timer = setInterval(tick, 1000);
    } catch (e: any) {
      sendBtn.disabled = false;
      say(e?.message || '发送失败，请稍后重试', true);
    }
  };

  if (okBtn) okBtn.onclick = async () => {
    const code = String(codeEl?.value || '').trim();
    const newPassword = String(newEl?.value || '');
    if (!code) { say('请先获取并填写验证码', true); return; }
    if (newPassword.length < 8) { say('新密码至少 8 位', true); return; }
    okBtn.disabled = true;
    try {
      await api.post('/api/auth/password', { code, newPassword });
      if (timer) clearInterval(timer);
      closeModal();
      toast('密码已修改，其它设备已登出');
    } catch (e: any) {
      okBtn.disabled = false;
      say(e?.message || '修改失败，请稍后重试', true);
    }
  };
}
