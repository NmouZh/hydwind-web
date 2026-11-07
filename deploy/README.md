# systemd 部署

网站的 Node standalone 产物由 systemd 守护；插件通过写一个请求文件触发重启，
不需要 sudo，也不额外开网络端口。

| 文件 | 作用 |
| --- | --- |
| `hydwind-web.service` | 主服务：开机自启，崩溃/退出后 5 秒拉起 |
| `hydwind-restart.path` | 监听 `/run/hydwind/restart-request` |
| `hydwind-restart.service` | 请求文件出现后重启主服务，成功后再删除请求文件（oneshot） |

## 1. 安装

```bash
# 仓库放到 /opt/hydwind-web 后，先构建出 dist/server/entry.mjs
cd /opt/hydwind-web

sudo install -m 0644 deploy/hydwind-web.service \
  deploy/hydwind-restart.service \
  deploy/hydwind-restart.path /etc/systemd/system/
sudo systemctl daemon-reload

sudo systemctl enable --now hydwind-web.service
sudo systemctl enable --now hydwind-restart.path
```

`enable --now` 会同时写入开机自启链接并立即启动。检查状态：

```bash
systemctl status hydwind-web.service --no-pager
systemctl status hydwind-restart.path --no-pager
journalctl -u hydwind-web.service -f
```

## 2. 按实际环境调整

`hydwind-web.service` 里的值都是占位默认值，**不要假设运行用户和路径**：

- `WorkingDirectory`：改成仓库实际目录。
- `ExecStart`：`/usr/bin/node` 改成 `command -v node` 的结果；nvm / fnm 安装的 node
  通常不在 `/usr/bin`。`.env` 必须位于 `WorkingDirectory`。
- `User` / `Group`：正式部署取消注释并改成实际用户。若保持 root，权限最省事但隔离最差。
- `.env`：至少包含 `ISSUE_ADMIN_TOKEN`、`SESSION_SECRET`、`HYDWIND_DATA_DIR`、`HOST`、`PORT`，
  变量含义见 `docs/backend-api.md`。

```ini
#User=hydwind
#Group=hydwind
```

数据目录（默认 `./data`）必须对运行用户可写，否则议题和账号无法保存：

```bash
sudo chown -R hydwind:hydwind /opt/hydwind-web/data
```

## 3. `/run/hydwind` 权限（插件写重启请求）

插件以 Minecraft 服务端的用户运行，必须能创建 `/run/hydwind/restart-request`：

```bash
# 以插件用户身份验证
touch /run/hydwind/restart-request && rm /run/hydwind/restart-request
```

`hydwind-web.service` 通过 `RuntimeDirectory=hydwind` 创建该目录，属主是服务的
`User:Group`（未设置时是 `root:root`），模式 `0775`。要让插件用户能写，任选一种：

1. **推荐**：给主服务设置 `User` / `Group`，把插件运行用户加入同一个组
   （例如 `sudo usermod -aG hydwind minecraft`）。目录保持 `0775`。
2. 不用 `RuntimeDirectory`，改用 tmpfiles.d，明确属组：

   ```bash
   # /etc/tmpfiles.d/hydwind.conf
   d /run/hydwind 0775 hydwind hydwind -
   ```

   然后 `sudo systemd-tmpfiles --create`，并确保插件用户属于 `hydwind` 组。
3. 临时验证可用 `RuntimeDirectoryMode=0777`，不建议长期使用。

`/run` 是 tmpfs，重启后目录会重新创建；tmpfiles.d 方案会在每次开机时恢复权限。

## 4. 重启触发流程

1. 插件探活失败后，以自身用户创建 `/run/hydwind/restart-request`。
2. `hydwind-restart.path` 检测到文件存在，启动 `hydwind-restart.service`。
3. 该 oneshot 服务先执行 `systemctl restart hydwind-web.service`，**重启成功后才**
   删除请求文件；重启失败则保留文件，让 path 单元再次触发重试。
4. `Restart=always` + `RestartSec=5` 继续兜底意外退出。

插件的冷却与次数上限在插件侧控制，systemd 只负责执行。
