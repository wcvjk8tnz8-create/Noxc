/**
 * Register 页面控制器（由 register.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, toast, mountShell, onDoc } from '../lib/runtime';
import { POINT_DEFAULTS } from '../../lib/pointDefaults';
import { expiryTipText } from '../../lib/expiry';

import type { LegacyCtx } from '../lib/types';
import { currentLang, startI18n } from '../lib/i18n';
import {
  configureApplyPause, applyPauseLock, isApplyPausedFor,
  lockApplyButton, unlockApplyButton, sortPreferred,
} from '../lib/applyPause';

export async function mountRegister(_root: HTMLElement | null): Promise<void> {
  
  var ROOTS = [];
  var AI_ROOTS = [];
  var DNS_UNLIMITED = [];
  var ROOT_COSTS = {};
  var POINT_RULES = {
    checkin: POINT_DEFAULTS.checkin,
    initial: POINT_DEFAULTS.initial,
    domainCost: POINT_DEFAULTS.domainCost,
    shortCost: POINT_DEFAULTS.shortCost,
    shortLen: POINT_DEFAULTS.shortLen,
  };
  var checkTimer = 0;
  /* D1 读取节流：注册页每敲一个字都会查一次可用性，旧版 350ms debounce
     仍会在连续输入时打出十几个 /api/subdomains/check（每次内部多点查库）。
     现在：600ms 防抖 + 同值 15 秒结果缓存 + 过期响应序号丢弃。 */
  var checkSeq = 0;
  var checkCache = Object.create(null);

  /* 当前后缀的规则提示：AI 自动审核 / DNS 记录不限 */
  function updateRootTip(d){
    var el = document.getElementById('aiRootTip');
    if (!el) return;
    var bits = [];
    var inAi = AI_ROOTS.indexOf('*') >= 0 || AI_ROOTS.indexOf(d) >= 0;
    if (inAi) bits.push('该后缀由 AI 自动审核，通过后立即开通（无需人工同意）');
    else if (d) bits.push('该后缀不在 AI 自动审核名单内，申请会进入人工审核');
    if (DNS_UNLIMITED.indexOf(d) >= 0) bits.push('DNS 记录数不限');
    el.textContent = bits.length ? (inAi ? '' : '') + bits.join(' · ') : '';
    el.style.display = bits.length ? '' : 'none';
  }
  var APPLY_PAUSED = false;       // 缓存给旧逻辑读，真正判定一律走 applyLockNow()
  var GLOBAL_PAUSED = false;
  var PAUSED_ROOTS = [];
  var APPLY_MSG = '';
  var IS_ADMIN = false;

  /* 「提交注册」硬锁的唯一判定：全局暂停 ∪ 当前后缀单独暂停。
     React 的滑块验证回调、loadPending、切后缀、onclick、doSubmit 全部问它，
     不再依赖某个会被异步回调冲掉的缓存变量。 */
  function applyLockNow(){
    var lk = applyPauseLock(currentRoot(), currentLang() === 'en' ? 'en' : 'zh');
    APPLY_PAUSED = lk.paused;
    APPLY_MSG = lk.message || APPLY_MSG;
    return lk;
  }
  // 供 React 注册页（滑块弹窗回调）复用同一份判定
  (window as any).__TD_APPLY_LOCKED__ = function(){ return applyLockNow(); };

  /* 主推域名 = sortPreferred() 后的第一个（noxc.uk 优先，与首页「首推」一致）。
     被暂停的根域名根本不进 ROOTS，所以用户点不到、也不会卡死在暂停后缀上。 */
  function primaryRoot(){ return ROOTS[0] || ''; }
  function syncUrlRoot(d){
    try {
      var u = new URL(location.href);
      u.searchParams.set('root', d);
      history.replaceState({}, '', u.toString());
    } catch {}
  }
  /* 当前选中后缀被暂停（URL 带进来 / 后台中途改设置）→ 自动切到主推域名，
     而不是把后缀选择器也锁死。全部后缀都暂停时没有可切目标，返回 false 保持硬锁。 */
  function autoSwitchToPrimary(){
    var p = primaryRoot();
    if (!p) return false;
    syncUrlRoot(p);
    selectRoot(p);
    return true;
  }
  // 与 /api/config、后端注册接口同一份判定；config 未回来前按「需要验证」处理
  var CAPTCHA_ENABLED = true;
  
  function esc(s){ return String(s ?? '').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function currentRoot(){
    var btn = document.getElementById('rootPickerBtn');
    if (btn && btn.getAttribute('data-root')) return btn.getAttribute('data-root');
    return ROOTS[0] || '';
  }
  function rootQuery(){ var r = currentRoot(); return r ? '&root=' + encodeURIComponent(r) : ''; }
  
  /* 后台暂停新申请：普通用户锁定整个表单，管理员仍可自建 */
  function setApplyPaused(msg){
    APPLY_MSG = msg || '站点已暂停新域名申请，请稍后再试。';
    var tip = document.getElementById('applyTip');
    if (tip) {
      tip.className = 'alert a-warn';
      tip.style.display = '';
      tip.innerHTML = '<b>新域名申请已暂停</b><br>' + esc(APPLY_MSG)
        + '<br><span style="opacity:.8;font-size:12px">已注册的域名、DNS 记录与续期不受影响。</span>';
    }
    /* 按用户要求：暂停后「一定无法点击提交注册」，前端不区分管理员。
       管理员自建仍由后端豁免，只是这里不给任何人留可点的提交入口。 */
    APPLY_PAUSED = true;
    /* 后缀选择器永远可点：以前连它一起 disabled，用户切到暂停后缀后就再切不回来。
       现在暂停后缀压根不在菜单里，选择器留着只会指向开放后缀。 */
    ['label','note','agreeUse'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) (el as HTMLButtonElement).disabled = true;
    });
    var btn = document.getElementById('btnApply');
    lockApplyButton(btn);
    if (btn) btn.textContent = '申请已暂停';
    closeRootMenu();
    // 弹窗已经打开时（例如管理员在验证过程中暂停），立刻关掉，别让回调提交
    try { (window as any).__TD_CAPTCHA_CLOSE__?.(); } catch {}
  }

  /* 切到未暂停的后缀（或后台恢复开放）时解除锁定。
     站点级 GLOBAL_PAUSED 优先，绝不因为换后缀被解锁；管理员始终不锁。
     解除后重新同步「待审核」状态，避免把 pending 锁误清掉。 */
  function clearApplyPaused(){
    var lk = applyLockNow();
    if (lk.paused) { setApplyPaused(lk.message); return; }   // 兜底：绝不在暂停态解锁
    var tip = document.getElementById('applyTip');
    if (tip) { tip.style.display = 'none'; tip.innerHTML = ''; }
    ['label','note','agreeUse'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) (el as HTMLButtonElement).disabled = false;
    });
    unlockApplyButton(document.getElementById('btnApply'), true);
    try { loadPending(); } catch (e) {}
  }

  /* 全局暂停 ∪ 当前后缀暂停。切换后缀、配置回来、检查接口回来都走这里。 */
  function syncApplyPause(){
    var lk = applyLockNow();
    if (lk.paused && !GLOBAL_PAUSED) {
      var cur = String(currentRoot() || '').toLowerCase().replace(/\.+$/, '');
      // 当前选中后缀被单独暂停 → 自动切到主推域名，绝不留一个锁死的选择器
      if (cur && isApplyPausedFor(cur) && autoSwitchToPrimary()) return;
    }
    if (lk.paused) { setApplyPaused(lk.message); return; }
    clearApplyPaused();
  }

  /* ───── 根域名选择器（参考 DnsNeko） ─────
     原来是塞在窄胶囊里的原生 <select>：弹层由浏览器绘制、样式不可控、
     小屏还会被裁。改为自定义按钮 + 浮层列表，每项右侧标 Free。 */
  function closeRootMenu(){
    var menu = document.getElementById('rootPickerMenu');
    var btn = document.getElementById('rootPickerBtn');
    if (menu) { menu.classList.remove('show'); menu.setAttribute('aria-hidden', 'true'); }
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  function toggleRootMenu(){
    var menu = document.getElementById('rootPickerMenu');
    var btn = document.getElementById('rootPickerBtn') as HTMLButtonElement;
    if (!menu || !btn || btn.disabled) return;
    var on = !menu.classList.contains('show');
    menu.classList.toggle('show', on);
    menu.setAttribute('aria-hidden', on ? 'false' : 'true');
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function selectRoot(d){
    if (!d) return;
    d = String(d).toLowerCase().replace(/\.+$/, '');
    /* 被暂停的根域名不能被点击：即使旧缓存的菜单还残留这一项，
       点它也只会跳到主推域名，不会把页面锁死。 */
    if (isApplyPausedFor(d)) {
      var p = primaryRoot();
      if (!p || p === d) return;
      d = p;
      syncUrlRoot(d);
    }
    var btn = document.getElementById('rootPickerBtn');
    var span = document.getElementById('rootDomain');
    if (span) span.textContent = d;
    if (btn) btn.setAttribute('data-root', d);
    document.querySelectorAll('#rootPickerMenu .root-opt').forEach(function(el){
      var on = el.getAttribute('data-root') === d;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    closeRootMenu();
    updateRootTip(d);
    syncUrlRoot(d);
    syncApplyPause();
    try { window.dispatchEvent(new CustomEvent('terradata:root', { detail: d })); } catch {}
    var v = (document.getElementById('label') as HTMLInputElement)?.value.trim();
    if (v) runCheck(v);   // 换后缀立即重新查可用性
  }

  async function setupRoots(){
    try {
      var cfg = await api.get('/api/config');
      if (typeof cfg.captchaEnabled === 'boolean') CAPTCHA_ENABLED = cfg.captchaEnabled;
      GLOBAL_PAUSED = !!cfg.applyPaused;
      APPLY_MSG = String(cfg.applyPausedMessage || '').trim() || APPLY_MSG;
      PAUSED_ROOTS = Array.isArray(cfg.pausedRoots)
        ? cfg.pausedRoots.map(function(d){ return String(d).trim().toLowerCase(); }) : [];
      configureApplyPause({
        applyPaused: !!cfg.applyPaused,
        applyPausedMessage: cfg.applyPausedMessage,
        pausedRoots: cfg.pausedRoots,
      });
      if (cfg.applyPaused) setApplyPaused(cfg.applyPausedMessage);
      var list = Array.isArray(cfg.rootDomains) && cfg.rootDomains.length
        ? cfg.rootDomains
        : (cfg.rootDomain ? [cfg.rootDomain] : []);
      /* 被暂停申请的根域名直接从可选列表剔除，并把主推域名排到第一位。
         这样首页/注册页都不会再出现它，用户也点不到、切不进去。 */
      list = sortPreferred(list);
      ROOTS = list;
      AI_ROOTS = Array.isArray(cfg.aiReviewRoots) ? cfg.aiReviewRoots : [];
      DNS_UNLIMITED = Array.isArray(cfg.dnsUnlimitedRoots) ? cfg.dnsUnlimitedRoots : [];
      ROOT_COSTS = (cfg.rootPointCosts && typeof cfg.rootPointCosts === 'object') ? cfg.rootPointCosts : {};
      if (cfg.pointRules) POINT_RULES = Object.assign({}, POINT_RULES, cfg.pointRules);
      /* 注册须知的规则行随后台设置实时更新，杜绝「页面写 5 分、实际扣 60 分」 */
      var faq = document.getElementById('faqPointRules');
      if (faq) {
        faq.textContent = '当前规则：普通域名 ' + POINT_RULES.domainCost + ' 分 · 单字域名 '
          + POINT_RULES.shortCost + ' 分 · 每日签到 +' + POINT_RULES.checkin
          + ' 分 · 新用户初始 ' + POINT_RULES.initial + ' 分';
      }
      /* 有效期与续期窗口同样随站点设置变，不再写死 365 / 180 */
      var expiryFaq = document.getElementById('faqExpiry');
      if (expiryFaq && cfg.expiry) expiryFaq.textContent = expiryTipText(cfg.expiry);
      updateRootTip(list[0] || '');

      /* 每个后缀在菜单里直接标出消耗积分：0 = Free，未配置 = 按全局规则 */
      function costLabel(d){
        var has = Object.prototype.hasOwnProperty.call(ROOT_COSTS, d);
        var n = has ? Number(ROOT_COSTS[d]) : Number(POINT_RULES.domainCost || 0);
        if (!Number.isFinite(n)) n = 0;
        return n === 0 ? 'Free' : (n + ' 分');
      }

      /* AI 状态可视化：说明「为什么这次没走 AI」——
         常见原因是后台还没填 Key、开关被关、或当前账号是管理员（免审核）。 */
      var aiTip = document.getElementById('aiStatusTip');
      if (aiTip) {
        var st = cfg.aiStatus || {};
        var isWorkers = st.provider === 'workers-ai';
        var msg = '';
        if (!st.ready) msg = isWorkers
          ? 'Workers AI 未绑定（需在 wrangler.toml 配置 [ai] binding）：申请会回落人工审核。'
          : 'AI 自动审核未配置 API Key：申请会回落人工审核。';
        else if (!st.enabled) msg = 'AI 自动审核开关已关闭：申请会回落人工审核。';
        else if (!st.modelSelected) msg = isWorkers
          ? 'Workers AI 自动审核已就绪（将使用 Cloudflare 内置模型）；管理员账号免审核，不会触发 AI。'
          : 'AI 自动审核已就绪（未指定模型，将使用 agnes-2.5-flash）；管理员账号免审核，不会触发 AI。';
        else msg = 'AI 自动审核已就绪，审核模型 ' + esc(st.model) + '；管理员账号免审核，不会触发 AI。';
        aiTip.textContent = msg;
        aiTip.style.display = '';
      }

      var btn = document.getElementById('rootPickerBtn') as HTMLButtonElement;
      var span = document.getElementById('rootDomain');
      var menu = document.getElementById('rootPickerMenu');
      // 兼容仍使用旧 #rootWrap / #rootDomainSel 结构的页面
      if (!btn || !span || !menu) {
        var wrap = document.getElementById('rootWrap');
        if (wrap && list.length > 1) {
          wrap.innerHTML = '<span style="opacity:.5">.</span><select id="rootDomainSel">'
            + list.map(function(d){ return '<option value="' + esc(d) + '">' + esc(d) + '</option>'; }).join('')
            + '</select>';
        } else if (span) span.textContent = list[0] || '';
        return;
      }

      var first = list[0] || '';
      span.textContent = first;
      btn.setAttribute('data-root', first);

      if (list.length <= 1) {
        btn.classList.add('single');
        menu.innerHTML = '';
        syncApplyPause();
        return;   // 只有一个后缀：整块就是静态文字，不展开
      }

      menu.innerHTML = list.map(function(d, i){
        var paused = isApplyPausedFor(d);
        return '<button type="button" class="root-opt' + (i === 0 ? ' on' : '') + '" role="option"'
          + ' data-root="' + esc(d) + '" data-paused="' + (paused ? '1' : '0') + '"'
          + (paused ? ' disabled aria-disabled="true"' : '')
          + ' aria-selected="' + (i === 0 ? 'true' : 'false') + '">'
          + '<span class="root-opt-name">.' + esc(d.toUpperCase()) + '</span>'
          + (paused
              ? '<span class="root-opt-free" data-en="PAUSED" style="opacity:.75">暂停</span>'
              : '<span class="root-opt-free">' + esc(costLabel(d)) + '</span>')
          + '</button>';
      }).join('');
      menu.querySelectorAll('.root-opt').forEach(function(el){
        (el as HTMLButtonElement).onclick = function(){ selectRoot(el.getAttribute('data-root')); };
      });
      try { startI18n(); } catch {}
      btn.onclick = function(e){ e.stopPropagation(); toggleRootMenu(); };
      // /register?label=foo&root=v-1.top：从 WHOIS / 落地页带后缀跳进来时保持选中
      try {
        var want = new URLSearchParams(location.search).get('root');
        if (want) {
          var w = String(want).toLowerCase().replace(/\.+$/, '');
          if (list.indexOf(w) >= 0) selectRoot(w);
          else if (first) syncUrlRoot(first);   // 暂停 / 不存在的后缀：自动改为主推域名
        }
      } catch {}
      syncApplyPause();
      try { window.dispatchEvent(new CustomEvent('terradata:root', { detail: first })); } catch {}
      // 点外部 / Esc 关闭；监听随切页自动注销
      onDoc('click', function(e){
        if (!(e.target as HTMLElement)?.closest?.('#rootPicker')) closeRootMenu();
      });
      onDoc('keydown', function(e){ if (e.key === 'Escape') closeRootMenu(); });
    } catch (e) {}
  }
  
  async function runCheck(v){
    var tip = document.getElementById('checkTip');
    var costBox = document.getElementById('costBox');
    if (!v) { tip.innerHTML = '输入前缀后自动检查是否可用，仅支持字母、数字与连字符。'; costBox.style.display = 'none'; return; }
    var seq = ++checkSeq;
    var key = String(currentRoot() || '') + '|' + v;
    var hit = checkCache[key];
    var r;
    if (hit && Date.now() - hit.at < 15_000) r = hit.data;   // 命中缓存：一个请求都不发
    else {
      try {
        r = await api.get('/api/subdomains/check?label=' + encodeURIComponent(v) + rootQuery());
        checkCache[key] = { at: Date.now(), data: r };
      } catch (e) {
        if (seq !== checkSeq) return;
        tip.innerHTML = '检查失败，请稍后重试'; costBox.style.display = 'none'; return;
      }
    }
    if (seq !== checkSeq) return;   // 输入已变化：旧响应不许覆盖新结果
      if (r.applyPaused) setApplyPaused(r.applyPausedMessage);   // 页面打开后才暂停也能即时提示
      else syncApplyPause();                                    // 任何检查结果都再核一次当前后缀
      var link =' <a href="/whois?name=' + encodeURIComponent(v) + '" target="_blank" style="font-size:11.5px">whois 详情</a>';
      tip.innerHTML = (r.available
        ? '<span style="color:var(--ok)">' + esc(r.fqdn) + ' 可以注册</span>'
        : '<span style="color:var(--danger)">' + esc(r.message) + '</span>') + link;
  
      if (r.available && r.cost > 0) {
        costBox.style.display = '';
        costBox.innerHTML = '<div class="alert ' + (r.enough ? 'a-info' : 'a-red') + '" style="margin-top:14px">'
          + (r.short && !r.rootOverride ? '<b>单字域名</b> · ' : '')
          + '本次消耗 <b>' + r.cost + '</b> 分 · 当前余额 <b>' + (r.points ?? 0) + '</b> 分'
          + (r.enough ? '' : '<br>积分不足，可前往签到地每日领取')
          + '</div>';
      } else if (r.available) {
        costBox.style.display = '';
        costBox.innerHTML = '<div class="alert a-info" style="margin-top:14px">'
          + (r.isAdmin ? '管理员申请不消耗积分' : (r.rootOverride ? '该后缀已设为 0 分，本次免费' : '本次不消耗积分'))
          + '</div>';
      } else {
        costBox.style.display = 'none';
      }
  }
  
  /* 待审核申请：同一时间只能有一个 */
  async function loadPending(){
    var box = document.getElementById('pendingBox');
    var btn = document.getElementById('btnApply');
    var labelEl = document.getElementById('label');
    try {
      var d = await api.get('/api/subdomains');
      var pending = (d.items || []).filter(function(s){ return s.status === 'pending'; });
      if (!pending.length) {
        box.innerHTML = '';
        // 暂停态优先：任何异步回调都不得把「提交注册」重新启用
        if (applyLockNow().paused) { setApplyPaused(APPLY_MSG); return; }
        labelEl.disabled = false;
        unlockApplyButton(btn, true);
        return;
      }
      var f = pending[0].fqdn || pending[0].label;
      box.innerHTML = '<div class="alert a-warn" style="margin-top:16px">你已有一个待审核的申请：<b>' + esc(f)
        + '</b><br>同一时间只能申请一个域名，请等待审核结果（或被驳回）后再提交。</div>';
      btn.disabled = true;
      labelEl.disabled = true;
      btn.textContent = '待审核中';
    } catch (e) {}
  }
  
  /* 本机已同意过免责则自动勾选 */
  try {
    if (localStorage.getItem('meoy_agree_use') === '1') {
      var ag = document.getElementById('agreeUse');
      if (ag) ag.checked = true;
    }
  } catch (e) {}
  
  document.getElementById('label').addEventListener('input', function(e){
    var v = e.target.value.trim();
    clearTimeout(checkTimer);
    if (!v) {
      document.getElementById('checkTip').innerHTML = '输入前缀后自动检查是否可用，仅支持字母、数字与连字符。';
      document.getElementById('costBox').style.display = 'none';
      return;
    }
    checkTimer = setTimeout(function(){ runCheck(v); }, 600);
  });
  
  /* 真正的注册提交：弹窗验证通过后由回调调用，票据从持久对象读取 */
  async function doSubmit(){
    /* 弹窗已打开时管理员中途暂停 / 用户切到暂停后缀，这里再拦一次：
       验证通过回调也绝不能把请求发出去。 */
    var lk = applyLockNow();
    if (lk.paused) { toast(lk.message, 'err'); return; }
    var label = document.getElementById('label').value.trim();
    var note = document.getElementById('note').value.trim();
    var cap = window.__TD_CAPTCHA_TICKET__ || window.__TD_CAPTCHA__;
    try {
      localStorage.setItem('meoy_agree_use', '1');
      var r = await api.post('/api/subdomains', {
        label: label, note: note, root: currentRoot(),
        captchaToken: cap ? cap.get() : ''
      });
      // 票据一次性：提交回来就领新图，避免「再注册一个」复用已消费的票据
      if (cap && typeof cap.reset === 'function') cap.reset();
      const rejected = r.status === 'rejected';
      // 有新申请时后端会立即排队审核「所有」待审域名；同步判定失败的这一条
      // 很可能在后台几秒内被重新判定，别再写成「等待管理员审核」。
      var pendingMsg = r.aiQueued
        ? '已提交，AI 正在后台自动审核所有待审域名，稍后会自动开通或驳回'
        : r.aiSkipText
          ? '已提交，等待管理员审核（AI 未自动审核：' + r.aiSkipText + '）'
          : '已提交，等待管理员审核';
      // 别把「免审核直接开通」说成「审核通过」：AI 可能压根没调用。
      // 真跑模型会有一次网关往返 + 推理（约 1–5 秒），耗时字段可验证。
      var approvedMsg = r.aiReviewed
        ? 'AI 审核通过（' + (r.aiModel || '自动探测') + '，'
          + (Number(r.aiElapsedMs || 0) / 1000).toFixed(1) + 's），已自动开通'
        : r.approvalSource === 'admin'
          ? '管理员自建，免审核，已直接开通（AI 未调用）'
          : r.approvalSource === 'no-approval-required'
            ? '免审核模式，已直接开通（AI 未参与'
              + (r.aiSkipText ? '：' + r.aiSkipText : '') + '）'
            : '申请成功，已开通';
      toast(rejected
        ? 'AI 审核未通过：' + (r.aiReason || '请修改用途说明后再试')
        : r.status === 'approved'
          ? approvedMsg
          : pendingMsg, rejected ? 'err' : 'ok');
      if (rejected) {
        // 驳回时保留输入，方便用户改写用途说明重新提交；不跳转
        document.getElementById('checkTip').innerHTML = '<span style="color:var(--danger)">'
          + esc(r.aiReason || '用途说明未通过自动审核') + '</span>';
        document.getElementById('costBox').style.display = 'none';
        return;
      }
      document.getElementById('label').value = '';
      document.getElementById('note').value = '';
      document.getElementById('checkTip').innerHTML = (r.status === 'pending' && r.aiQueued)
        ? '<span style="color:var(--ok)">已加入 AI 自动审核队列，后台会处理全部待审域名；稍后刷新「我的域名」查看结果。</span>'
        : (r.status === 'pending' && r.aiSkipText)
          ? '<span style="color:var(--warn)">AI 未自动审核：' + esc(r.aiSkipText)
            + (r.aiAttempts && r.aiAttempts.length
              ? '<br><span class="mono" style="font-size:12px">' + esc(r.aiAttempts.join(' | ').slice(0, 300)) + '</span>' : '')
            + '</span>'
          : '';
      document.getElementById('costBox').style.display = 'none';
      loadPending();
      // 新版四步向导存在时停在第四步展示结果；没有时才沿用旧的自动跳转
      if (typeof (window as any).__TD_WIZARD_DONE === 'function') {
        (window as any).__TD_WIZARD_DONE(r);
      } else {
        setTimeout(function(){ location.href = '/dashboard'; }, 900);
      }
    } catch (e: any) {
      var cap = window.__TD_CAPTCHA_TICKET__ || window.__TD_CAPTCHA__;
      if (e && e.data && e.data.captchaRequired && cap && typeof cap.reset === 'function') cap.reset();
      toast(e.message, 'err');
    }
  };

  /* 点击「提交注册」：表单校验 → 需要验证就弹窗 → 验证通过回调才真正提交。
     刷新 / 直接进页面 / 只是走到第三步，都不会挂载验证，也不会弹窗。 */
  document.getElementById('btnApply').onclick = async function(){
    /* 硬锁第一道：连弹窗都不打开。CSS 还有 pointer-events:none 兜底。 */
    var lk = applyLockNow();
    if (lk.paused) { toast(lk.message, 'err'); setApplyPaused(lk.message); return; }
    var label = document.getElementById('label').value.trim();
    if (!label) return toast('请输入子域名', 'err');
    var agree = document.getElementById('agreeUse');
    if (agree && !agree.checked) return toast('请先勾选免责与使用承诺', 'err');
    var cap = window.__TD_CAPTCHA_TICKET__ || window.__TD_CAPTCHA__;
    if (!IS_ADMIN && CAPTCHA_ENABLED && !(cap && typeof cap.get === 'function' && cap.get())) {
      var open = (window as any).__TD_CAPTCHA_OPEN__;
      if (open) { open(function(){ doSubmit(); }); return; }
    }
    return doSubmit();
  };
  
  (async function init(){
    await mountShell('register');
    try {
      var me = await api.get('/api/auth/me');
      IS_ADMIN = !!(me && (me.role === 'admin' || (me.user && me.user.role === 'admin')));
    } catch (e) {}
    await setupRoots();
    syncApplyPause();          // /api/auth/me 回来后再核一次，消除管理员异步竞态
    await loadPending();
    var q = new URLSearchParams(location.search).get('label');
    if (q) {
      var el = document.getElementById('label');
      if (el) { el.value = q; runCheck(q); }
    }
  })();
  
}
