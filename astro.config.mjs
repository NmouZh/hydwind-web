import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://hydwind.cn',
  integrations: [
    starlight({
      title: 'Hydwind',
      description: 'Hydwind 生存服 · 官方 Wiki、公开组织与玩家自传',
      favicon: '/favicon.svg',
      customCss: ['./src/styles/theme.css'],
      defaultLocale: 'root',
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
      },
      lastUpdated: true,
      pagination: true,
      credits: false,
      components: {
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/NmouZh/hydwind-web',
        },
      ],
      sidebar: [
        {
          label: '站点',
          items: [
            { label: '门户首页', link: '/' },
            { label: '公开组织', link: '/orgs/' },
            { label: '玩家自传', link: '/players/' },
          ],
        },
        {
          label: '开始',
          items: [
            { label: '加入服务器', slug: 'wiki/start/join' },
            { label: '社群与交流', slug: 'wiki/start/community' },
            { label: '常见问题', slug: 'wiki/start/faq' },
          ],
        },
        {
          label: '服务器规则',
          items: [
            { label: '规则总览', slug: 'wiki/rules' },
            { label: '建筑与领地', slug: 'wiki/rules/building' },
            { label: '交易与经济', slug: 'wiki/rules/trade' },
            { label: '红石与机器', slug: 'wiki/rules/redstone' },
            { label: '聊天与社群', slug: 'wiki/rules/chat' },
          ],
        },
        {
          label: '世界',
          items: [
            { label: '地图与坐标', slug: 'wiki/world/map' },
            { label: '服务器风景', slug: 'wiki/world/scenery' },
          ],
        },
        {
          label: '服务器',
          items: [
            { label: '玩法与节奏', slug: 'wiki/server/features' },
            { label: '最新公告', slug: 'wiki/server/news' },
            { label: '支持服务器', slug: 'wiki/server/support' },
          ],
        },
      ],
    }),
  ],
});
