import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/components.css';
import './styles/index.css';
/* 收口 17 组历史断点冲突，统一手机端与 21:9 等比例（管布局定位） */
import './styles/responsive.css';
/* 视觉重构层：Zerexa 高雅公共页 + PowerDNS/HL6 密度控制台。
   只覆盖颜色/字体/圆角/密度，不写 left/top/width/margin，
   因此放在 responsive.css 之后也不会破坏多比例布局。 */
import './styles/theme-noxc.css';
/* 统一动效层必须最后加载：压过 theme-terra 里 6 处 transform:none!important，
   并把四层各写各的时长/缓动收口到同一组令牌。 */
import './styles/motion.css';
/* 布局重构层：浮起的玻璃侧栏 / 顶栏 + 全站液态玻璃材质。
   保留浮岛结构与满铺壁纸，材质色板交给后面的节点层收口。 */
import './styles/liquid-glass.css';
/* Reverie 骨架层：单列版式 / 圆头胶囊 / 发丝线 + 全站手机适配。
   色板由后面的 Noxc 节点层按主 logo 收口，本层不再决定颜色。 */
import './styles/reverie.css';
/* Noxc 节点视觉层：由主 logo（墨黑圆头 N + 一颗蓝点）反推的整站设计语言。
   放在骨架层之后收口色板 / 字体 / 圆角，独立组件层保持最后加载。 */
import './styles/noxc-node.css';
/* 滑块拼图验证是独立组件层：类名全部 tdcap- 前缀，不参与全站色板，
   放在节点层之后收口，避免被按钮/圆角基线回压成直角。 */
import './styles/captcha.css';
/* NodeLoc 第三方登录按钮：独立前缀，最后加载以免被按钮基线回压。 */
import './styles/oauth.css';
/* 切页过渡：Miku 冒出来 + 跳转中气泡。挂在 body 上，不随 SPA 页面卸载。 */
import { mountTransition } from './lib/pageTransition';

const host = document.getElementById('root');
if (!host) throw new Error('#root 挂载点缺失');

mountTransition();
createRoot(host).render(
  <App />
);
