# hydwind-web

通用规则（提交、日报、检查、Agent skills）见工作区 `/root/hydwind/CLAUDE.md`；本文件只放官网特有约定。

## UI 规矩

- 改页面前先读 `docs/ui-rules.md`：颜色/字体/圆角/动效一律用 MD3 token，页面骨架用 `hw-shell` + `page-shell` + `page-header`，卡片只用 `hero-card` / `panel`。
- 一级导航只改 `src/lib/nav.ts` 的 `NAV_ITEMS`，不要在组件里就地写死链接；子页面高亮父级。
- 页面自带的 scoped style 只放本页独有的东西，通用形状提升到 `src/styles/base.css` 的共享原语区。

## 仓库特有

- issue tracker 是 GitHub `NmouZh/hydwind-web`；`github` remote 指向真实仓库，`gh` 在仓库内自动识别，`origin` 是 gh-proxy 代理 URL。
- 领域文档以本仓库 `GLOSSARY.md` 和 `docs/adr/` 为准。
