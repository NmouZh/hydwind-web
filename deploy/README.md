# 部署

网站由 systemd 守护，Node standalone 只负责运行时页面与 `/api/*`。
生产环境要求：TLS 反代在前，Node 只监听回环；插件通过写请求文件触发受控重启。

| 文件 | 作用 |
| --- | --- |
| `hydwind-web.service` | 主服务：专用用户、只读根文件系统、启动前 env 检查、单实例锁 |
| `hydwind-restart.path` | 监听 `/run/hydwind/restart-request` 的内容变化 |
| `hydwind-restart.service` | 调 `restart.sh`：重启 → 轮询健康检查 → 成功才删除请求文件 |
| `hydwind-backup.timer` | 每天 04:15 备份 data JSON，保留 14 天 |
| `Caddyfile` / `nginx.conf.example` | TLS、压缩、静态缓存与反代示例 |

## 1. 前置：用户、目录、令牌

```bash
sudo useradd --system --home /opt/hydwind-web --shell /usr/sbin/nologin hydwind
sudo install -d -o hydwind -g hydwind -m 0755 /opt/hydwind-web
sudo install -d -o hydwind -g hydwind -m 0700 /opt/hydwind-web/data
```

把仓库放到 `/opt/hydwind-web` 后：

```bash
cd /opt/hydwind-web
npm ci            # Node >= 22.23.4
cp .env.example .env
chmod 0600 .env
# 填入三个互不相同的 32+ 字符随机串
```

```bash
# 生成令牌示例
openssl rand -hex 32
```

`.env` 关键项：`ISSUE_ADMIN_TOKEN`、`PLUGIN_TOKEN`、`SESSION_SECRET`、
`HYDWIND_DATA_DIR`、`HOST`、`PORT`。放在反代后面时 `HOST=127.0.0.1`。
启动前 `scripts/check-env.mjs` 会拒绝缺失、过短、占位值或互相重复的令牌，
并把 data 目录/JSON 收紧到 0700/0600。

## 2. 构建与发布（不要在生产目录原地构建）

推荐发布目录 + `current` 软链接，构建失败不影响线上：

```bash
# CI 已验证的提交
git fetch && git checkout <commit>
npm ci
npm run build
# 产物在 dist/client（静态）与 dist/server（Node）

sudo rsync -a --delete dist/ /opt/hydwind-web/releases/<commit>/dist/
sudo ln -sfn /opt/hydwind-web/releases/<commit> /opt/hydwind-web/current
sudo systemctl restart hydwind-web.service
```

至少保留上一版目录；回滚：

```bash
sudo ln -sfn /opt/hydwind-web/releases/<previous> /opt/hydwind-web/current
sudo systemctl restart hydwind-web.service
```

服务 unit 里的 `WorkingDirectory` / `ReadWritePaths` 需要指向 `current` 或实际仓库目录，
按你的发布布局调整。

## 3. 安装 systemd 单元

```bash
sudo install -m 0644 deploy/hydwind-web.service \
  deploy/hydwind-restart.service \
  deploy/hydwind-restart.path \
  deploy/hydwind-backup.service \
  deploy/hydwind-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload

sudo systemctl enable --now hydwind-web.service
sudo systemctl enable --now hydwind-restart.path
sudo systemctl enable --now hydwind-backup.timer
```

检查：

```bash
systemctl status hydwind-web.service --no-pager
systemctl status hydwind-restart.path --no-pager
journalctl -u hydwind-web.service -f
```

`hydwind-web.service` 默认 `User=hydwind`、`ProtectSystem=strict`、`UMask=0077`；
`ReadWritePaths` 只放开 `data` 与 `/run/hydwind`。如果数据目录不在
`/opt/hydwind-web/data`，同步修改 unit 与 `.env`。

## 4. TLS 反代（必须）

直接暴露 Node 的 HTTP 端口会让密码、会话 cookie、`PLUGIN_TOKEN` 和
`ISSUE_ADMIN_TOKEN` 以明文经过公网。上线前至少完成：

1. 有域名：用 `deploy/Caddyfile` 或 `deploy/nginx.conf.example` 终止 TLS；
2. 反代必须覆盖 `X-Forwarded-For`（`$remote_addr`，不要追加）和
   `X-Forwarded-Proto`，并透传真实 `Host`；如果反代前面还有 CDN/负载均衡，
   要在 Caddy 配 `trusted_proxies` 或在 Nginx 配 `set_real_ip_from`，
   否则所有访客会共享同一个 IP 限流桶。
3. 构建时设置 `HYDWIND_SITE_URL=https://hydwind.example.com npm run build`；
   canonical 与该域名会自动进入 `security.allowedDomains`，不用再手改源码；
4. `HOST=127.0.0.1`，不要再把 4321 映射到公网；
5. 上线后轮换所有曾经走过 HTTP 的令牌。

只走 IP、暂时没有域名时，至少把 Node 放在反代后面并用自签证书验证流程；
没有 TLS 就不要把它当成正式环境。

> 注意：`@astrojs/node` 的静态文件处理器先于 Astro 中间件执行，预渲染 HTML
> 不会经过 `src/middleware.ts`。直接运行 `scripts/run.sh`/`entry.mjs` 时，
> 首页、`/account/`、`/issues/`、指南页没有 `X-Frame-Options` 等安全头；
> 生产必须由上面的反代补头（示例已包含）。

## 5. 插件写重启请求

插件以 Minecraft 服务端用户运行，需要能创建 `/run/hydwind/restart-request`：

```bash
sudo usermod -aG hydwind minecraft
```

`RuntimeDirectoryMode=0770` 让 `hydwind` 组可写。不要在 `/run/hydwind` 里放
其他敏感文件；重启脚本只会删除固定路径，并用健康检查确认服务真的起来了。

## 6. 备份与恢复

`hydwind-backup.timer` 每天把 `data/` 打包到 `/var/backups/hydwind/`，保留 14 天，
文件 0600。先创建备份目录（属主为服务用户）：

```bash
sudo install -d -o hydwind -g hydwind -m 0700 /var/backups/hydwind
```

正式环境还应把备份同步到另一台机器/对象存储：

```bash
# 示例：同步到备份机
rsync -a --delete /var/backups/hydwind/ backup-host:/srv/backups/hydwind/
```

恢复：

```bash
sudo systemctl stop hydwind-web.service
sudo tar -xzf /var/backups/hydwind/hydwind-<stamp>.tar.gz -C /opt/hydwind-web/data
sudo chown -R hydwind:hydwind /opt/hydwind-web/data
sudo chmod 700 /opt/hydwind-web/data && sudo chmod 600 /opt/hydwind-web/data/*.json
sudo systemctl start hydwind-web.service
curl -fsS http://127.0.0.1:4321/api/health?ready=1
```

## 7. 健康检查

- `GET /api/health`：liveness，插件与 systemd 探活；
- `GET /api/health?ready=1`：额外检查 data 目录可写、三个 JSON 可解析，异常返回 503。

## 8. 常见故障

- **登录 403「请求来源不对」**：反代没有透传真实 Host，或域名没进
  `security.allowedDomains`。
- **所有插件请求 401**：网站 `PLUGIN_TOKEN` 与代理环境变量
  `HYDWIND_PLUGIN_TOKEN` 不一致。
- **重启请求一直存在**：`journalctl -u hydwind-restart.service` 看 `restart.sh`
  的健康检查失败原因；文件会保留以便人工处理。
- **数据像被清空**：检查 `HYDWIND_DATA_DIR` 是否指向了另一个目录；不要在没有
  备份的情况下改这个变量。