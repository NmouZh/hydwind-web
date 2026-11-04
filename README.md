# Hydwind 生存服官网

氢风（Hydwind）Minecraft Java 生存服务器的官网。Astro 7 静态输出（`dist/`），部署在 EdgeOne。

- 技术栈：Astro 7，TypeScript（strict）
- 包管理器：bun
- Node 要求：`>= 22.23.4`（见 `.node-version`）
- 正式站点：<https://hydwind.lovie.me>

## 命令

| 命令 | 作用 |
| --- | --- |
| `bun install` | 安装依赖 |
| `bun dev` | 启动本地开发服务器（`localhost:4321`） |
| `bun build` | 构建生产站点到 `./dist/` |
| `bun check` | 构建并执行内容与构建产物检查 |
| `bun smoke` | 在本地 Chromium 中执行浏览器冒烟（需先构建） |
| `bun preview` | 本地预览构建结果 |

`bun check` 按页面断言真实事实存在、编造的旧内容不出现、服务器事实没有散落在
页面或内容中，并检查每个页面的标题、描述、规范 URL 与站内链接。

`bun smoke` 覆盖桌面 1280 与移动 390 视口、深浅色切换、复制地址与 QQ 群、
顶部/底部导航，以及在线、离线、查询失败三态。浏览器不可用时会明确输出“跳过”
并以 0 退出。构建后可用 `bun check && bun smoke` 一次跑完。

## 目录结构

```text
/
├── public/images/       # 本地头像与图片
├── src/
│   ├── content/
│   │   ├── site/        # 服务器事实（单例）
│   │   ├── people/      # 人物传记
│   │   └── guides/      # 指南
│   ├── content.config.ts
│   ├── components/      # 服务器信息、人物卡片、步骤等共享组件
│   ├── layouts/
│   ├── lib/             # 内容读取/排序与日期格式化
│   ├── pages/           # 首页、/people、/guides、/guides/join
│   └── styles/          # MD3 tokens 与基础样式
├── scripts/
│   ├── check-build.mjs  # 构建产物检查
│   ├── generate-md3-tokens.mjs
│   └── smoke.mjs        # 浏览器冒烟
├── .pages.yml           # Pages CMS 配置
└── astro.config.mjs
```

服务器地址、客户端版本、客户端要求、验证方式、收费、QQ 群、进服限制、测试期提示
和最后更新时间只写在 `src/content/site/info.md`，页面从内容集合读取。客户端版本
以后可能调整；其余未知信息不写，避免把猜测当成事实。

## 通过 Pages CMS 编辑

1. 服主在 GitHub 仓库 `NmouZh/hydwind-web` 中给编辑者授予写权限（collaborator）。
2. 编辑者用 GitHub 账号登录 <https://app.pagescms.org>，选择该仓库。
3. 在“服务器信息”“人物传记”“指南”中编辑 Markdown 并保存，Pages CMS 会直接提交到仓库。

配置位于根目录 `.pages.yml`。图片上传到 `public/images/`，页面路径为 `/images/…`。
没有仓库写权限的 GitHub 账号只能查看，不能保存。

### 新增 Wiki 页面

「指南」是 Wiki，一个 Markdown 文件就是一页：

1. Pages CMS →「Wiki 指南」→ 新建。文件名就是 URL，例如 `rules` → `/guides/rules/`。
2. 必填只有标题和正文；分类、摘要、标签、排序、更新时间、步骤都可以留空。
   摘要留空会自动从正文截一段。
3. `draft` 打开时不会进构建产物；写完再关掉。
4. 也可以直接新建 `src/content/guides/<slug>.md`，frontmatter 见 `src/content.config.ts`。
5. 每页底部有「编辑此页」链接，直接指向 GitHub 上的 Markdown 文件。

## 相关文档

- Astro 文档：<https://docs.astro.build>
- Pages CMS 文档：<https://pagescms.org/docs>
- 协作约定：`docs/agents/`
