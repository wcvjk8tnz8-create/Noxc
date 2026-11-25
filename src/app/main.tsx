import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

/* ── 样式架构：4 层 ──────────────────────────────────────────────────────
   shell.css          唯一结构层：原 8 个样式文件按既有加载顺序合并，
                      颜色全部令牌化，渐变 / 毛玻璃 / 投影在源头删除。
   captcha.css        滑块验证（tdcap- 前缀，独立组件）
   oauth.css          NodeLoc 登录（td-oauth- 前缀，独立组件）
   design-system.css  唯一视觉源：令牌 + Zerexa 排版骨架
   nodeloc-skin.css   形态层：NodeLoc 3.0 全圆角 / 等宽字 / 两段式查询 / 动效开关，最后加载
                      （不定义颜色，明/暗主题仍由 design-system.css 决定）
   ────────────────────────────────────────────────────────────────────── */
import './styles/shell.css';
import './styles/captcha.css';
import './styles/oauth.css';
import './styles/design-system.css';
import './styles/nodeloc-skin.css';

/* ── 动效默认关闭 ───────────────────────────────────────────────────────
   社区反馈「网站太卡、动画效果太多」：上一轮只删了 Miku 切页过渡，历史层
   仍常驻花瓣 / 猫爪 / 柔光呼吸 / 圆点 pulse 与几十条 hover 过渡。这里在入口
   统一把 documentElement 标成 paused，形态层既有降级链路会把它们全停掉，
   控制台 / 直接打开的 SPA 页面同样生效，不必每页各写一份。
   只有用户在首页点「恢复动效」（localStorage 记 0）才放开，选择跨页保留。 */
try {
  if (localStorage.getItem('noxc-motion-paused') !== '0') {
    document.documentElement.dataset.motion = 'paused';
  }
} catch {
  document.documentElement.dataset.motion = 'paused';
}

const host = document.getElementById('root');
if (!host) throw new Error('#root 挂载点缺失');

createRoot(host).render(
  <App />
);
