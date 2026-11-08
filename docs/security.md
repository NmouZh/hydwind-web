# 后端安全

登录和账号相关的信任边界只有两条：浏览器 → `/api/auth/*`，插件 → `/api/auth/register`。
这一页写清楚现在靠什么防，以及以后改存储时不能丢的东西。

## 1. 现在没有 SQL，所以没有 SQL 注入面

账号、议题、传记都存在 `HYDWIND_DATA_DIR` 下的 JSON 文件里（`src/lib/accounts.ts`），
查询是数组 `find`，不存在字符串拼 SQL。真正要守的是「进库之前的输入」：

| 字段 | 处理 | 位置 |
| --- | --- | --- |
| 账号名 | 白名单 `[A-Za-z0-9_]`，3–16 位，大小写不敏感比较 | `normalizeUsername` / `isValidUsername` |
| 密码 | 6–200 位，超过 200 直接判失败，不交给 scrypt | `MAX_PASSWORD_LENGTH` |
| QQ 号 | 去掉首尾空白，截断 64 位 | `normalizePlatformId` |
| 昵称 | 截断 32 位 | `registerAccount` |
| 请求体 | 只收 `application/json`，上限 1KB | `api/auth/login.ts` |

白名单比黑名单可靠：过滤掉非法字符之后，剩下的内容不可能改变数据文件结构。

## 2. 以后换成 SQLite / Postgres 时

只有一个规矩：**任何变量都走占位符，永远不要拼字符串。**

```ts
// 对
db.prepare('select * from accounts where username = ?').get(username);
await pg.query('select * from accounts where username = $1', [username]);

// 错：哪怕 username 已经过白名单，也不要养成这个习惯
db.prepare(`select * from accounts where username = '${username}'`);
```

配套的三件事：

- 表名和列名如果是变量，只能从白名单映射里取，不能直接插值；
- 数据库账号只给最小权限（读写业务表，不给 DDL）；
- 排序字段 `order by` 同理，用常量表 map。

## 3. 认证

- 密码用 `scrypt`（N=16384, r=8, p=1），每个账号独立随机盐，格式 `scrypt$salt$hash`；
- 比较用 `timingSafeEqual`，长度不等直接失败，不做逐字节短路；
- **账号不存在时也跑一次 scrypt**（假哈希），让「没这个号」和「密码错」耗时接近，
  否则响应时间就是账号枚举器；
- 失败一律回 `账号或密码不对`，不区分原因，日志里也不落密码。

## 4. 会话

`hydwind_session` 是 `base64url(payload).HMAC-SHA256` 的签名令牌，服务端无状态：

- `HttpOnly` + `SameSite=Lax` + `Secure`（由请求协议 / `X-Forwarded-Proto` 决定），30 天过期；
- 签名密钥只取 `SESSION_SECRET`（生产至少 32 字符，且不能与 `ISSUE_ADMIN_TOKEN` 相同）；缺失时用进程内随机密钥并记录错误，重启即全员掉线。不再退回站务令牌——否则拿到站务令牌就能伪造任意玩家（包括管理员）的 cookie；
- 校验先比签名再解析 JSON，签名不对直接丢弃；畸形 cookie 解析失败按未登录处理，不打 500；
- **cookie 里的 role 只用于展示**：站务判定和传记编辑权限每次回查账号文件，降权立即生效，
  不用等 30 天会话过期。

## 5. 接口层的三道闸

1. **同源**：带 `Origin` 的请求必须和本站同域，跨站 POST 直接 403（插件调用不带 Origin，放行）。
   反代必须透传真实 Host，并在 `astro.config.mjs` 的 `security.allowedDomains` 里登记域名；
   否则 `request.url` 会回落成 localhost，所有浏览器登录都会被判成跨站。
2. **类型与体积**：每个写接口有自己的 JSON 类型检查与请求体上限（登录 1KB、注册 2KB、
   议题 8KB、话题回复 2KB、传记 16KB、评论 4KB），Node 适配器另有 1MB 兜底；
3. **限流**：`src/lib/rate-limit.ts` 的进程内滑动窗口，按路由分别限额：登录 IP 60 次/10 分钟，
   失败按账号+IP 5 次/10 分钟（账号跨 IP 的失败只记日志，避免被用来锁死账号），
   议题 5 次/10 分钟，头像 300 次/分钟，/gate 生成 20 次/分钟且全局 60 次/分钟。
   超出返回 429 并带 `retry-after`。重启即清空，多实例要换 Redis。
   反代后面只有 Host 通过 `allowedDomains` 校验时才会信任 `X-Forwarded-For`。生产必须让 Node
   只监听 `127.0.0.1`，并由反代**覆盖** `X-Forwarded-For: $remote_addr`；否则客户端可以自填
   该头，把 IP 限流拆成任意多个桶。IPv6 地址在限流前按 /64 归并。

## 6. 输出与前端

- 所有用户内容都从 JSON 读出来再渲染，Astro 模板默认转义；前端 JS 用 `textContent` 拼 DOM。
  唯一的 `innerHTML` 是传记 Markdown 渲染结果（`markdown.ts` 全量转义 + 协议白名单），
  不是直接写用户原文；
- 站内没有上传入口，没有文件读写接口对外暴露；
- 前端只做体验校验（格式、必填），**真正的校验一律在服务端再做一遍**。

## 7. 已做与后续

- 登录成功/失败已经记录账号和归一化 IP（不记密码、不记登录码）；日志由 journald 轮转；
- 统一安全响应头由 `src/middleware.ts` 负责（nosniff、Referrer-Policy、X-Frame-Options、
  Permissions-Policy、HTTPS 下的 HSTS）；CSP 由 `astro.config.mjs` 的 `security.csp` 生成，
  静态文件由 `deploy/Caddyfile` / `deploy/nginx.conf.example` 补头；
- 密码重置会递增账号 `sessionVersion`，旧 cookie 立即失效；
- 仍然值得排期：多实例时把限流/登录码换成 Redis、缩短会话 TTL 或改为 `__Host-` cookie
  （需要 HTTPS 域名）、把 data JSON 迁移到 SQLite/Postgres。
