# 安全边界

账号、会话、传记、评论、议题与登录码的实现已经搬到 [`hydwind-api`](../../hydwind-api)。
那一侧的输入校验、scrypt、限流、令牌与会话设计以它的文档和源码为准；本文件只写
Web 这一层仍然负责的安全边界。

## 1. Web 不再保存敏感数据

- 仓库与运行目录里没有账号、密码哈希、`biographies.json` 或议题数据；
- Web 不解析会话 cookie，只把浏览器带来的 `Cookie` 转发给后端；
- 页面 SSR 用的是服务端内部请求（`HYDWIND_API_ORIGIN`），不是浏览器直连后端；
  后端默认只需要监听回环地址。

## 2. 反代的信任规则

`src/pages/api/[...path].ts` 与页面 SSR 共用 `src/lib/api-client.ts`：

- 只允许代理 `/api/` 路径，`HYDWIND_API_ORIGIN` 之外的地址不会进入 `fetch`；
- 请求头删掉 `Host` 与 `Content-Length`，由 fetch 按目标地址重算；
- `X-Forwarded-For` 只用 `Astro.clientAddress`，**不采信客户端自带的 XFF**；
- `X-Forwarded-Host` / `Proto` 用 `Astro.request` 的真实 URL；
- 响应逐条转发 `Set-Cookie`，不去改写后端的会话策略；
- 逐跳头与 `content-encoding` / `content-length` 不原样回传，避免响应错位。

## 3. 何时信任 X-Forwarded-For

`Astro.clientAddress` 只有在 Host 通过 `astro.config.mjs` 的 `security.allowedDomains`
校验后才会采信反代传来的 XFF。换域名时必须同步这份名单，否则真实客户端 IP
会变成反代地址，后端限流会把所有请求挤进同一个桶。

后端只信任回环地址发来的 XFF；Web 与后端跨机部署时，要配置后端的
`TRUSTED_PROXY_CIDRS`。

## 4. 输出与前端

- 传记 Markdown 由 `src/lib/markdown.ts` 先转义再拼标签，链接只放行
  `http(s):`、`mailto:`、站内绝对路径、锚点与相对路径；
- 浏览器脚本更新评论 / 传记时用 `textContent` 与同一份渲染函数，不把用户输入
  当 HTML 整块插入；
- 前端只做体验校验（格式、必填、长度），**真正的校验以后端为准**。

## 5. 还没做

- 登录成功 / 失败的结构化审计日志；
- 多实例部署时的分布式限流与会话密钥轮换；
- 给 `/api/*` 统一加安全响应头与 CSP。
