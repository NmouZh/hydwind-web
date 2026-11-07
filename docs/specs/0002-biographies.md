## Problem Statement

新玩家通过 QQ 机器人注册后，网站没有任何属于他的页面。现有「人物传记」是构建期的静态 Markdown 集合（`src/content/people/*.md`，目前只有 `Nz_173` 一篇），只覆盖人工维护的角色；运行期 `biographies.json` 按静态人物 slug 存正文，普通账号没有 person 记录，因此既不会出现在 `/people`，也没有可编辑的传记。

同时现有 `canEditBiography` 有个安全洞：任何已登录账号都能给「还没有传记」的任意人物创建第一篇，因为它没有校验登录账号是否等于该人物的游戏 ID。网站也没有评论系统。

玩家需要一个「首次成功进服后自动出现、本人可写、其他人可评论」的人物传记页面，管理员需要能编辑和清理。

## Solution

在 `hydwind-web` 内扩展人物与传记：

- `/api/plugin/login/verify` 校验成功且账号还没有传记时，自动创建一条传记记录（按游戏 ID 幂等，老账号首次登录也会补建）。
- `/people` 列表与 `/people/[slug]` 详情改为 SSR，运行时合并「静态 curated 人物」和「账号」两类来源，列出所有已注册账号。
- 本人和管理员可编辑主标题与正文；已注册用户可发表评论，本人和管理员可删除评论。
- 数据沿用 `accounts.json`、`biographies.json` 和现有 JSON 原子写队列；评论嵌入传记记录。
- 单元测试 + 接口 smoke，全部在 GitHub Actions 运行。

## User Stories

1. 作为首次通过游戏登录验证的新玩家，我想网站上自动出现一份属于我的传记，以便不用手动创建。
2. 作为还没写传记的老玩家，我想在首次登录时自动补建，以便老账号不被漏掉。
3. 作为玩家，我想传记默认主标题是「游戏 ID 的人物传记」，以便一眼认得出是谁。
4. 作为传记主人，我想修改主标题（2–40 字），以便写得有个性。
5. 作为传记主人，我想编辑正文（Markdown，0–4000 字），以便介绍自己。
6. 作为传记主人，我想清空正文，以便页面显示「尚未填写」而不是报错。
7. 作为玩家，我想在页面上看到自己的游戏 ID，以便确认这是谁的传记。
8. 作为游客，我想在 `/people` 看到所有已注册玩家的传记入口，以便浏览。
9. 作为游客，我想按游戏 ID 或中文别名搜索，以便快速找到某个人。
10. 作为游客，我想看到还没写正文的账号也出现在列表里，并标记「尚未填写」。
11. 作为游客，我想在传记页看到主标题、游戏 ID、正文和评论，以便了解这个玩家。
12. 作为已注册用户，我想在别人的传记下发表评论，以便互动。
13. 作为读者，我想看到评论者的游戏 ID / 别名和发表时间，以便知道是谁说的。
14. 作为评论作者，我想删除自己的评论，以便收回说错的话。
15. 作为管理员，我想删除任意不当评论，以便管理社区。
16. 作为系统，我不想未登录用户能评论或写传记，以便防止匿名灌水。
17. 作为系统，我想限制评论 1–500 字并按账号限流，以便防止刷屏。
18. 作为传记主人，我不想别人编辑我的传记，以便保护内容。
19. 作为管理员，我想编辑任意玩家的传记，以便修正明显错误。
20. 作为系统，我想阻止任何登录用户给别人的传记创建第一篇，以便修复现有安全洞。
21. 作为访问者，我想现有的 `/people/nz-173/` 链接保持不变，以便旧链接不坏。
22. 作为访问者，我想静态人物的角色、标签、头像仍然展示，以便保留人工维护的资料。
23. 作为没有头像的玩家，我想看到一个默认/首字母头像，以便列表不出现破图。
24. 作为新注册玩家，我想注册后立刻能访问自己的页面，不需要等网站重新构建，以便体验连贯。
25. 作为系统，我想传记写入失败时不要让游戏登录失败，以便网站故障不阻塞进服。
26. 作为系统，我想重复的登录验证不会重复创建传记，以便数据不重复。
27. 作为读者，我想评论按时间正序排列，以便按对话顺序阅读。
28. 作为评论作者，我想删除后评论立刻消失，以便反馈及时。
29. 作为访问者，我想传记更新后列表里的「更新于」跟着变化，以便判断活跃度。
30. 作为传记主人，我想在标题太长、正文太长、评论为空时看到明确错误，以便知道怎么改。
31. 作为系统，我想未登录用户不能通过 API 创建/编辑传记或评论，以便接口层面也安全。
32. 作为游客，我想未登录也能公开阅读传记和评论，以便了解服务器玩家。

## Implementation Decisions

### 身份与数据模型

- 传记的唯一键是账号 `username`（即游戏 ID），比较时忽略大小写。
- 静态人物仍以 `src/content/people/*.md` 的 `gameId` 为准；列表与详情按 `gameId` 把静态人物和账号合并。
- URL slug 解析顺序：先匹配静态人物的 entry id（保留 `/people/nz-173/`），再匹配账号 `username.toLowerCase()`；都不存在返回 404。
- `Biography` 记录字段：`gameId`、`mainTitle`、`body`、`comments`、`createdAt`、`updatedAt`。删除现有 `personId` 语义；当前 `biographies.json` 不存在，无需迁移。
- `Comment` 字段：`id`、`authorUsername`、`authorGameId`、`body`、`createdAt`。作者展示名在读取时从账号取 `nickname`，没有则回退 `authorGameId`；账号不存在时显示 `authorGameId`。
- 主标题默认 `<gameId>的人物传记`；编辑范围 2–40 字；保存空串时回退显示 `<gameId>的人物传记`。不设独立副标题字段，页面在标题下直接显示游戏 ID。
- 正文 0–4000 字，允许为空；沿用现有 Markdown 渲染与转义。
- 评论 1–500 字，平铺、按 `createdAt` 正序；每账号 10 分钟最多 5 条评论。
- 账号 username 变更时（同一平台身份重新注册），把旧 `gameId` 的传记重命名为新 username；评论里的 `authorGameId` 同步更新。

