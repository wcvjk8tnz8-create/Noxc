import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import { announcement, loadAnnouncement } from './announcement';
import './custom.css';

/* layout-top 插槽位于顶栏下方、内容上方：公告条不压导航、不随客户端
   路由丢失；用 h() 的纯文本子节点渲染，绝不 v-html（管理员输入原样呈现）。 */
export default {
  extends: DefaultTheme,
  enhanceApp() { void loadAnnouncement(); },
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-top': () => announcement.value
        ? h('div', { id: 'siteAnnouncement', role: 'status', 'data-no-i18n': '' }, [
            h('span', { class: 'sa-dot' }),
            h('span', { class: 'sa-text' }, announcement.value),
          ])
        : null,
    });
  },
};
