#!/usr/bin/env bash
# 每日备份账号 / 传记 / 议题 JSON。默认保留 14 天。
# 只做本机备份；正式部署还应把 $DEST 同步到另一台机器或对象存储（见 deploy/README.md）。
set -euo pipefail

DATA_DIR="${HYDWIND_DATA_DIR:-/opt/hydwind-web/data}"
DEST="${HYDWIND_BACKUP_DIR:-/var/backups/hydwind}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
KEEP_DAYS="${HYDWIND_BACKUP_KEEP_DAYS:-14}"

install -d -m 0700 "$DEST"
tmp="$(mktemp "$DEST/.hydwind-backup-XXXXXX.tar.gz")"
trap 'rm -f "$tmp"' EXIT

# 数据文件只有几百 KB；tar 比数据库备份工具简单，也方便人工恢复。
tar -czf "$tmp" -C "$DATA_DIR" .
chmod 0600 "$tmp"
mv "$tmp" "$DEST/hydwind-$STAMP.tar.gz"
trap - EXIT

find "$DEST" -maxdepth 1 -name 'hydwind-*.tar.gz' -type f -mtime "+$KEEP_DAYS" -delete
echo "backup written: $DEST/hydwind-$STAMP.tar.gz"