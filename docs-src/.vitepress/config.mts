import { defineConfig } from 'vitepress';

/* 站点文档：VitePress 静态站，产物由 scripts/copy-docs.mjs 并入
   dist/client/docs/，Worker 把 /docs/* 交给 ASSETS。
   base 必须是 /docs/，否则静态资源路径会指到站点根目录。 */

const zh = [
  { text: '关于 Noxc', link: '/' },
  { text: '快速开始', link: '/quick-start.html' },
  { text: '账号与额度', link: '/accounts.html' },
  { text: 'DNS 记录', link: '/dns.html' },
  { text: 'DNSHE 托管', link: '/dnshe.html' },
  { text: '站点设置', link: '/settings.html' },
  { text: '第三方域名接入', link: '/external-domains.html' },
  { text: '用户案例', link: '/showcase.html' },
  { text: '限制 / FAQ', link: '/faq.html' },
];
const en = [
  { text: 'About', link: '/en/' },
  { text: 'Quick start', link: '/en/quick-start.html' },
  { text: 'Accounts', link: '/en/accounts.html' },
  { text: 'DNS records', link: '/en/dns.html' },
  { text: 'DNSHE hosting', link: '/en/dnshe.html' },
  { text: 'Site settings', link: '/en/settings.html' },
  { text: 'Third-party domains', link: '/en/external-domains.html' },
  { text: 'Showcase', link: '/en/showcase.html' },
  { text: 'Limits / FAQ', link: '/en/faq.html' },
];

export default defineConfig({
  base: '/docs/',
  title: 'Noxc 服务文档',
  description: 'Noxc 免费二级域名分发与 DNS 管理系统的完整使用说明',
  lastUpdated: false,
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#ffffff' }],
    ['meta', { name: 'viewport', content: 'width=device-width,initial-scale=1,viewport-fit=cover' }],
  ],
  locales: {
    root: {
      label: '简体中文', lang: 'zh-CN',
      themeConfig: {
        nav: [...zh.slice(0, 5), { text: '返回站点', link: 'https://nic.299282.xyz/' }],
        sidebar: [{ text: '服务文档', items: zh }],
        outlineTitle: '本页目录',
        docFooter: { prev: '上一篇', next: '下一篇' },
        darkModeSwitchLabel: '主题',
        sidebarMenuLabel: '目录',
        returnToTopLabel: '回到顶部',
        search: { provider: 'local', options: { translations: { button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' }, modal: { noResultsText: '没有找到结果', resetButtonTitle: '清除', displayDetails: '显示详情', backButtonTitle: '返回', footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } } } } },
      },
    },
    en: {
      label: 'English', lang: 'en',
      themeConfig: {
        nav: [...en.slice(0, 5), { text: 'Back to site', link: 'https://nic.299282.xyz/' }],
        sidebar: [{ text: 'Documentation', items: en }],
        outlineTitle: 'On this page',
        docFooter: { prev: 'Previous', next: 'Next' },
        darkModeSwitchLabel: 'Theme',
        sidebarMenuLabel: 'Menu',
        returnToTopLabel: 'Back to top',
        search: { provider: 'local' },
      },
    },
  },
  themeConfig: {
    outline: { level: [2, 3] },
    socialLinks: [],
    footer: { message: 'Noxc · Free Domain Service', copyright: '© 2026 Noxc' },
  },
});
