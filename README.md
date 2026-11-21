# Hydwind 生存服官网

氢风（Hydwind）Minecraft Java 生存服务器的官网。Astro 7 `output: 'server'`：内容页预渲染成静态 HTML，人物 / 进服验证等页面按请求 SSR，`/api/*` 全部反代给独立后端，构建出 standalone 产物，部署在自建 VPS，由 systemd 守护。

网站不再包含账号、传记、评论、议题、登录码、服务器状态等存储与业务实现，它们都在独立仓库 [`hydwind-api`](../hydwind-api)（Node + Hono，默认 `http://127.0.0.1:8787`）。Web 只保留两件事：页面 SSR（服务端用 `apiFetch` 调后端）与 `/api/[...path]` 反代。

- 技术栈：Astro 7（`@astrojs/node` standalone 适配器），TypeScript（strict），GSAP（动效）
- 包管理器：本地用 bun（`bun.lock`），CI 与部署用 npm（`package-lock.json`）
- Node 要求：`>= 22.23.4`（见 `.node-version`）
- 正式站点：<http://103.236.99.253:62179>

## 命令

| 命令 | 作用 |
| --- | --- |
| `bun install` | 安装依赖 |
| `bun dev` | 启动本地开发服务器（`localhost:4321`，默认反代到 `127.0.0.1:8787`） |
| `bun build` | 构建生产站点到 `./dist/` |
| `bun check` | 构建并执行构建产物检查 |
| `bun test` | 运行 `test/*.test.ts` 单元测试（node:test） |
| `bun smoke` | 可选联通检查：后端可达时经网站反代访问 `/api/health`，否则跳过 |
| `bun preview` | 本地预览构建结果 |
| `bun tokens` | 由种子色重新生成 `src/styles/md3-tokens.css` |

`bun check` 按页面断言真实事实存在、编造的旧内容不出现、服务器事实没有散落在
页面或内容中，并检查每个页面的标题、描述、规范 URL 与站内链接；SSR 路由
（如 `/people/`）不得产出静态产物。

`bun smoke` 不依赖 Chromium：`HYDWIND_API_ORIGIN` 不可达时明确输出「跳过」
并以 0 退出；后端可达时启动 `dist/server/entry.mjs`，经网站自己的 `/api/health`
确认反代链路返回 200 且 `{ "ok": true }`。

## 本地开发（两个服务）

人物列表 / 详情与进服验证页都是 SSR，需要向 `hydwind-api` 取数据。只启动 Web 时，
这些页面会显示「后端暂时不可达」，其它静态页面照常工作。

```bash
# 终端 1：启动后端（首次先 npm ci，按 hydwind-api/README.md 配 .env）
cd ../hydwind-api
node --env-file=.env src/server.ts        # http://127.0.0.1:8787

# 终端 2：启动网站
cd ../hydwind-web
bun dev                                    # http://localhost:4321
```

Web 只读 `HYDWIND_API_ORIGIN`（默认 `http://127.0.0.1:8787`）、`HOST`、`PORT`
三个环境变量，示例见 `.env.example`。后端的 `PUBLIC_ORIGIN` 必须等于浏览器访问
网站的地址，否则登录码 / 评论等写接口的同源校验会返回 403。

## 页面与接口

一级导航（`src/lib/nav.ts`）固定五项：首页 / 指南 / 人物 / 议题 / 账号。

- 预渲染静态页：`/`、`/guides/`、`/guides/[slug]`、`/account/`（登录态由浏览器拉 `/api/auth/me` 补水）、`/403`、`/404`
- SSR 页面：`/people/` 与 `/people/[slug]`（调 `GET /api/people?q=` 与 `GET /api/people/:slug`）、`/issues/`、`/gate`（调 `GET /api/gate/codes`，401 显示登录指引）
- 跳转：`/login` → `/account/`；`/edit?page=<slug>` → GitHub 上对应 Markdown
- `/api/*`：统一由 `src/pages/api/[...path].ts` 反代到 `HYDWIND_API_ORIGIN`，方法 / body / 查询串 / 状态码 / Set-Cookie 原样透传；接口契约见 `hydwind-api` 的 README

