import { useEffect, useRef, useState } from 'react';
import { mountRegister } from '../legacy/register';
import { refreshRuntime, cleanupPage, readUserCache } from '../lib/runtime';
import SliderCaptcha from '../components/SliderCaptcha';
import { unlockApplyButton, applyPauseLock } from '../lib/applyPause';

/**
 * Register —— 参考 DnsNeko 的四步注册向导。
 * 步骤：使用须知 → 选择域名 → 确认信息 → 提交注册。
 * 后缀选择器嵌在同一个输入框里（点右侧按钮展开浮层，行尾标 Free）。
 * 所有 legacy 控制器依赖的 id 都保留在 DOM 中（隐藏步骤只是 display:none）。
 */
type Summary = { label: string; root: string; fqdn: string; note: string; discountCode: string; pay: string };

export default function RegisterPage() {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(2);           // 默认停在「选择域名」，与 DnsNeko 一致
  const [ok1, setOk1] = useState(true);          // 须知默认已确认，可回第一步重新勾选
  const [ok2, setOk2] = useState(true);
  const [summary, setSummary] = useState<Summary>({ label: '', root: '', fqdn: '', note: '', discountCode: '', pay: '' });
  const [done, setDone] = useState<{
    fqdn: string; status: string; ai: boolean; source: string;
    ms: number; model: string; reason: string; skip: string; queued: boolean;
  } | null>(null);
  const [count, setCount] = useState(0);
  const [noteCount, setNoteCount] = useState(0);
  const [capToken, setCapToken] = useState('');
  const [capOpen, setCapOpen] = useState(false);
  const [capKey, setCapKey] = useState(0);
  // legacy 点「提交注册」时把真正的提交函数暂存到这里，弹窗验证通过后再调用
  const submitRef = useRef<(() => void) | null>(null);
  // 管理员是「开通」不是「申请」，后端同样豁免；缓存未命中时按普通用户处理（多点一下不影响）
  const isAdmin = (() => {
    const u: any = readUserCache();
    return u?.role === 'admin';
  })();

  const onCapPass = (t: string | null) => {
    setCapToken(t || '');
    const btn = document.getElementById('btnApply') as HTMLButtonElement | null;
    /* 以前这里无条件 btn.disabled=false，会把按后缀暂停的硬锁直接冲掉：
       用户仍能点提交、过滑块、发请求（只是最后收到后端 403）。
       现在任何解锁都必须经过唯一入口，暂停态 allowed=false 绝不解锁。 */
    const lk = (window as any).__TD_APPLY_LOCKED__?.() as ReturnType<typeof applyPauseLock> | undefined;
    const locked = !!lk?.paused;
    unlockApplyButton(btn, !locked);
    if (locked) {
      submitRef.current = null;
      setCapOpen(false);
      return;                            // 暂停后验证通过也不提交
    }
    if (!t) return;                      // 领图 / 失败时的 null 不触发提交
    const cont = submitRef.current;
    submitRef.current = null;
    setCapOpen(false);
    if (cont) window.setTimeout(cont, 0);
  };

  const onCapSkip = () => {
    const cont = submitRef.current;
    submitRef.current = null;
    setCapOpen(false);
    const lk = (window as any).__TD_APPLY_LOCKED__?.();
    if (lk?.paused) return;                  // 暂停态不允许「跳过验证直接提交」
    if (cont) window.setTimeout(cont, 0);   // 后台关掉验证：无需票据，直接提交
  };

  const onCapClose = () => {
    submitRef.current = null;
    setCapOpen(false);
  };

  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;

    // 由 legacy 的 btnApply.onclick 调用：只有「真的点了提交」才打开验证弹窗。
    // 同步注册，保证异步 mountRegister / setupRoots 还没跑完时按钮也不会走空。
    (window as any).__TD_CAPTCHA_OPEN__ = (cont: () => void) => {
      if (!alive || isAdmin) return;
      // 暂停后连验证弹窗都不该开；legacy 的 btnApply.onclick 已先拦过一道
      const lk = (window as any).__TD_APPLY_LOCKED__?.();
      if (lk?.paused) { submitRef.current = null; return; }
      submitRef.current = cont;
      setCapKey((k) => k + 1);
      setCapOpen(true);
    };

    // legacy 切到暂停后缀 / 管理员中途暂停时，立刻关掉已打开的验证弹窗
    (window as any).__TD_CAPTCHA_CLOSE__ = () => {
      if (!alive) return;
      submitRef.current = null;
      setCapOpen(false);
    };

    // legacy 提交成功后由这里接管，停在第四步展示结果（不再直接跳 dashboard）
    (window as any).__TD_WIZARD_DONE = (r: any) => {
      if (!alive) return;
      setDone({
        fqdn: String(r?.fqdn || ''),
        status: String(r?.status || ''),
        ai: !!r?.aiReviewed,
        source: String(r?.approvalSource || ''),
        ms: Number(r?.aiElapsedMs || 0),
        model: String(r?.aiModel || ''),
        reason: String(r?.aiReason || ''),
        skip: String(r?.aiSkipText || ''),
        queued: !!r?.aiQueued,
      });
      setStep(4);
    };

    (async () => {
      try { await mountRegister(ref.current); } catch (e) { console.error('[register] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => {
      alive = false;
      delete (window as any).__TD_WIZARD_DONE;
      delete (window as any).__TD_CAPTCHA_OPEN__;
      cleanupPage();
    };
  }, []);

  const readForm = (): Summary => {
    const label = ((document.getElementById('label') as HTMLInputElement)?.value || '').trim();
    const note = ((document.getElementById('note') as HTMLInputElement)?.value || '').trim();
    const btn = document.getElementById('rootPickerBtn');
    const root = btn?.getAttribute('data-root') || (document.getElementById('rootDomain')?.textContent || '').trim();
    const discountCode = ((document.getElementById('discountCode') as HTMLInputElement)?.value || '').trim();
    const costBox = document.getElementById('costBox');
    const pay = costBox?.getAttribute('data-pay') || '';
    return { label, root, fqdn: label && root ? `${label}.${root}` : '', note, discountCode, pay };
  };

  const goConfirm = () => {
    const s = readForm();
    if (!s.label) { setStep(2); return; }
    setSummary(s);
    setStep(3);
  };

  const steps = ['使用须知', '选择域名', '确认信息', '提交注册'];

  return (
    <div className="page-root" ref={ref}>
      <div id="bg"></div>
      <header className="topbar" id="topbar"></header>
      <aside className="sidebar" id="sidebar"></aside>

      <main className="main"><div className="main-in"><div className="wrap reg-wrap">

        {/* 四步进度条 */}
        <div className="reg-steps">
          {steps.map((s, i) => {
            const n = i + 1;
            const cls = n === step ? 'active' : n < step ? 'done' : '';
            return (
              <div className={`reg-step ${cls}`} key={s}>
                <i>{n < step ? '✓' : n}</i><span>{s}</span>
              </div>
            );
          })}
        </div>

        {/* 两条提示：灰 = 不可逆，蓝 = 审核说明 */}
        <div className="reg-notice gray">域名注册后不可自助注销，每账号有注册数量上限！注册前请确保你真正需要这个域名！</div>
        <div className="reg-notice blue"><b>!</b> 请勿申请包含敏感、违规词汇的域名。申请提交后由系统审核，请耐心等待。</div>

        {/* ── 1. 使用须知 ── */}
        <section className={`reg-pane ${step === 1 ? 'active' : ''}`}>
          <div className="card reg-card">
            <div className="reg-field-head"><span className="reg-ico">01</span><div><h3>使用须知 <em>必读</em></h3><p>注册前请先确认以下事项</p></div></div>
            <div className="reg-acc">
              <div className="acc open">1. 域名一经注册不可自助注销</div>
              <div className="acc-body">子域名注册成功后无法自行删除，请在提交前确认名称与后缀无误。</div>
              <div className="acc open">2. 禁止用于违规用途</div>
              <div className="acc-body">严禁钓鱼、仿冒品牌、恶意程序、垃圾邮件、赌博与违法内容，违者立即停用并封禁账号。</div>
              <div className="acc open">3. 审核与 DNS 记录</div>
              <div className="acc-body">提交后进入审核；通过后到「DNS 记录」页按需添加解析，创建时不会自动写入任何记录。</div>
            </div>
            <div className="reg-checks">
              <label><input type="checkbox" checked={ok1} onChange={e => setOk1(e.target.checked)} /> 我已阅读并同意使用须知</label>
              <label><input type="checkbox" checked={ok2} onChange={e => setOk2(e.target.checked)} /> 我了解注册成功后无法自助注销</label>
            </div>
            <div className="reg-actions"><span></span><button className="btn primary" disabled={!ok1 || !ok2} onClick={() => setStep(2)}>下一步 →</button></div>
          </div>
        </section>

        {/* ── 2. 选择域名（含 legacy 表单 id） ── */}
        <section className={`reg-pane ${step === 2 ? 'active' : ''}`}>
          <div className="card reg-card">
            <div className="reg-field-head"><span className="reg-ico">02</span><div><h3>域名前缀 <em>必填</em></h3><p>请输入域名前缀，选择后缀</p></div></div>

            {/* 输入框与后缀选择器合为一体 */}
            <div className="reg-domain-box">
              <input id="label" className="reg-label-input" placeholder="输入域名前缀" autoComplete="off" spellCheck={false}
                     onInput={e => setCount((e.target as HTMLInputElement).value.length)} />
              <span className="reg-count" id="labelCount">{count} / 63</span>
              <div className="root-picker" id="rootPicker" data-no-i18n>
                <button type="button" className="root-picker-btn" id="rootPickerBtn"
                        aria-haspopup="listbox" aria-expanded="false" title="选择根域名">
                  <span className="root-dot">.</span><span id="rootDomain"></span>
                  <svg className="root-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
                </button>
                <div className="root-picker-menu" id="rootPickerMenu" role="listbox" aria-label="选择根域名"></div>
              </div>
            </div>
            <div className="hint" id="checkTip">输入前缀后自动检查是否可用，仅支持字母、数字与连字符。</div>
            <div className="hint" id="aiRootTip" style={{display: "none"}}></div>
            <div className="hint" id="aiStatusTip" style={{display: "none"}}></div>

            <div className="reg-field-head" style={{marginTop: "22px"}}><span className="reg-ico warm">03</span><div><h3>用途说明 <em>必填</em></h3><p>请简单描述您的使用用途</p></div></div>
            <textarea id="note" className="input reg-note" placeholder="请简单描述您的使用用途（必填）" maxLength={200}
                      onInput={e => setNoteCount((e.target as HTMLTextAreaElement).value.length)} />
            <div className="reg-note-count">管理员审核时会看到这段说明。<span>{noteCount} / 200</span></div>

            {/* DC 积分优惠码：注册时直接抵扣本次消耗，留空则不抵扣 */}
            <div style={{marginTop: "18px"}}>
              <label data-en="Points discount code (optional)">积分优惠码 <em style={{opacity:.6,fontWeight:400}}>选填</em></label>
              <input id="discountCode" className="input mono" placeholder="DC-XXXXXX"
                     autoComplete="off" spellCheck={false} style={{textTransform: "uppercase", letterSpacing: ".06em"}} />
              <div className="hint" id="discountTip" data-en="Get one at Rewards Center. It offsets the points cost of this registration; unused codes are not consumed.">
                在「奖励中心」获得；申请域名时直接抵扣本次积分消耗，用不上的码不会被消耗。
              </div>
            </div>

            <div id="costBox" style={{display: "none"}}></div>
            <div id="pendingBox"></div>
            <div id="applyTip" className="alert a-info" style={{display: "none"}}>创建子域名不会自动写入任何 DNS 记录，审核通过后到「DNS 记录」页按需添加。</div>

            <div className="reg-actions">
              <button className="btn ghost" onClick={() => setStep(1)}>← 上一步</button>
              <button className="btn primary" onClick={goConfirm}>下一步 →</button>
            </div>
          </div>
        </section>

        {/* ── 3. 确认信息（提交按钮由 legacy 绑定） ── */}
        <section className={`reg-pane ${step === 3 ? 'active' : ''}`}>
          <div className="card reg-card">
            <div className="reg-field-head"><span className="reg-ico">✓</span><div><h3>确认信息</h3><p>请核对后将提交注册申请</p></div></div>
            <div className="reg-summary">
              <div><span>域名</span><b className="mono">{summary.fqdn || '—'}</b></div>
              <div><span>根域名</span><b className="mono">.{summary.root || '—'}</b></div>
              <div><span>用途说明</span><b>{summary.note || '（未填写）'}</b></div>
              {summary.discountCode && (
                <div><span data-en="Discount code">积分优惠码</span><b className="mono">{summary.discountCode}</b></div>
              )}
              {summary.pay && (
                <div><span data-en="Points to pay">本次实付积分</span><b className="mono">{summary.pay} 分</b></div>
              )}
            </div>
            <label className="check reg-confirm">
              <input type="checkbox" id="agreeUse" />
              <span id="agreeUseLabel">我承诺不将域名用于钓鱼、恶意程序、垃圾邮件等违规用途，并已阅读<a href="/terms" target="_blank">《服务条款与免责声明》</a>：服务按「现状」提供，不对可用性、数据损失及第三方行为承担责任。</span>
            </label>
            {/* 验证改为「点提交后弹窗」：内联在隐藏 .reg-pane 里会量到
                clientWidth=0，是「有时显示不了」的根因。这里只留一行说明。 */}
            <div className="hint" style={{margin: "10px 0 0"}}>点击「提交注册」后完成滑块验证，验证通过会自动提交</div>
            <div className="reg-actions">
              <button className="btn ghost" onClick={() => setStep(2)}>← 上一步</button>
              <button className="btn primary" id="btnApply" data-captcha-ready={capToken ? '1' : '0'}>提交注册</button>
            </div>
          </div>
        </section>

        {/* ── 4. 提交注册 ── */}
        <section className={`reg-pane ${step === 4 ? 'active' : ''}`}>
          <div className="card reg-card reg-done">
            <div className="reg-done-ico">✓</div>
            <h3>申请已提交</h3>
            <p className="mono">{done?.fqdn || summary.fqdn}</p>
            <p className="dim">
              {done?.status === 'rejected'
                ? `AI 审核未通过：${done?.reason || '请修改用途说明后再试'}`
                : done?.status === 'approved' && done?.source === 'ai-pass'
                  ? `AI 自动审核通过（模型 ${done?.model || '自动探测'}，耗时 ${(done?.ms || 0) / 1000}s），已即时开通`
                  : done?.status === 'approved' && done?.source === 'admin'
                    ? '管理员自建，免审核，已直接开通（AI 未调用）'
                    : done?.status === 'approved'
                      ? `当前为免审核模式，已直接开通（AI 未参与${done?.skip ? '：' + done?.skip : ''}）`
                      : done?.queued
                        ? '已提交，AI 正在后台自动审核所有待审域名，稍后会自动开通或驳回'
                        : done?.skip
                          ? `已提交，等待管理员审核（AI 未自动审核：${done?.skip}）`
                          : '已提交，等待管理员审核'}
            </p>
            {done?.status === 'approved' && done?.source !== 'ai-pass' && (
              <p className="dim" style={{ fontSize: 12 }}>
                这次是「免审核直接开通」，不是 AI 判定；真跑模型要 1–5 秒（最坏 20 秒）。
              </p>
            )}
            <div className="reg-actions center">
              <button className="btn ghost" onClick={() => { setDone(null); setStep(2); }}>再注册一个</button>
              <a className="btn primary" href="/dashboard">查看我的域名 →</a>
            </div>
          </div>
        </section>

        {/* 第三方域名接入：独立页面（文档式说明 + 提交申请），控制台卡片仍保留入口 */}
        <div className="card reg-faq" style={{marginBottom:"14px"}}>
          <div className="head-row"><h3 style={{fontSize:"16px"}} data-en="Third-party domain access">第三方域名接入</h3><span className="badge inf" data-en="SEUS DNS only">固定 SEUS DNS</span></div>
          <p className="dim" style={{fontSize:12.5,lineHeight:1.8,margin:"8px 0 0"}} data-en="Bring your own full gTLD domain (e.g. xxx.com). Subdomains such as xxx.example.com are not accepted. Point the registrar NS to SEUS DNS, connect via the SEUS API, then wait for the site owner to approve. Marked as (External domain), no quota usage.">
            想接入自己的完整域名？只允许 <b>gTLD 二级域</b>（如 <b>xxx.com</b>），不接受 <b>xxx.example.com</b> 这类子域名。把注册商 NS 指向 SEUS DNS、用 API 连接后，等待站长在站点设置里批准即可，统一标注「（外部域名）」，不占注册配额。
          </p>
          <p style={{margin:"10px 0 0"}}><a className="btn sm" href="/external-domains" data-en="Open the standalone guide and apply">查看接入指南并提交申请 →</a></p>
        </div>

        {/* 注册须知（折叠） */}
        <div className="card reg-faq">
          <div className="head-row"><h3 style={{fontSize: "16px"}}>注册须知</h3></div>
          <div className="acc">1. 命名规则</div>
          <div className="acc-body">仅支持小写字母、数字与连字符；不能以连字符开头或结尾；长度 1–63 个字符。<code>www</code>、<code>mail</code>、<code>admin</code> 等为系统保留名称，普通用户不可申请。</div>
          <div className="acc">2. 积分与配额</div>
          <div className="acc-body">积分按站点当前规则实时计算：确认页会显示本次消耗，签到地显示每日奖励与初始积分。持有数量受配额限制，管理员不限。</div>
          <div className="acc-body dim" id="faqPointRules" style={{fontSize: 12, opacity: .75}}>当前规则：普通域名 60 分 · 单字域名 300 分 · 每日签到 +30 分 · 新用户初始 100 分</div>
          <div className="acc">3. 有效期与续期</div>
          <div className="acc-body" id="faqExpiry">有效期与续期规则以站点设置为准。</div>
          <div className="acc-body dim" style={{fontSize: 12, opacity: .75}}>有效期剩余少于一半即可续期；管理员持有的域名为永久有效。</div>
          <div className="acc">4. 同一时间只能有一个待审核申请</div>
          <div className="acc-body">已有待审核申请时提交入口会锁定，请等待审核结果（或被驳回）后再提交。</div>
        </div>

      </div></div></main>
      <div id="toast"></div>
      {/* 只有点击提交才挂载；不在任何 .reg-pane 内，舞台可见、宽度真实 */}
      {capOpen && !isAdmin && (
        <SliderCaptcha key={`capmodal:${capKey}:${summary.fqdn}`} modal
          onPass={onCapPass} onSkip={onCapSkip} onClose={onCapClose} />
      )}
    </div>
  );
}
