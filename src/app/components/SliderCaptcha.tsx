import { useCallback, useEffect, useRef, useState } from 'react';

// 与 public/img/captcha/*.webp、src/lib/captcha.ts 的 CAPTCHA_IMAGES 保持一致
const IMAGE_NAMES = ['typhoon', 'meoy', 'miku', 'cloud'];

/**
 * SliderCaptcha · Uiverse Reverie 风格的图片拼图滑块
 *
 * 图库来自用户提供的四张图（public/img/captcha/*.webp），云朵 >_ 做滑块按钮图标。
 * 关键点：
 *  · 坐标用 320×180 基准，渲染按舞台实际宽度等比缩放 → 手机不跑位；
 *  · pointer events 统一鼠标 / 触屏 / 触控笔，另给键盘 ←→ + Enter 通道；
 *  · 拖动轨迹真实采样（时间 + 坐标）随提交一起交给服务端，挡掉直接 POST 的脚本；
 *  · 成功后通过 window.__TD_CAPTCHA__ 把一次性票据交给 legacy 注册控制器。
 */
type Challenge = {
  id: string; token: string; img: string; x: number; y: number;
  w: number; h: number; piece: number; exp: number;
};
type Status = 'loading' | 'ready' | 'verifying' | 'ok' | 'fail' | 'error';

type Props = { onPass: (token: string | null) => void };

const KNOB = 44;
const MIN_SAMPLES = 4;
const MIN_DURATION = 240;

function langHeader(): Record<string, string> {
  let lang = 'zh';
  try { lang = localStorage.getItem('terradata_lang') === 'en' ? 'en' : 'zh'; } catch { /* noop */ }
  return { 'Content-Type': 'application/json', 'X-Lang': lang };
}

