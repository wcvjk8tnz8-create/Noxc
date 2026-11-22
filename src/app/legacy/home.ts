/**
 * Home 页面控制器（由 home.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, loadBranding, applyBranding } from '../lib/runtime';
import { svgIcon } from '../lib/icons';
import { startI18n } from '../lib/i18n';
import { expiryTipText } from '../../lib/expiry';

import type { LegacyCtx } from '../lib/types';

export async function mountHome(_root: HTMLElement | null): Promise<void> {
  
  loadBranding().then(applyBranding).catch(() => {});
  const yrEl = document.getElementById('yr');
  if (yrEl) yrEl.textContent = String(new Date().getFullYear());
  
  let ROOTS = [];
  let RT = [];
  /* 首推 noxc.uk：无论 /api/config 返回的顺序，都把它排到第一位 */
  const preferNoxc = (list) => [...list].sort((a, b) =>
    (String(b).toLowerCase() === 'noxc.uk' ? 1 : 0) - (String(a).toLowerCase() === 'noxc.uk' ? 1 : 0));
  
  /* ---------- 可选后缀卡片 ----------
     有效期与续期窗口来自 /api/config，不再写死 365 / 180：
     后台把有效期改成 90 天，这里自动变成「单次注册 90 天，到期前 45 天可续期」。 */
  /* HOT = 实际已开通子域名最多的后缀（与「首推」是两个不同维度）。
     用户没展开统计也能在首页后缀卡片上直接看到。 */
  let HOTTEST = '';
  function renderSuffix(list, rules) {
    const box = document.getElementById('suffixGrid');
    if (!list.length) { box.innerHTML = '<div class="nk-sk">暂未配置根域名</div>'; return; }
    const tip = esc(expiryTipText(rules));
    box.innerHTML = list.map((d, i) => {
      const isHot = HOTTEST && String(d).toLowerCase() === HOTTEST;
      const badges = [
        i === 0 ? '<span class="nk-badge">首推</span>' : '',
        isHot ? '<span class="nk-badge nk-badge-hot">HOT</span>' : '',
      ].filter(Boolean).join('');
      return `
      <div class="card nk-suf">
        ${badges ? `<div class="nk-badges">${badges}</div>` : ''}
        <div class="rv-suf-ico">${svgIcon('leaf', 18)}</div>
        <div class="nk-suf-name">.${esc(d.toUpperCase())}</div>
        <div class="nk-suf-desc">${esc(d)}</div>
        <div class="nk-suf-tip" data-expiry-tip>${tip}</div>
      </div>`;
    }).join('');
  }
  
  /* ---------- 记录类型标签 ---------- */
  function renderTags() {
    const box = document.getElementById('rtTags');
    if (!RT.length) return;
    const show = RT.slice(0, 13).map((t) => `<span class="nk-tag mono">${esc(t.key)}</span>`).join('');
    const rest = RT.slice(13).map((t) => `<span class="nk-tag mono">${esc(t.key)}</span>`).join('');
    box.innerHTML = show + (rest ? `<span class="nk-tag-hidden" id="rtRest">${rest}</span>` : '');
    const more = document.getElementById('rtMore');
    if (!rest) { more.style.display = 'none'; return; }
    more.onclick = () => {
      const el = document.getElementById('rtRest');
      const on = el.classList.toggle('show');
      more.textContent = on ? '收起' : '更多…';
    };
  }
  
  /* ---------- 按根域名展开的统计清单 ---------- */
  function renderBreakdown(list, fmt) {
    const rows = document.getElementById('statBreakdownRows');
    if (!rows) return;
    const items = Array.isArray(list) ? list : [];
    if (!items.length) {
      rows.innerHTML = '<div class="rv-bd-empty" data-en="No suffix data yet">暂无后缀数据</div>';
      return;
    }
    rows.innerHTML = items.map((r) => {
      const d = String(r.domain || '').trim().toLowerCase();
      const hot = HOTTEST && d === HOTTEST;
      return `<div class="rv-bd-row">
        <span class="rv-bd-name mono">.${esc(d)}${hot ? '<em class="rv-bd-hot">HOT</em>' : ''}</span>
        <span class="rv-bd-num">${fmt(r.domains)}</span>
        <span class="rv-bd-num">${fmt(r.users)}</span>
      </div>`;
    }).join('');
    /* 动态节点也走一遍 i18n，英文模式表头 / 空态不会冒中文 */
    try { startI18n(); } catch {}
  }

  function renderHottest(hot) {
    const box = document.getElementById('statHottest');
    if (!box) return;
    if (!hot) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = `<span class="rv-hottest-label" data-en="Most active suffix">最热后缀</span>
      <b class="mono">.${esc(hot)}</b><em class="rv-bd-hot">HOT</em>`;
    box.hidden = false;
    try { startI18n(); } catch {}
  }

  /* 点击「已开通域名」展开 / 收起 */
  const toggle = document.getElementById('statDomainsToggle');
  const panel = document.getElementById('statBreakdown');
  if (toggle && panel) {
    toggle.onclick = () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
  }

  /* ---------- 初始化配置 ---------- */
  (async () => {
    try {
      const cfg = await api.get('/api/config');
      ROOTS = Array.isArray(cfg.rootDomains) && cfg.rootDomains.length
        ? cfg.rootDomains
        : (cfg.rootDomain ? [cfg.rootDomain] : []);
      ROOTS = preferNoxc(ROOTS);
      RT = Array.isArray(cfg.recordTypes) ? cfg.recordTypes : [];
      /* qRoot 现在是下拉框：列出全部已配置根域名，可切换查询其它后缀 */
      const sel = document.getElementById('qRoot') as HTMLSelectElement | null;
      if (sel) {
        sel.innerHTML = ROOTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')
          || '<option value="">—</option>';
        const want = new URLSearchParams(location.search).get('root');
        if (want && ROOTS.indexOf(want) >= 0) sel.value = want;
      }
      /* 站点公开数据：与 /api/config 同一次请求返回，不新增首屏往返，
         也不会出现「先 0 后补数」的分阶段加载。 */
      const st = cfg.publicStats;
      const fmt = (n) => {
        const v = Number(n);
        return Number.isFinite(v) ? v.toLocaleString('zh-CN') : '—';
      };
      if (st && typeof st === 'object') {
        document.querySelectorAll('[data-stat-users]').forEach((el) => { el.textContent = fmt(st.users); });
        document.querySelectorAll('[data-stat-domains]').forEach((el) => { el.textContent = fmt(st.domains); });
        HOTTEST = String(st.hottest || '').trim().toLowerCase();
        renderBreakdown(st.roots, fmt);
        renderHottest(HOTTEST);
      }
      const expiry = cfg.expiry || {};
      renderSuffix(ROOTS, expiry);
      /* 四张特性卡的「有效期」也跟站点设置走，不再写「长期有效」误导用户 */
      const fact = document.getElementById('factValidDays');
      if (fact && Number.isFinite(Number(expiry.validDays))) {
        fact.textContent = `${Number(expiry.validDays)} 天`;
      }
      renderTags();
      try {
        const h = location.origin;
        if (h && h !== 'null') {
          document.getElementById('apiHost').textContent = h;
          document.querySelectorAll('.c-str').forEach(() => {});
        }
      } catch {}
    } catch {}
  })();
  
  /* ---------- 域名查询：一次查全部后缀 ---------- */
  const STATE = {
    free: '可用', available: '可用',
    pending: '审核中', registered: '已注册', taken: '已注册',
    rejected: '已驳回', suspended: '已停用', reserved: '系统保留',
  };
  document.getElementById('searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const label = document.getElementById('qName').value.trim();
    const box = document.getElementById('results');
    if (!label) { box.innerHTML = '<div class="nk-res-empty">请输入域名前缀</div>'; return; }
    box.innerHTML = '<div class="nk-res-empty rv-loading">查询中… <span class="rv-dots"><i></i><i></i><i></i></span></div>';
  
    const sel = document.getElementById('qRoot') as HTMLSelectElement | null;
    const picked = (sel && sel.value && ROOTS.indexOf(sel.value) >= 0) ? sel.value : ROOTS[0];
    const jobs = (picked ? [picked] : ROOTS).map((root) =>
      api.get('/api/whois?name=' + encodeURIComponent(label + '.' + root))
        .then((d) => ({ root, data: d.result || d, err: null }))
        .catch((err) => ({ root, data: null, err: err.message || '查询失败' }))
    );
    const rs = await Promise.all(jobs);
    box.innerHTML = rs.map(({ root, data, err }) => {
      if (err) return `<div class="card nk-res err"><div class="nk-res-name mono">${esc(label + '.' + root)}</div><div class="nk-res-state">${esc(err)}</div></div>`;
      const st = data.state || data.status || '';
      const txt = STATE[st] || st || '未知';
      const free = ['free', 'available'].includes(st);
      return `<div class="card nk-res ${free ? 'ok' : 'no'}">
        <div class="nk-res-name mono">${esc((label + '.' + root).toUpperCase())}</div>
        <div class="nk-res-state">${esc(txt)}</div>
        <div class="nk-res-act">${free
          ? `<a class="btn sm primary" href="/register?label=${encodeURIComponent(label)}&root=${encodeURIComponent(root)}">立即注册 ${svgIcon('arrow', 15)}</a>`
          : `<span class="nk-res-dim">域名不可用</span>`}</div>
      </div>`;
    }).join('');
  });
  
}
