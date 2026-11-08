// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// 站点地址可由构建环境覆盖：上 TLS/域名时设置 HYDWIND_SITE_URL=https://hydwind.example.com，
// 同时把该域名自动加入 security.allowedDomains，不用再改源码。
const siteUrl = (process.env.HYDWIND_SITE_URL?.trim() || 'http://103.236.99.253:62179').replace(
  /\/$/,
  ''
);
const siteHost = (() => {
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return '103.236.99.253';
  }
})();

const allowedDomains = [
  { hostname: '103.236.99.253' },
  { hostname: 'localhost' },
  { hostname: '127.0.0.1' },
];
if (siteHost && !allowedDomains.some((entry) => entry.hostname === siteHost)) {
  allowedDomains.unshift({ hostname: siteHost });
}

// https://astro.build/config
// 站点从纯静态升级为「静态页面 + 服务端 API」：
// - 内容页（首页 / 指南 / 人物）仍 prerender 成静态 HTML
// - /api/* 由 Node 适配器在运行时处理，用于服务器状态与议题（Issue）系统
export default defineConfig({
  site: siteUrl,
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
    checkOrigin: true,
    allowedDomains,
    // Astro 会给构建期处理过的 script/style 生成 hash。这里补上其余资源的白名单：
    // - 用户传记允许外链图片，img-src 需要 https:；
    // - 首页在 /api/status 不可用时会直连两个公开状态源；
    // - 行内 style 属性（--enter-delay、品牌小柱子）用 style-src-attr 放行。
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
        "img-src 'self' data: https:",
        "font-src 'self'",
        "connect-src 'self' https://api.mcsrvstat.us https://api.mcstatus.io",
        "manifest-src 'self'",
        "worker-src 'self'",
        "media-src 'self'",
      ],
      styleDirective: {
        resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }],
      },
    },
  },
  // 站内链接提前抓一遍 HTML：导航点下去先有内容，再谈动效。
  // viewport 策略照顾手机（没有 hover），hover 策略让桌面鼠标扫过就预取。
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
});
