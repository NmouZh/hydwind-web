# hydwind-web

通用规则（提交、日报、检查、构建走 CI、Agent skills）见工作区根目录的 `CLAUDE.md`（本仓库的上一级目录）；本文件只放官网特有约定。

## 仓库特有

- 架构是「页面 SSR + `/api/*` 反代」：后端接口（账号、传记、评论、议题、登录码、服务器状态等）与存储实现在独立仓库 `../hydwind-api`（Node + Hono + SQLite）；本仓库只保留页面与 `src/pages/api/[...path].ts` 反代，不要在 web 里重新实现后端逻辑。
- 接口契约以 `hydwind-api` 的 README 与源码为准；反代规则、环境变量（`HYDWIND_API_ORIGIN` / `HOST` / `PORT`）与页面数据来源见 `docs/backend-api.md`。
- 服务器事实只写在 `src/content/site/info.md`，页面与组件不得硬编码（`scripts/check-build.mjs` 会检查）。
- issue tracker 是 GitHub `NmouZh/hydwind-web`；`origin` remote 指向 gh-proxy 代理 URL，`gh` 在仓库内无法自动识别，必须显式 `-R NmouZh/hydwind-web`（见工作区 `docs/agents/issue-tracker.md`）。
- 领域文档以本仓库 `GLOSSARY.md` 为准；跨仓库决策按工作区约定放根目录 `docs/adr/`。

## UI 规矩

- 改页面前先读 `docs/ui-rules.md`：颜色/字体/圆角/动效一律用 MD3 token，页面骨架用 `hw-shell` + `page-shell` + `page-head`，强调区块用 `hero-card` / `hero-plate`，普通容器用 `panel`。
- 一级导航只改 `src/lib/nav.ts` 的 `NAV_ITEMS`（固定五项：首页 / 指南 / 人物 / 议题 / 账号），不要在组件里就地写死链接；子页面高亮父级。
- 页面自带的 scoped style 只放本页独有的东西，通用形状提升到 `src/styles/base.css` 的共享原语区。