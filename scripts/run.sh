#!/usr/bin/env bash
# 本机/线上启动脚本：读取同目录下的 .env，先做环境检查，再跑 Astro Node standalone 产物。
# 第一次部署先 `npm run build`（要用 Node >= 22.23.4 构建）。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "缺少 .env，请先创建：ISSUE_ADMIN_TOKEN / PLUGIN_TOKEN / SESSION_SECRET / HYDWIND_DATA_DIR / HOST / PORT" >&2
  exit 1
fi

node --env-file=.env ./scripts/check-env.mjs

# 单实例锁：三个 JSON 存储的写队列只在进程内有效，两个进程会互相覆盖。
LOCK_DIR="${HYDWIND_LOCK_DIR:-/run/hydwind}"
if ! mkdir -p "$LOCK_DIR" 2>/dev/null || [ ! -w "$LOCK_DIR" ]; then
  LOCK_DIR=./data
  mkdir -p "$LOCK_DIR"
fi
exec flock -n "$LOCK_DIR/web.lock" node --env-file=.env ./dist/server/entry.mjs