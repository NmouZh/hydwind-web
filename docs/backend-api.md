# 后端接口与部署

网站已经拆成两个服务：

- **hydwind-web**（本仓库）：Astro 页面 SSR + `/api/*` 反代。没有账号、传记、评论、
  议题、登录码或服务器状态的存储实现。
- **hydwind-api**（`../hydwind-api`）：Node + Hono + SQLite，默认
  `http://127.0.0.1:8787`。接口契约以它仓库的 README 与源码为准。

## 环境变量

Web 只需要三个：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `HYDWIND_API_ORIGIN` | 否 | 后端根地址，默认 `http://127.0.0.1:8787`。页面 SSR 与 `/api/*` 反代都走它。 |
| `HOST` | 否 | standalone 监听地址，默认 `0.0.0.0`。 |
| `PORT` | 否 | 监听端口，默认 `4321`。 |

后端令牌、`SESSION_SECRET`、`HYDWIND_DATA_DIR`、`PUBLIC_ORIGIN` 等都配在
hydwind-api，不再属于本仓库。

## 反代规则

`src/pages/api/[...path].ts` 对所有方法导出 `ALL`：

- 目标：`${HYDWIND_API_ORIGIN}/api/${path}${search}`；
- 方法、查询串、请求体（含流式 body）原样透传；
- 请求头删掉 `Host`、`Content-Length` 与逐跳头，补：
  - `X-Forwarded-For`：`Astro.clientAddress`，后端限流按真实 IP 分桶；
  - `X-Forwarded-Host` / `X-Forwarded-Proto`：当前请求 URL；
  - `Cookie` / `Origin` 原样转发；
- 响应保留状态码、`Location`、`Cache-Control`、`Content-Type` 等业务头；
  `Set-Cookie` 逐条转发（`getSetCookie()`），登录 / 退出依赖它；
- `redirect: 'manual'`：头像接口的 302 不能被反代跟随；
- body 直接以流返回，不整包缓冲；后端没给 `Cache-Control` 时补 `no-store`；
- 后端不可达返回 `502 { "error": "后端暂时不可达" }`，不是 500。

页面 SSR 与浏览器请求共用 `src/lib/api-client.ts` 的同一套头规则。

## 页面数据来源

| 页面 | 后端调用 | 说明 |
| --- | --- | --- |
| `/people/` | `GET /api/people?q=` | 后端已合并静态人物、账号与传记；页面只渲染返回的 `people` 列表。 |
| `/people/[slug]/` | `GET /api/people/:slug` | 返回 `person` / `biography` / `comments` / `viewer` / `canEdit`。`person.source=static` 且有 `personId` 时，Markdown 正文仍由 `astro:content` 渲染；评论删除按钮直接用后端算好的 `canDelete`。 |
| `/gate/` | `GET /api/gate/codes` | 带 Cookie 调用；`401` → 访客指引，其它失败 → 可重试错误。码本身不落静态产物，响应与页面都 `no-store`。 |

浏览器端的传记保存、评论发表 / 删除仍然调用原来的
`/api/people/:id/biography` 与 `/api/people/:id/comments`，只是现在经反代到达
hydwind-api。

`GET /api/people/:slug` 的响应形状（hydwind-api 提供）：

```json
{
  "person": { "slug": "nz-173", "gameId": "Nz_173", "source": "static", "personId": "nz-173" },
  "biography": { "gameId": "Nz_173", "mainTitle": "…", "body": "…", "createdAt": "…", "updatedAt": "…" },
  "comments": [
    { "id": "…", "authorGameId": "Bob", "authorDisplay": "小波", "body": "…", "createdAt": "…", "canDelete": true }
  ],
  "viewer": { "username": "Bob", "nickname": "小波", "role": "player" },
  "canEdit": false
}
```

`biography` 可以为 `null`（静态人物没有运行期传记）；`viewer` 未登录为 `null`。

## 启动

```bash
# 构建（Node >= 22.23.4）
npm run build

# 运行：读 .env 再起 standalone server
./scripts/run.sh
```

本地同时启动两个服务见 README 的「本地开发（两个服务）」。

## 部署注意

- 后端 `PUBLIC_ORIGIN` 必须等于浏览器访问网站的地址，否则登录码 / 评论等写接口的
  同源校验会 403。反代会把浏览器的 `Origin` 原样带给后端。
- 后端默认只信任回环地址发来的 `X-Forwarded-For`；Web 与后端同机部署时无需额外配置，
  跨机部署要设置 `TRUSTED_PROXY_CIDRS`。
- `astro.config.mjs` 的 `security.allowedDomains` 仍只认可正式域名、`localhost`、
  `127.0.0.1`；换域名时同步它。
- 数据（SQLite）在 hydwind-api 侧，Web 的 `./data` 不再使用。
- 会话是无状态签名 cookie，Web 不解析它，只负责把 Cookie 转发给后端。
