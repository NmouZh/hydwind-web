# 服务器名称 · Minecraft 生存服官网

在 Hydwind 门户的 **Astro 7 + Starlight** 工程骨架上重做的生存服官网。工程结构、构建链路、内容集合与页头页脚组件全部沿用，只换了一阵套视觉层。

- 技术栈：Astro 7 + Starlight，纯静态输出（`dist/`），可直接部署到 EdgeOne Pages / Cloudflare Pages / GitHub Pages
- Node 要求：`>= 22.23.4`（见 `.node-version`）
- 视觉：深色底 `#0a0b0d`、宋体标题、等宽小字标签、1px 发丝网格、朱红 `#e0523f` 点缀

## 页面结构

| 路由 | 内容 | 渲染方式 |
| --- | --- | --- |
| `/` | 首页：首屏状态票券、概览、玩法、节奏、风景、公告、加入、社群、FAQ | Astro 页面 `src/pages/index.astro` |
| `/rules/` | 服务器规则：建筑 / 交易 / 红石 / 聊天四组 + 处理方式 | Astro 页面 |
| `/world/` | 地图与坐标：定位图、常用坐标、三条路线 | Astro 页面 |
| `/support/` | 支持服务器：开销进度 + 三档权益 + 公平原则 | Astro 页面 |
| `/wiki/` | 脚手架自带的 Starlight 文档（侧边栏 + 目录 + Pagefind 搜索） | Starlight |
| `/orgs/`、`/players/`、`/news/` | 脚手架自带的示例内容集合，用不到可以整段删除 | 内容集合 |

## 改内容

首页与三个内页的所有文案都在 **`src/data/site.ts`**，字段名与原静态模板的 `site-data.js` 一一对应：

```ts
export const site = {
  siteName: "服务器名称",      // 页头、页脚、首屏大标题
  serverAddress: "play.yourserver.com",
  onlineCount: 0, maxCount: 300,
  overview: [ /* 概览四格 */ ],
  features: [ /* 玩法四条 */ ],
  stats: [ /* 节奏条 */ ],
  scenery: [ /* 风景三张，第一张自动通栏 */ ],
  news: [ /* 公告三条 */ ],
  joinSteps: [ /* 加入三步 */ ],
  community: { /* 社群与二维码 */ },
  faq: [ /* 常见问题 */ ],
};
```

- **换二维码**：把图片放进 `public/images/`，`community.qrImage` 填 `/images/qrcode.png`，页面会自动替换虚线占位框。
- **换配色**：`src/styles/tokens.css` 里的 `--hw-bg`、`--hw-line`、`--hw-accent` 三个变量决定整体气质，Wiki 与门户页同步生效。
- **换页头导航**：`src/components/PortalHeader.astro` 顶部的 `nav` 数组。

## 样式分层

| 文件 | 作用 |
| --- | --- |
| `src/styles/tokens.css` | 设计令牌：颜色、字体、版心、圆角 |
| `src/styles/portal.css` | 门户通用件：页头、导航、页脚、筛选条、内容卡；Wiki 主题在 `theme.css` |
| `src/styles/survival.css` | 本次新增的页面级样式，按原模板的 class 名（`hero`/`section-block`/`server-ticket`…）编写 |

## 开发与构建

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # 输出到 dist/
pnpm preview
```

## 部署

上传 `dist/` 即可，无服务端依赖。若沿用 EdgeOne Pages，构建命令 `pnpm build`、输出目录 `dist`，Node 版本按 `.node-version` 设置。

## 说明

站内服务器名、地址、在线人数、公告日期与坐标都是占位数据，上线前逐项替换；`/wiki`、`/orgs`、`/players` 是脚手架示例内容，可按需删除或替换。
