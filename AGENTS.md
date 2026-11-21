# AGENTS.md

本文件面向通用编码 Agent。本仓库的完整协作约定在 [`CLAUDE.md`](./CLAUDE.md)（UI 规矩、导航数据源、事实来源、接口契约文档等），与它冲突时以 `CLAUDE.md` 为准；跨仓库通用规则见工作区根目录的 `CLAUDE.md`。

## Development

启动开发服务器时用后台模式，不要占住终端：

```
astro dev --background
```

用 `astro dev stop`、`astro dev status`、`astro dev logs` 管理后台进程。也可以用 package.json 里的脚本：`bun dev` / `npm run dev`。

## Documentation

- Astro 文档：<https://docs.astro.build>
- 本仓库：`README.md`（命令与结构）、`docs/backend-api.md`（反代与环境变量）、`docs/ui-rules.md`（UI 规矩）
- 接口契约在独立后端仓库 `../hydwind-api`；本仓库只做页面 SSR 与 `/api/*` 反代

动手前按需查阅这些 Astro 指南：

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)