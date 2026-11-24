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

const host = document.getElementById('root');
if (!host) throw new Error('#root 挂载点缺失');

createRoot(host).render(
  <App />
);