### 自动创建

- 新增 `ensureBiographyForAccount(account)`：按 `account.username` 查找，不存在则创建默认记录；幂等。
- 在 `/api/plugin/login/verify` 成功分支、返回 200 之前调用；写入失败只记录日志，不影响登录结果。
- 不修改插件仓库；插件现有的成功响应已足够触发。

### 权限

- `canEditBiography(account, targetGameId)`：`account.role === 'admin'` 或 `account.username` 与 `targetGameId` 忽略大小写相等。
- 修复现有「传记不存在时任何登录用户可编辑」的分支，不再返回 true。
- 评论：任何已登录账号可发；删除仅限评论作者本人或管理员。
- API 层必须重新读取账号，不能只信 cookie 里的 role。

### 页面

- `/people/` 改为 `prerender = false`：列出所有账号，合并静态人物元数据；默认按 `gameId` 排序，支持 `q` 搜索 `gameId` / `nickname`；空正文标记「尚未填写」；显示默认/首字母头像。
- `/people/[slug]/` 改为 `prerender = false`：解析 slug → gameId；展示主标题、游戏 ID、正文（Markdown / 空状态）、评论区、编辑表单（仅本人/管理员）。
- 保留静态人物的角色、标签、头像、排序和原有静态内容展示。
- 复用 `PersonCard`、`PlayerAvatar`、`prose`、`form-stack`，遵守 `docs/ui-rules.md`；没有头像时使用默认/首字母头像。
- 评论表单要求登录；未登录显示登录入口。

### 接口

```
GET    /api/people/[id]/biography       公开；返回 gameId、mainTitle、body、canEdit、updatedAt
PUT    /api/people/[id]/biography       本人/管理员；{ mainTitle, body }
GET    /api/people/[id]/comments        公开；按时间正序返回评论
POST   /api/people/[id]/comments        已登录；{ body }
DELETE /api/people/[id]/comments/[cid]  作者本人/管理员
```

- `[id]` 是 slug；路由内解析为 gameId。
- 写接口沿用现有的 JSON body 上限、CSRF/同源策略与限流模式。
- 返回值与错误结构沿用现有 API 风格；错误至少区分 401 未登录、403 无权限、404 不存在、400 参数错误、429 限流。

### 存储与构建

- `biographies.json` 沿用 `src/lib/biographies.ts` 的模块级写队列和原子 temp+rename；评论写在同一文件。
- `accounts.json` 不变；通过 `findAccount` 读取。
- `check-build.mjs` 移除对 `people/index.html`、`people/nz-173/index.html` 的静态产物断言，改为断言 SSR 路由存在/构建通过。
- `scripts/smoke.mjs` 覆盖：插件验证自动建传记、GET/PUT 传记、GET/POST/DELETE 评论、未登录 401、非本人 403。

## Testing Decisions

- **只测外部行为**：HTTP 响应、持久化后的可观察结果、SSR 页面关键文本；不断言私有方法。
- **最高接缝（HTTP 契约）**：`/api/people/[id]/biography`、`/api/people/[id]/comments`、`/api/plugin/login/verify` 的自动创建。路由测试直接调用 handler，沿用 `test/plugin-login-verify.test.ts` 的模式和 `test/helpers.ts` 的临时数据目录。
- **纯逻辑**：`ensureBiographyForAccount` 幂等、`canEditBiography` 权限、slug 解析、标题/正文/评论校验、评论限流。用 `node:test`。
- **SSR 页面**：`scripts/smoke.mjs` 起 standalone server 后请求 `/people/` 与 `/people/<slug>/`，断言 200、主标题、游戏 ID、空状态、评论区；浏览器 smoke 覆盖登录后的编辑与评论。
- **现有接缝优先**：不引入新的测试框架；沿用 `node:test`、`test/helpers.ts`、`scripts/smoke.mjs`。
- **CI**：所有测试与 smoke 在 GitHub Actions 执行，本地不跑构建/测试。

## Out of Scope

- 评论回复/楼中楼、审核队列、举报、通知。
- 头像上传或头像管理。
- 迁移静态 Markdown 正文到运行时传记。
- 评论分页（v1 返回全部）。
- 删账号、删传记（管理员只能编辑，不能删除整份传记）。
- 实时刷新、WebSocket。
- 国际化。
- 插件仓库改动（现有 verify 调用即可）。

## Further Notes

- 本设计同时修复现有安全洞：不能再让任意登录用户给别人的传记创建第一篇。
- `nz-173` 的静态 URL 保持不变；静态人物资料与新运行时传记合并展示。
- SSR 后页面不再在构建期生成，`check-build.mjs`、smoke 和缓存策略都要同步调整。
- 主标题是玩家可编辑的；游戏 ID 始终显示在主标题下方，没有独立副标题字段。
- 自动创建的正文为空；列表显示「尚未填写」，详情页显示空状态与编辑入口。
- 账号 username 变更时迁移传记键，避免孤儿记录。