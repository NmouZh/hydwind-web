#!/usr/bin/env bash
# 由 hydwind-restart.path 触发：重启主服务，确认 /api/health?ready=1 通过后才删除请求文件。
# 健康检查没通过时保留请求文件并以非零退出，运维可以立刻看到失败的 unit。
set -euo pipefail

REQUEST_FILE=/run/hydwind/restart-request
HEALTH_URL="${HYDWIND_HEALTH_URL:-http://127.0.0.1:4321/api/health?ready=1}"

systemctl restart hydwind-web.service

for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    rm -f -- "$REQUEST_FILE"
    exit 0
  fi
  sleep 1
done

echo "hydwind-web did not become healthy within 30s; keeping $REQUEST_FILE" >&2
exit 1