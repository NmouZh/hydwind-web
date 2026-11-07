# 后端接口与部署

站点现在是「静态页面 + 运行时 API」：内容页仍在构建期渲染成 HTML，`/api/*` 由 Node 适配器（`@astrojs/node` standalone）在运行时处理。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ISSUE_ADMIN_TOKEN` | 议题与账号功能必填 | 站务共享密钥。插件调用写接口时用 `Authorization: Bearer <token>`。不设置则所有写接口、待审列表、注册接口都返回 401。 |
| `SESSION_SECRET` | 上线必填 | 登录会话 cookie 的 HMAC 密钥，至少 16 字符。不配会退回 `ISSUE_ADMIN_TOKEN`，两者都没有时用开发密钥并打警告。 |
| `HYDWIND_DATA_DIR` | 否 | 议题与账号 JSON 的存放目录，默认 `<cwd>/data`。 |
| `STATUS_ENDPOINT` | 否 | 服务器状态数据源，默认 `https://api.mcstatus.io/v2/status/java`。以后插件自建 HTTP 状态接口，把它指过去即可。 |
| `HOST` / `PORT` | 否 | `node ./dist/server/entry.mjs` 的监听地址，默认 `0.0.0.0:4321`。 |

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
ISSUE_ADMIN_TOKEN=<随机串>
SESSION_SECRET=<另一个随机串>
HYDWIND_DATA_DIR=./data
HOST=0.0.0.0
PORT=4321
```

## 接口

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

公开议题列表（不含 `pending`）。带 `?includePending=1` 且带站务权限（令牌或 admin 账号）时返回全部。

### `POST /api/issues`

```json
{ "title": "末地传送门附近卡顿", "body": "详细描述……", "author": "游戏ID（可空）", "category": "bug" }
```

- `category`：`bug` / `suggestion` / `other`
- 校验：标题 ≥ 4 字，描述 ≥ 10 字；同一 IP 10 分钟内最多 5 次
- 新议题状态为 `pending`，需要群里审核后才公开

### `GET /api/issues/:id`

单个议题（`pending` 仅站务权限可见）。

### `PATCH /api/issues/:id`

站务改状态：`{ "status": "open" | "rejected" | "done" }`，需要站务权限（令牌或 admin 账号）。

### `POST /api/issues/:id/replies`

站务回复：`{ "body": "…", "author": "可选" }`，需要站务权限（令牌或 admin 账号）。插件把群里的处理进展同步到这里。

### `GET /api/people/:id/biography`

人物传记（`id` 是内容集合里的 slug，例如 `nz-173`）。没写过时 `biography` 是 `null`。
正文里用 `@游戏ID` 引用其他玩家，`refs` 会带上引用对象，前端据此渲染人物链接。

除了正文，这条还把**当前请求者能不能改**一起带回来：页面上的入口（写一篇 / 编辑 / 只读）
据此切换，不用再额外打一趟 `/api/auth/me`。

```json
{
  "signedIn": true,
  "canEdit": true,
  "limits": { "min": 20, "max": 4000, "refs": 12 },
  "biography": {
    "body": "……@Nz_173 在……",
    "author": "写的人昵称",
    "createdAt": "2026-11-03T05:00:00.000Z",
    "updatedAt": "2026-11-03T05:00:00.000Z",
    "refs": [{ "personId": "nz-173", "gameId": "Nz_173" }]
  }
}
```

`canEdit` 的判定：未登录为 `false`；登录后没有传记或自己是作者、或角色是 `admin` 为 `true`。

人物页是构建期渲染的，**传记正文在构建时就写进 HTML**（构建机读同一份 `HYDWIND_DATA_DIR`），
所以打开页面第一屏就有内容；浏览器再拉这条接口刷新最新版本，内容没变就不重画。
改了传记要等下一次构建才会进静态 HTML，期间靠接口补。

### `PUT /api/people/:id/biography`

保存传记，**需要登录会话**（`hydwind_session` cookie），请求体 `{ "body": "……" }`。

- 校验：正文 20～4000 字；`@游戏ID` 必须是已发布人物，最多引用 12 位；引用自己不重复计入
- 一个玩家只有一篇传记，存在就覆盖；只有作者本人和站点管理员能改
- 同一账号 10 分钟最多 12 次
- 成功返回同 GET 结构 + `message`

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
{ "username": "Nz_173", "platformId": "QQ号", "platform": "qq_official", "nickname": "可选", "password": "可选，不传就随机生成", "role": "player | admin" }
```

返回：

```json
{ "username": "Nz_173", "password": "生成或传入的密码", "role": "admin", "created": true }
```

`created: false` 表示这个平台身份已存在，本次是密码重置。插件连续注册有 10 分钟 60 次的总限流。

### `POST /api/auth/login`

```json
{ "username": "Nz_173", "password": "……" }
```

成功时下发 `hydwind_session` cookie（HttpOnly、SameSite=Lax、30 天），返回 `{ "account": { … } }`。同一 IP 10 分钟最多 10 次。

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
- 站点前面是 NAT 转发，没有独立公网 IP：服务只监听 `0.0.0.0:4321`，由路由器把公网端口映射进来。
- **反向代理必须透传真实 Host 和 `X-Forwarded-Proto`。** `astro.config.mjs` 的 `security.allowedDomains` 只认可
  `103.236.99.253`、`localhost`、`127.0.0.1`：Host 不在名单里时 Astro 会把 `request.url` 回落成 localhost，
  登录的同源校验会直接 403，`X-Forwarded-For` 也不会被信任（限流会按代理 IP 分桶）。换域名时记得同步这份名单。
- 所有写接口的请求体在适配器层统一限制为 1MB（`bodySizeLimit`）；登录接口另有 1KB 的更严限制。
- 会话是无状态签名 cookie，`Secure` 由请求协议 / `X-Forwarded-Proto` 决定，重启服务不会踢人；`SESSION_SECRET` 一换所有人都会掉线。
- 角色以账号文件为准：降权后现有会话的站务/传记权限立即失效，不用等 30 天。
- `/account/` 的账号帮助区会直接给出官方 QQ 群号和复制按钮；忘记密码按 `docs/backend-api.md` 的注册流程找机器人重置。
- 想无状态部署时，把 `src/lib/issues.ts` 和 `src/lib/accounts.ts` 换成 MySQL / D1 / KV 实现即可，接口层不用动。
