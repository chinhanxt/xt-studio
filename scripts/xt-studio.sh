#!/bin/sh
# Chạy xT studio từ thư mục repo (Linux). Dùng cho icon menu ứng dụng / Desktop.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec "$DIR/node_modules/electron/dist/electron" --no-sandbox "$DIR" "$@"
