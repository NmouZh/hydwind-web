# Hydwind Portal

Hydwind 生存服的门户站：**Markdown 为核心**，三类内容（官方 Wiki / 公开组织 / 玩家自传）由同一套内容集合驱动。

技术栈：**Astro 7 + Starlight**，纯静态输出，部署在腾讯云 **EdgeOne Pages**。

## 页面结构

| 路由 | 内容 | 渲染方式 |
| --- | --- | --- |
| `/` | 门户首页：沉浸式 Hero、三类入口、最新公告、服务器信息 | Astro 自定义页面 |
| `/wiki/` | 官方 Wiki（规则、加入、地图、玩法…） | Starlight（侧边栏 + 目录 + Pagefind 全文搜索） |
| `/orgs/` | 公开组织名录（城镇 / 公会 / 工作室） | 内容集合 + 自定义页面，支持类型筛选与搜索 |
| `/orgs/[slug]/` | 组织详情，自动聚合所属玩家 | 内容集合 |
| `/players/` | 玩家自传目录，支持状态筛选与搜索 | 内容集合 |
| `/players/[slug]/` | 玩家档案，自动反查所属组织 | 内容集合 |
| `/news/` | 公告列表与详情 | 内容集合 |

## 内容怎么改

全部在 `src/content/` 下，改完 `git push` 即发布：

```
src/content/
├── docs/wiki/          # Wiki 文档（Starlight）
│   ├── index.md
│   ├── start/{join,community,faq}.md
│   ├── rules/{index,building,trade,redstone,chat}.md
│   ├── world/{map,scenery}.md
│   └── server/{features,news,support}.md
├── orgs/               # 一个组织一个文件
├── players/            # 一位玩家一个文件
└── news/               # 一条公告一个文件
```

### 新增一个组织

```markdown
---
name: 组织名
type: 城镇            # 城镇 / 公会 / 工作室 / 其他
leader: 负责人
members: [A, B]
founded: "2025-01"
coords: 主城西侧 · X -180 / Z 60
status: 招募中        # 招募中 / 满员 / 休整 / 已解散
tags: [建筑, 铁路]
summary: 一句话简介，会显示在卡片和搜索结果里
order: 10
---

正文用 Markdown 写。
```

### 新增一位玩家

```markdown
---
ign: Steve
role: 建筑
org: northbank        # 填组织文件名（不含 .md），自动双向关联
joined: "2025-03"
status: 活跃
tags: [建筑, 红石]
summary: 一句话简介
---

自传正文。
```

字段由 `src/content.config.ts` 里的 Zod schema 校验：**漏字段或类型写错，构建会直接失败**，不会产生半成品页面。

## 本地开发

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # 输出到 dist/
npm run preview
```

> 需要 Node ≥ 22.23.4（Astro 7 的要求），仓库内有 `.node-version`。

## EdgeOne Pages 部署

导入本仓库后按下表配置：

| 配置项 | 值 |
| --- | --- |
| 框架预设 | Astro |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 安装命令 | `npm install` |
| Node 版本 | 22.23.4（或 ≥ 22.23.4） |

纯静态产物，不需要 Node 运行时，也不需要任何环境变量。

**上线前请替换**：`astro.config.mjs` 里的 `site`（当前为 `https://hydwind.cn`）、服务器地址 `play.hydwind.com`、《关联 GitHub 仓库地址》。

## 设计说明

沿用参考站点的视觉语言：深色底（`#0a0b0d`）、大号衬线标题（宋体 / Noto Serif SC）、等宽小字标注（JetBrains Mono）、细线分隔（`rgba(255,255,255,.09)`）、单一红色点缀（`#e0523f`）。

- 设计令牌：`src/styles/tokens.css`
- Starlight 主题覆盖：`src/styles/theme.css`
- 门户自定义页面样式：`src/styles/portal.css`

## 目录

```
src/
├── components/       PortalHeader / PortalFooter / Logo / ThemeSelect
├── content.config.ts 四个集合的 schema
├── layouts/          PortalLayout
├── pages/            index / orgs / players / news
├── styles/           tokens / theme / portal
└── content/          docs / orgs / players / news
public/images/        首页与风景图（已压成 WebP，约 840 KB）
```