## 环境变量与运行

Web 只读 `HYDWIND_API_ORIGIN`（默认 `http://127.0.0.1:8787`）、`HOST`、`PORT`，
示例见 `.env.example`；后端自身的环境变量见 `hydwind-api` 的 README。
本地或线上启动用 `./scripts/run.sh`（读取 `.env` 后运行 standalone 产物）。

## 目录结构

```text
/
├── public/
│   ├── fonts/           # 自托管字体（MiSans / Rubik）
│   └── images/          # 本地头像与图片
├── src/
│   ├── content/
│   │   ├── site/        # 服务器事实（单例）
│   │   ├── people/      # 静态人物资料
│   │   └── guides/      # Wiki 指南
│   ├── content.config.ts
│   ├── components/      # 导航、服务器信息、人物卡片、步骤等共享组件
│   ├── layouts/
│   ├── lib/             # 内容读取、纯展示/格式化逻辑，以及 hydwind-api 客户端
│   ├── pages/           # 页面与 /api/[...path] 反代路由（见「页面与接口」）
│   ├── scripts/         # 浏览器侧脚本（动效、导航、传记编辑）
│   └── styles/          # MD3 tokens 与基础样式
├── scripts/             # check-build / smoke / motion-check / tokens 生成 / run.sh
├── test/                # node:test 单元测试
├── deploy/              # systemd unit 与部署说明
├── .pages.yml           # Pages CMS 配置
└── astro.config.mjs
```

服务器地址、客户端版本、客户端要求、验证方式、收费、QQ 群、进服限制、测试期提示
和最后更新时间只写在 `src/content/site/info.md`，页面从内容集合读取。客户端版本
以后可能调整；其余未知信息不写，避免把猜测当成事实。

## CI

`.github/workflows/ci.yml` 在 push / PR 到 `main`、`feat/api-proxy`、`feat/login-gate`、
`feat/biography` 及手动触发时运行：Node 22 上 `npm ci` → `build` → 构建产物检查 →
`test` → `smoke`。
CI 不启动 `hydwind-api`：构建不执行 SSR 页面，冒烟在后端不可达时自动跳过，
因此本仓库的检查不依赖跨仓库服务。

## 通过 Pages CMS 编辑

1. 服主在 GitHub 仓库 `NmouZh/hydwind-web` 中给编辑者授予写权限（collaborator）。
2. 编辑者用 GitHub 账号登录 <https://app.pagescms.org>，选择该仓库。
3. 在「服务器信息」「人物传记」「Wiki 指南」中编辑 Markdown 并保存，Pages CMS 会直接提交到仓库。

配置位于根目录 `.pages.yml`。图片上传到 `public/images/`，页面路径为 `/images/…`。
没有仓库写权限的 GitHub 账号只能查看，不能保存。

### 新增 Wiki 页面

「指南」是 Wiki，一个 Markdown 文件就是一页：

1. Pages CMS →「Wiki 指南」→ 新建。文件名就是 URL，例如 `rules` → `/guides/rules/`。
2. 必填只有标题和正文；分类、摘要、标签、排序、更新时间、步骤都可以留空。
   摘要留空会自动从正文截一段。
3. `draft` 打开时不会进构建产物；写完再关掉。
4. 也可以直接新建 `src/content/guides/<slug>.md`，frontmatter 见 `src/content.config.ts`。
5. 每页底部有「编辑此页」链接，经站内 `/edit` 跳转到 GitHub 上的 Markdown 文件。

## 相关文档

- 反代、环境变量与页面数据来源：`docs/backend-api.md`；接口契约在 `hydwind-api` 仓库
- UI 规矩：`docs/ui-rules.md`
- 安全：`docs/security.md`
- 部署与 systemd：`deploy/README.md`
- Astro 文档：<https://docs.astro.build>
- Pages CMS 文档：<https://pagescms.org/docs>
- 协作约定（issue tracker、triage、领域文档）：工作区根目录 `docs/agents/`