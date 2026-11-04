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
  // 默认 1GB 的请求体上限等于没有；接口最大也就几千字，1MB 足够
  adapter: node({ mode: 'standalone', bodySizeLimit: 1024 * 1024 }),
  // 开发工具栏在 390px 视口下会盖住底部导航中间三项（z-index 2e9），
  // 真实点击会被它吃掉；这个项目用不到它，直接关掉。
  devToolbar: { enabled: false },
  // 生产反代后必须让 Astro 认可真实 Host，否则 request.url 会回落成 localhost：
  // - 登录接口的同源校验会 403（浏览器 Origin 永远对不上 localhost）；
  // - X-Forwarded-For 只有 Host 被验证后才会被信任，限流才能按真实 IP 分桶。
  security: {
    allowedDomains: [
      { hostname: 'hydwind.lovie.me' },
      { hostname: 'localhost' },
      { hostname: '127.0.0.1' },
    ],
  },
  // 站内链接提前抓一遍 HTML：导航点下去先有内容，再谈动效。
  // viewport 策略照顾手机（没有 hover），hover 策略让桌面鼠标扫过就预取。
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
});
