// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
// 站点从纯静态升级为「静态页面 + 服务端 API」：
// - 内容页（首页 / 指南 / 人物）仍 prerender 成静态 HTML
// - /api/* 由 Node 适配器在运行时处理，用于服务器状态与议题（Issue）系统
export default defineConfig({
  site: 'https://hydwind.lovie.me',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
});
