// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
// 站点是「静态内容页 + SSR 页面 + /api 反代」：
// - 首页 / 指南 / 账号等预渲染成静态 HTML
// - /people/、/people/[slug]、/gate 显式 prerender=false，运行时调 hydwind-api
// - /api/* 由 Node 适配器全部反代给 hydwind-api（HYDWIND_API_ORIGIN）
export default defineConfig({
  site: 'http://103.236.99.253:62179',
  output: 'server',
  // 默认 1GB 的请求体上限等于没有；接口最大也就几千字，1MB 足够
  adapter: node({ mode: 'standalone', bodySizeLimit: 1024 * 1024 }),
  // 开发工具栏在 390px 视口下会盖住底部导航中间三项（z-index 2e9），
  // 真实点击会被它吃掉；这个项目用不到它，直接关掉。
  devToolbar: { enabled: false },
  // 生产反代后必须让 Astro 认可真实 Host，否则 request.url 会回落成 localhost：
  // - 反代给后端的 X-Forwarded-Host / Proto 会变成 localhost，Origin 对不上；
  // - X-Forwarded-For 只有 Host 被验证后才会被信任，clientAddress（再转给后端做限流）
  //   才能拿到真实 IP。
  security: {
    allowedDomains: [
      { hostname: '103.236.99.253' },
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
