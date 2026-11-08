# ADR-0003：生产安全的默认值

- 状态：已采纳
- 日期：2026-11-08

## 背景

网站承载账号密码、30 天会话、站务令牌和游戏登录码。早期实现为了本地开发方便，
允许固定开发会话密钥、明文 HTTP、无响应头、无请求体细分限制；这些默认值一旦
被带进生产，等于把认证边界交给链路攻击者。

## 决策

1. **TLS 前置**：生产必须由 Caddy/Nginx 终止 TLS，Node 只监听 `127.0.0.1`。
   反代覆盖 `X-Forwarded-For`，`astro.config.mjs` 通过 `HYDWIND_SITE_URL` 自动
   把真实域名加入 `allowedDomains`。
2. **令牌互异**：`SESSION_SECRET`（≥32 字符）只用于会话签名，不再退回
   `ISSUE_ADMIN_TOKEN`；三个令牌必须互不相同。`scripts/check-env.mjs` 在
   systemd 启动前强制检查。
3. **会话可撤销**：账号增加 `sessionVersion`，改密码时递增；读写接口通过
   `accountForSession` 回查账号并比对版本，旧 cookie 立即失效。
4. **输出安全**：CSP 由 Astro `security.csp` 生成 hash；`middleware.ts` 补
   nosniff / Referrer-Policy / X-Frame-Options / Permissions-Policy / HSTS；
   静态文件由反代补同样的头。
5. **资源上限**：每个写接口有独立请求体上限；头像与状态代理限制上游响应大小、
   并发与负缓存；议题有总量/待审上限。
6. **数据文件**：0700 目录、0600 文件、写临时文件后 fsync + rename；每日备份。
7. **单实例**：JSON 存储、登录码与限流仍是进程内实现；systemd 用 flock 防止
   双进程。多实例部署需要先迁移到 SQLite/Redis。

## 后果

- 缺少令牌或使用明文 HTTP 时，生产启动会失败/显著告警；本地开发需要显式配置
  `allow-insecure-http`（插件侧）或使用开发环境随机密钥（网站侧）。
- 改密码会让该账号在所有设备上的旧会话失效，这是有意的行为。
- 反代成为部署的一部分，不再是可选项；`deploy/` 提供 Caddy 与 Nginx 示例。
