# 后端接口与部署

站点现在是「静态页面 + 运行时 API」：内容页仍在构建期渲染成 HTML，`/api/*` 由 Node 适配器（`@astrojs/node` standalone）在运行时处理。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ISSUE_ADMIN_TOKEN` | 议题与账号功能必填 | 站务共享密钥。插件调用写接口时用 `Authorization: Bearer <token>`。不设置则所有写接口、待审列表、注册接口都返回 401。生产要求至少 32 个随机字符。 |
| `PLUGIN_TOKEN` | 游戏插件必填 | HydwindGate 插件专用密钥，只用于 `/api/plugin/*`。与 `ISSUE_ADMIN_TOKEN` 完全分离：插件令牌不能调议题 / 账号接口，站务令牌也不能调插件接口。不设置则插件接口一律 401。生产要求至少 32 个随机字符，且不能与其他令牌相同。 |
| `SESSION_SECRET` | 上线必填 | 登录会话 cookie 的 HMAC 密钥，生产要求至少 32 个随机字符，且不能与 `ISSUE_ADMIN_TOKEN` 相同。未配置时使用进程内随机密钥（重启即全员掉线），生产环境会记录错误；`scripts/check-env.mjs` 会直接拒绝启动。 |
| `HYDWIND_DATA_DIR` | 否 | 议题、账号与传记 JSON 的存放目录，默认 `<cwd>/data`。服务会创建为 0700，文件写为 0600。 |
| `LOGIN_CODE_KAOMOJI_POOL` | 否 | 登录码颜文字候选池，逗号分隔；默认内置 24 个。空值退回默认池，重复项自动去重。 |
| `LOGIN_CODE_FALLBACK_PREFIX` | 否 | ASCII 备用码前缀，默认 `HWG`；匹配规则随前缀自动派生，大小写不敏感。 |
| `STATUS_ENDPOINT` | 否 | 服务器状态数据源，默认 `https://api.mcstatus.io/v2/status/java`。以后插件自建 HTTP 状态接口，把它指过去即可。 |
| `HOST` / `PORT` | 否 | `node ./dist/server/entry.mjs` 的监听地址，默认 `0.0.0.0:4321`。放在 TLS 反代后面时应设为 `127.0.0.1`。 |

## 启动

```bash
# 构建（Node 需要 >= 22.23.4）
npm run build

# 运行：读 .env 再起 standalone server
./scripts/run.sh
```

线上由 systemd 守护（开机自启、崩溃拉起、插件触发重启），安装与权限说明见
`deploy/README.md`。

`.env` 示例：

```dotenv
ISSUE_ADMIN_TOKEN=<32+ 随机串>
PLUGIN_TOKEN=<另一个 32+ 随机串>
SESSION_SECRET=<第三个 32+ 随机串>
HYDWIND_DATA_DIR=./data
HOST=127.0.0.1
PORT=4321
```

## 接口

### `GET /api/health`

存活探针，给 systemd 和游戏插件使用，**不需要鉴权**。返回进程启动至今的秒数。
加 `?ready=1` 时额外检查数据目录可读写、三个 JSON 能解析；故障返回 503。
插件仍使用轻量的 liveness（不带 `ready`）。

```json
{ "ok": true, "uptime": 12345 }
```

### `POST /api/plugin/login/verify`

HydwindGate 插件校验玩家从 `/gate` 页面拿到的登录码，**只接受 `PLUGIN_TOKEN`**
（`Authorization: Bearer <PLUGIN_TOKEN>`）；站务令牌、浏览器会话一律 401。

```json
{ "code": "颜文字码或 HWG-XXXX 备用码", "gameId": "游戏 ID", "uuid": "玩家的 UUID" }
```

请求体上限 1KB，三个字段都必须是字符串，`uuid` 必须是标准 UUID 格式。
`uuid` 不参与鉴权，只作为成功校验的审计上下文写入服务端日志；契约里保留这个字段。

成功：

```json
{ "ok": true, "account": { "username": "Nz_173", "nickname": "中文别名", "role": "player" } }
```

失败：

- `400` 请求体格式 / 字段类型不对，`413` 请求体过大，`415` 不是 JSON
- `401` 令牌错误
- `409 { "ok": false, "reason": "invalid_code | expired | used" }`
- `409 { "ok": false, "reason": "game_id_mismatch", "expectedGameId": "Nz_173" }`
- `429 { "ok": false, "reason": "rate_limited", "retryAfterMs": 12345, "attemptsRemaining": 0 }`
  （同时带 `Retry-After` 响应头，单位秒）

`gameId` 必须等于账号 `username`（忽略大小写）；码有效但账号不存在按
`invalid_code` 处理。码一次性、5 分钟过期；同一游戏 ID 5 分钟内最多 5 次尝试。

账号存在性和 `gameId` 匹配检查发生在作废登录码之前：任一检查失败都不会
烧掉码，玩家改对游戏 ID 后可以继续用同一个码。

### `GET /api/status`

服务器在线状态，服务端缓存 60 秒，第三方接口挂掉时回退到上次缓存，再回退成离线占位。

```json
{
  "online": true,
  "address": "zzbgp2.coreyun.net:35282",
  "host": "zzbgp2.coreyun.net",
  "port": 35282,
  "players": { "online": 3, "max": 20, "names": ["Steve"] },
  "version": "Paper 26.2",
  "motd": "……",
  "checkedAt": "2026-11-03T05:00:00.000Z",
  "source": "live"
}
```

### `GET /api/avatar/:name`

在线玩家头像代理。`name` 是游戏 ID，只允许字母、数字、下划线，1–16 位。

- 先查 Mojang 官方 profile：是正版账号就用它的 UUID 取本人皮肤头像；
- 不是正版 / 查不到 / 上游失败 → 302 到本地默认头像（从官方 `MHF_Steve`、`MHF_Alex` 皮肤裁出），
  按名字稳定选一个，刷新不会来回换；
- 成功头像缓存 24 小时，未命中缓存 1 小时；浏览器只请求同源地址，不直连第三方头像站。

### `GET /api/issues`

公开议题列表（不含 `pending`）。带站务权限（令牌或 admin 会话）时额外返回 pending。

### `POST /api/issues`

```json
{ "title": "末地传送门附近卡顿", "body": "详细描述……", "author": "游戏ID（可空）", "category": "bug" }
```

- `category`：`bug` / `suggestion` / `other`
- 校验：标题 ≥ 4 字，描述 ≥ 10 字；同一 IP 10 分钟内最多 5 次
- 总量上限 5000 条、待审队列 200 条；超过时返回 503，等站务清理
- 新议题状态为 `pending`，需要群里审核后才公开

### `GET /api/issues/:id`

单个议题（`pending` 仅站务权限可见）。

### `PATCH /api/issues/:id`

站务改状态：`{ "status": "open" | "rejected" | "done" }`，需要站务权限（令牌或 admin 账号）。

### `POST /api/issues/:id/replies`

站务回复：`{ "body": "…", "author": "可选" }`，需要站务权限（令牌或 admin 账号）。插件把群里的处理进展同步到这里。

### `GET /api/people/:id/biography`

公开读取一份人物传记。`id` 是 slug：先匹配静态人物 entry id（例如 `nz-173` 保持不变），
再匹配账号 `username`（忽略大小写）。

合法人物 / 账号还没写传记时**不返回 404**，而是返回默认空传记：
`mainTitle` 是「<gameId>的人物传记」，`body` 为空，`updatedAt` 为 `null`。
slug 既不是静态人物也不是账号时返回 `404 { "error": "..." }`。

```json
{
  "gameId": "Nz_173",
  "mainTitle": "Nz_173的人物传记",
  "body": "……",
  "canEdit": true,
  "updatedAt": "2026-11-03T05:00:00.000Z"
}
```

`canEdit` 的判定：未登录为 `false`；账号 `username` 与 `gameId` 忽略大小写相等，
或账号角色是 `admin` 为 `true`。角色每次都从账号文件回查，不信任 cookie 里的旧值。

### `PUT /api/people/:id/biography`

保存传记，**需要登录会话**（`hydwind_session` cookie），请求体
`{ "mainTitle": "……", "body": "……" }`。

- 只有传记主人（账号 `username` 与目标 `gameId` 忽略大小写相等）或管理员能写；
  传记尚不存在时也一样，普通登录用户不能给别人创建第一篇
- 校验：主标题 2～40 字，空串回退「<gameId>的人物传记」；正文 0～4000 字，允许为空
- 一个玩家只有一篇传记，存在就覆盖
- 同一账号 10 分钟最多 12 次
- 错误：`401` 未登录、`403` 无权限、`404` slug 不存在、`400` 参数 / JSON 错误、
  `415` 不是 JSON、`413` 请求体过大、`429` 限流
- 成功返回与 GET 相同的字段 + `message`

### `GET /api/people/:id/comments`

公开读取某个人物的评论，按 `createdAt` 正序。`id` 与传记接口使用同一套 slug
解析规则（静态人物 entry id 优先，其次账号 `username`，忽略大小写）。

```json
{
  "comments": [
    {
      "id": "0f3c…",
      "authorGameId": "Bob",
      "authorDisplay": "小波",
      "body": "第一条",
      "createdAt": "2026-11-07T05:30:00.000Z"
    }
  ]
}
```

- 合法人物 / 账号还没有评论时返回 `{ "comments": [] }`，不是 404
- slug 既不是静态人物也不是账号时返回 `404 { "error": "..." }`
- `authorDisplay` 实时回查账号昵称；账号改名或删号后回退到 `authorGameId`

### `POST /api/people/:id/comments`

登录玩家发表评论，**需要 `hydwind_session` cookie**，请求体
`{ "body": "……" }`。

```json
{ "comment": { "id": "…", "authorGameId": "Bob", "authorDisplay": "小波", "body": "…", "createdAt": "…" } }
```

- 静态人物或已注册账号还没有运行期传记记录时，服务端先建一份空传记再追加评论
  （评论嵌在传记记录里），不会返回 404
- 评论 1–500 字，忽略首尾空白后判断
- 同一账号跨人物 10 分钟最多 5 条，超限返回 `429` + `Retry-After`
- 带 `Origin` 的请求必须同源，否则 `403`
- 错误：`401` 未登录、`403` 跨站来源、`404` slug 不存在、`400` 参数 / JSON 错误、
  `415` 不是 JSON、`413` 请求体过大（2KB）、`429` 限流
- 成功返回 `201`

### `DELETE /api/people/:id/comments/:cid`

删除一条评论，**需要登录会话**。只有评论作者本人或管理员可以删除。

- 成功：`{ "deleted": true }`
- `401` 未登录、`403` 跨站来源或没有权限、`404` 人物 / 评论不存在
- 角色以账号文件为准；权限降级后立即生效

### `GET /api/admin/pending.json`

待审队列，给 AstrBot 插件轮询用，需要令牌。

## 账号与登录

账号只有一条来源：群里 @机器人 后，**私聊**机器人发「注册 游戏ID」，`astrbot_plugin_hydwind_accounts` 插件回调 `/api/auth/register` 建号，再把账号密码私聊回本人。站点上不开放自助注册。

- 账号名 = 游戏 ID，只保留字母、数字、下划线，3–16 位（Minecraft 游戏 ID 上限 16）
- 密码随机生成 10 位（去掉 0/O/1/l/I 这类容易抄错的字符），只存 scrypt 哈希
- 同一个平台身份（QQ 号）重复注册 = 重置密码并沿用原账号，不会堆出重复账号
- 密码是明文私信发出的，**服务端不保存明文**，丢了只能重置

### `POST /api/auth/register` （需要站务令牌）

```json
{ "username": "Nz_173", "platformId": "QQ号", "platform": "qq_official", "nickname": "可选", "password": "可选，至少 10 位；不传就随机生成", "role": "player" }
```

注册接口默认只创建玩家。传 `"role": "admin"` 会被拒绝（403）；确实需要由接口创建管理员时，
在网站进程设置 `HYDWIND_ALLOW_ADMIN_REGISTER=1`，并且只让受信机器人在内网调用。

返回：

```json
{ "username": "Nz_173", "password": "生成或传入的密码", "role": "player", "created": true }
```

`created: false` 表示这个平台身份已存在，本次是密码重置（旧会话随 `sessionVersion` 递增失效）。
注册接口按 IP 10 分钟最多 20 次。

### `POST /api/auth/login`

```json
{ "username": "Nz_173", "password": "……" }
```

成功时下发 `hydwind_session` cookie（HttpOnly、SameSite=Lax、30 天），返回 `{ "account": { … } }`。
同一 IP 10 分钟最多 60 次请求；失败按账号+IP 10 分钟 5 次限流，账号跨 IP 的失败只记日志
（避免分布式攻击者锁死账号）。失败计数只在密码错误时消耗，成功登录会清零；正确密码不会因为
别人的爆破尝试被锁。

### `POST /api/auth/logout`

清掉会话 cookie。

### `GET /api/auth/me`

返回当前登录账号，未登录为 401。

### 页面

- `/account/`：账号页，站内唯一的登录入口。静态壳 + `GET /api/auth/me` 补水；未登录显示登录表单，已登录显示身份、注册时间、最近登录和退出按钮。
- `/login`：旧地址，302 到 `/account/`（脚本或老链接还在用）。

导航里不再有独立的「进服」入口，进服指南已并入 `/guides/`，一级导航为：首页 / 指南 / 人物 / 议题 / 账号。

## 状态流转

```
站内提交 ─► pending ─┬─ 群内「通过」─► open ─► done
                     └─ 群内「驳回」─► rejected
```

## 部署注意

- 议题与账号数据都存在本地 JSON 文件里，**只适合单实例、带持久磁盘的部署**（VPS / 自建容器）。EdgeOne 这类纯静态托管的 Pages 不能跑这层接口，需要改成边缘函数 + 数据库/对象存储。
- **生产必须在 TLS 反代后面**：Node 只监听 `127.0.0.1`，Caddy/Nginx 终止 TLS、压缩并透传真实 Host / `X-Forwarded-Proto` / `X-Forwarded-For`。示例见 `deploy/Caddyfile` 与 `deploy/nginx.conf.example`。
- 反代必须**覆盖** `X-Forwarded-For`（`$remote_addr`），不要追加；否则客户端可以伪造 IP 绕过限流。
- 构建时设置 `HYDWIND_SITE_URL=https://你的域名`，canonical 与该域名会自动进入 `security.allowedDomains`；默认仍保留 `103.236.99.253`、`localhost`、`127.0.0.1`。Host 不在名单里时登录的同源校验会 403。
- 每个写接口都有自己的请求体上限：登录 1KB、注册 2KB、议题 8KB、话题回复 2KB、传记 64KB、评论 2KB；适配器另有 1MB 兜底。
- 会话是无状态签名 cookie，`Secure` 由请求协议 / `X-Forwarded-Proto` 决定；`SESSION_SECRET` 一换所有人都会掉线。改密码会递增账号的 `sessionVersion`，旧 cookie 立即失效。
- 角色以账号文件为准：降权后现有会话的站务/传记权限立即失效，不用等 30 天。
- `/account/` 的账号帮助区会直接给出官方 QQ 群号和复制按钮；忘记密码按 `docs/backend-api.md` 的注册流程找机器人重置。
- 想无状态部署时，把 `src/lib/issues.ts`、`src/lib/accounts.ts` 与 `src/lib/biographies.ts` 换成 MySQL / D1 / KV 实现即可，接口层不用动。
