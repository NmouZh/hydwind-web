# 后端接口与部署

站点现在是「静态页面 + 运行时 API」：内容页仍在构建期渲染成 HTML，`/api/*` 由 Node 适配器（`@astrojs/node` standalone）在运行时处理。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ISSUE_ADMIN_TOKEN` | 议题功能必填 | 站务共享密钥。插件调用写接口时用 `Authorization: Bearer <token>`。不设置则所有写接口与待审列表都返回 401。 |
| `HYDWIND_DATA_DIR` | 否 | 议题 JSON 的存放目录，默认 `<cwd>/data`。 |
| `STATUS_ENDPOINT` | 否 | 服务器状态数据源，默认 `https://api.mcstatus.io/v2/status/java`。以后插件自建 HTTP 状态接口，把它指过去即可。 |
| `HOST` / `PORT` | 否 | `node ./dist/server/entry.mjs` 的监听地址，默认 `0.0.0.0:4321`。 |

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

## 状态流转

```
站内提交 ─► pending ─┬─ 群内「通过」─► open ─► done
                     └─ 群内「驳回」─► rejected
```

## 部署注意

- 议题数据存在本地 JSON 文件里，**只适合单实例、带持久磁盘的部署**（VPS / 自建容器）。EdgeOne 这类纯静态托管的 Pages 不能跑这层接口，需要改成边缘函数 + 数据库/对象存储。
- 想无状态部署时，把 `src/lib/issues.ts` 换成 MySQL / D1 / KV 实现即可，接口层不用动。
