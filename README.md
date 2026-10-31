# Hydwind 生存服官网

Hydwind 生存服官网的 Astro 工程骨架，纯静态输出（`dist/`），可直接部署到 EdgeOne Pages / Cloudflare Pages / GitHub Pages。

- 技术栈：Astro 7，TypeScript（strict）
- 包管理器：bun
- Node 要求：`>= 22.23.4`（见 `.node-version`）

## 命令

| 命令 | 作用 |
| --- | --- |
| `bun install` | 安装依赖 |
| `bun dev` | 启动本地开发服务器（`localhost:4321`） |
| `bun build` | 构建生产站点到 `./dist/` |
| `bun preview` | 本地预览构建结果 |
| `bun astro ...` | 运行 Astro CLI（如 `astro add`、`astro check`） |

## 目录结构

```text
/
├── public/          # 静态资源，原样拷贝到构建产物
├── src/
│   └── pages/       # 文件即路由，index.astro 对应 /
├── astro.config.mjs # Astro 配置
├── docs/            # 项目协作约定（issue tracker、triage、领域文档）
└── CLAUDE.md        # 仓库协作说明
```

页面放在 `src/pages/`，组件放 `src/components/`，内容集合放 `src/content/`（按需创建）。

## 相关文档

- Astro 文档：<https://docs.astro.build>
- 协作约定：`.claude/` 技能与 `docs/agents/`
