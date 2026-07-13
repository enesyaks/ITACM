#!/bin/sh
# Ensure the DATA_DIR volume is writable by the unprivileged `node` user, then
# drop privileges. Named Docker volumes are often root-owned on first create.
set -e
DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR/documents/handover" "$DATA_DIR/documents/maintenance"
chown -R node:node "$DATA_DIR" || true
exec su-exec node "$@"
