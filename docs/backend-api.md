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

### `GET /api/issues`

公开议题列表（不含 `pending`）。带 `?includePending=1` 且带站务令牌时返回全部。

### `POST /api/issues`

```json
{ "title": "末地传送门附近卡顿", "body": "详细描述……", "author": "游戏ID（可空）", "category": "bug" }
```

- `category`：`bug` / `suggestion` / `other`
- 校验：标题 ≥ 4 字，描述 ≥ 10 字；同一 IP 10 分钟内最多 5 次
- 新议题状态为 `pending`，需要群里审核后才公开

### `GET /api/issues/:id`

单个议题（`pending` 仅站务令牌可见）。

### `PATCH /api/issues/:id`

站务改状态：`{ "status": "open" | "rejected" | "done" }`，需要令牌。

### `POST /api/issues/:id/replies`

站务回复：`{ "body": "…", "author": "可选" }`，需要令牌。插件把群里的处理进展同步到这里。

### `GET /api/admin/pending.json`

待审队列，给 AstrBot 插件轮询用，需要令牌。

## 账号与登录

账号只有一条来源：群里 @机器人 后，**私聊**机器人发「注册 游戏ID」，`astrbot_plugin_hydwind_accounts` 插件回调 `/api/auth/register` 建号，再把账号密码私聊回本人。站点上不开放自助注册。

- 账号名 = 游戏 ID，只保留字母、数字、下划线，3–24 位
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
- 会话是无状态签名 cookie，重启服务不会踢人；`SESSION_SECRET` 一换所有人都会掉线。
- 想无状态部署时，把 `src/lib/issues.ts` 和 `src/lib/accounts.ts` 换成 MySQL / D1 / KV 实现即可，接口层不用动。