export default function SliderCaptcha({ onPass }: Props) {
  const [ch, setCh] = useState<Challenge | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [msg, setMsg] = useState('');
  const [pos, setPos] = useState(0);           // 当前位移（实际像素）
  const [scale, setScale] = useState(1);
  const [required, setRequired] = useState(true);

  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const traceRef = useRef<Array<{ t: number; x: number }>>([]);
  const tokenRef = useRef<string>('');
  const posRef = useRef(0);          // 与 setPos 同步，避免 pointerup 读到旧 state
  const loadRef = useRef<() => void>(() => {});
  const passRef = useRef(onPass);
  const aliveRef = useRef(true);
  const keyboardRef = useRef(false);
  passRef.current = onPass;

  const setPosition = (v: number) => { posRef.current = v; setPos(v); };

  const maxPx = (c: Challenge | null, s: number, trackW: number) =>
    c ? Math.min((c.w - c.piece) * s, Math.max(0, trackW - KNOB)) : 0;

  const publish = useCallback((_token: string | null, needed: boolean) => {
    (window as any).__TD_CAPTCHA__ = {
      required: needed,
      get: () => tokenRef.current,
      reset: () => { tokenRef.current = ''; loadRef.current(); },
    };
    // btnApply 由 legacy 注册控制器持有，组件重新领图时也要同步它的禁用态：
    // 否则首屏「组件已发布但按钮仍是可点」会让人以为点不动是坏了。
    const btn = document.getElementById('btnApply') as HTMLButtonElement | null;
    if (btn) btn.disabled = !!(needed && !tokenRef.current);
  }, []);

  const load = useCallback(async () => {
    setStatus('loading'); setMsg(''); setPosition(0);
    tokenRef.current = '';
    traceRef.current = [];
    passRef.current(null);
    try {
      const res = await fetch('/api/subdomains/captcha', { credentials: 'same-origin', headers: langHeader() });
      const d: any = await res.json().catch(() => ({}));
      if (!aliveRef.current) return;
      if (!d.success) {
        setStatus('error'); setMsg(d.message || '验证载入失败，点击重试');
        return;
      }
      if (d.enabled === false) {
        // 后台关掉了验证：前端隐藏、后端注册接口同步放行，不制造死路
        setRequired(false); tokenRef.current = '';
        publish(null, false); passRef.current('');
        setStatus('ok');
        return;
      }
      setRequired(true);
      setCh(d as Challenge);
      setStatus('ready');
      publish(null, true);
      // 预热其余图，换图时不再等网络（四张合计约 90KB）
      for (const n of IMAGE_NAMES) {
        const p = new Image(); p.src = `/img/captcha/${n}.webp`;
      }
    } catch {
      if (!aliveRef.current) return;
      setStatus('error'); setMsg('验证载入失败，点击重试');
    }
  }, [publish]);
  loadRef.current = load;

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; delete (window as any).__TD_CAPTCHA__; };
  }, [load]);

  // 舞台宽度变化时重算缩放（手机旋转、侧栏折叠、窗口resize）
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / (ch?.w || 320));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', measure); };
  }, [ch?.w]);

  // 挑战过期：静默换新图，不让用户卡在死票据上
  useEffect(() => {
    if (!ch?.exp) return;
    const left = ch.exp - Date.now();
    if (left <= 0) { load(); return; }
    const t = window.setTimeout(() => {
      if (status !== 'ok') { setMsg('验证已过期，请重新完成'); load(); }
    }, left + 50);
    return () => window.clearTimeout(t);
  }, [ch?.exp, status, load]);

  const trackW = trackRef.current?.clientWidth || (ch ? ch.w * scale : 320);
  const max = maxPx(ch, scale, trackW);

  const sample = (x: number, t: number) => {
    const arr = traceRef.current;
    const last = arr[arr.length - 1];
    if (!last || t - last.t >= 12 || Math.abs(x - last.x) >= 2) arr.push({ t, x });
  };

  const submit = async (finalPos: number, keyboard: boolean) => {
    if (!ch || status === 'verifying' || status === 'ok') return;
    const dur = traceRef.current.length ? traceRef.current[traceRef.current.length - 1].t : 0;
    // 拖得太快时先等满最小观察窗再提交，避免真人被「操作太快」误伤
    if (!keyboard && dur < MIN_DURATION) {
      await new Promise((r) => setTimeout(r, MIN_DURATION - dur + 20));
    }
    const baseX = finalPos / (scale || 1);
    sample(baseX, Math.max(dur, MIN_DURATION));
    setStatus('verifying');
    setMsg('正在验证…');
    try {
      const res = await fetch('/api/subdomains/captcha/verify', {
        method: 'POST', credentials: 'same-origin', headers: langHeader(),
        body: JSON.stringify({
          id: ch.id, token: ch.token, x: baseX,
          trace: traceRef.current, keyboard,
        }),
      });
      const d: any = await res.json().catch(() => ({}));
      if (!aliveRef.current) return;
      if (d.success && d.passToken) {
        tokenRef.current = d.passToken;
        setStatus('ok'); setMsg('验证通过');
        publish(d.passToken, true);
        passRef.current(d.passToken);
      } else {
        setStatus('fail');
        setMsg(d.message || '验证未通过，请重新完成');
        publish(null, true);
        passRef.current(null);
        window.setTimeout(() => { if (aliveRef.current) load(); }, 950);
      }
    } catch {
      if (!aliveRef.current) return;
      setStatus('error'); setMsg('网络异常，点击重试');
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!ch || (status !== 'ready' && status !== 'fail')) return;
    keyboardRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const t0 = performance.now();
    dragRef.current = { startX: e.clientX, startPos: posRef.current, t0, moved: false };
    traceRef.current = [{ t: 0, x: posRef.current / (scale || 1) }];
    setStatus('ready'); setMsg('');
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || !ch) return;
    const next = Math.max(0, Math.min(max, d.startPos + (e.clientX - d.startX)));
    d.moved = d.moved || Math.abs(next - d.startPos) > 1;
    setPosition(next);
    sample(next / (scale || 1), performance.now() - d.t0);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    dragRef.current = null;
    const finalPos = posRef.current;
    if (traceRef.current.length < MIN_SAMPLES) {
      // 点击式 / 极短拖动：补一条提示，不伪造轨迹
      setStatus('fail'); setMsg('请按住滑块拖动到缺口处');
      window.setTimeout(() => { if (aliveRef.current) load(); }, 950);
      return;
    }
    submit(finalPos, false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!ch || (status !== 'ready' && status !== 'fail')) return;
    const cur = posRef.current;
    const step = 6 * (scale || 1);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(max, cur + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, cur - step);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = max;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (traceRef.current.length < MIN_SAMPLES) {
        setMsg('请用方向键移动滑块到缺口处'); return;
      }
      submit(cur, true); return;
    }
    if (next === null) return;
    e.preventDefault();
    if (!dragRef.current || !keyboardRef.current) {
      keyboardRef.current = true;
      dragRef.current = { t0: performance.now() };
      traceRef.current = [{ t: 0, x: cur / (scale || 1) }];
    }
    setPosition(next);
    sample(next / (scale || 1), performance.now() - dragRef.current.t0);
  };

  if (!required) return null;

  const s = scale || 1;
  const stageH = ch ? ch.h * s : 180;
  const imgUrl = ch ? `/img/captcha/${ch.img}.webp` : '';
  const stateCls = status === 'ok' ? 'is-ok' : status === 'fail' || status === 'error' ? 'is-bad' : '';

  return (
    <div className={`tdcap ${stateCls}`} data-captcha-state={status}>
      <div className="tdcap-head">
        <span className="tdcap-title">安全验证</span>
        <span className="tdcap-sub">拖动下方滑块，把图块对齐到缺口</span>
        <button type="button" className="tdcap-refresh" onClick={() => load()} aria-label="换一张图片">换一张</button>
      </div>

      <div className="tdcap-stage" ref={stageRef} style={{ height: stageH }}>
        {ch && (
          <>
            <img className="tdcap-bg" src={imgUrl} alt="验证图片" draggable={false} />
            <div className="tdcap-hole" style={{
              left: ch.x * s, top: ch.y * s,
              width: ch.piece * s, height: ch.piece * s,
            }} />
            <div className="tdcap-piece" style={{
              top: ch.y * s, left: 0,
              width: ch.piece * s, height: ch.piece * s,
              transform: `translateX(${pos}px)`,
              backgroundImage: `url(${imgUrl})`,
              backgroundSize: `${(ch.w || 320) * s}px ${(ch.h || 180) * s}px`,
              backgroundPosition: `${-ch.x * s}px ${-ch.y * s}px`,
            }} />
            {(status === 'loading' || status === 'verifying') && (
              <div className="tdcap-mask"><span>{status === 'loading' ? '载入中…' : '正在验证…'}</span></div>
            )}
            {status === 'ok' && <div className="tdcap-pass">✓ 验证通过</div>}
          </>
        )}
        {(status === 'error' || !ch) && status !== 'loading' && (
          <div className="tdcap-mask tdcap-click" onClick={() => load()}>
            <span>{msg || '验证载入失败，点击重试'}</span>
          </div>
        )}
      </div>

      <div className="tdcap-track" ref={trackRef}>
        <div className="tdcap-fill" style={{ width: Math.max(0, pos + KNOB / 2) }} />
        <span className={`tdcap-hint ${pos > 6 ? 'gone' : ''}`}>向右拖动完成拼图</span>
        <button
          type="button" className="tdcap-knob"
          style={{ transform: `translateX(${pos}px)` }}
          role="slider" tabIndex={0}
          aria-label="拖动滑块完成拼图验证"
          aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(pos)}
          aria-disabled={status === 'ok' || status === 'verifying'}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <img src="/img/captcha/knob.webp" alt="" draggable={false} />
          <span className="tdcap-arrow">›</span>
        </button>
      </div>

      <div className="tdcap-foot" aria-live="polite">
        {status === 'ok' ? '验证通过，可以提交注册了'
          : status === 'fail' || status === 'error' ? (msg || '验证未通过，请重新完成')
            : status === 'verifying' ? '正在验证…'
              : '验证通过后才能提交注册申请'}
      </div>
    </div>
  );
}
