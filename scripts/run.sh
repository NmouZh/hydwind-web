#!/usr/bin/env bash
# 本机/线上启动脚本：读取同目录下的 .env，再跑 Astro Node standalone 产物。
# 第一次部署先 `npm run build`（要用 Node >= 22.23.4 构建）。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "缺少 .env，请先创建：ISSUE_ADMIN_TOKEN / SESSION_SECRET / HYDWIND_DATA_DIR / HOST / PORT" >&2
  exit 1
fi

exec node --env-file=.env ./dist/server/entry.mjs
