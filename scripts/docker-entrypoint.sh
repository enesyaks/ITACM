#!/bin/sh
# Ensure the DATA_DIR volume is writable by the unprivileged `node` user, then
# drop privileges. Named Docker volumes are often root-owned on first create.
#
# Critical: uploads MUST land on the named volume `app-data` (→ /app/data).
# If this directory is not a mount, files vanish on container recreate.
set -e
DATA_DIR="${DATA_DIR:-/app/data}"

mkdir -p \
  "$DATA_DIR/documents/handover" \
  "$DATA_DIR/documents/maintenance" \
  "$DATA_DIR/documents/provider" \
  "$DATA_DIR/documents/contract" \
  "$DATA_DIR/documents/license"

# Detect whether DATA_DIR is its own mount (named/anonymous volume or bind).
# On Docker Desktop the volume appears as e.g. `/dev/vda1 /app/data ...`.
MOUNTED=0
if awk -v p="$DATA_DIR" '$2 == p { found=1 } END { exit !found }' /proc/mounts 2>/dev/null; then
  MOUNTED=1
fi

if [ "$MOUNTED" -ne 1 ]; then
  echo "================================================================" >&2
  echo "[itacm] FATAL: $DATA_DIR is not a Docker volume mount." >&2
  echo "[itacm] Uploaded documents would be lost on every recreate." >&2
  echo "[itacm] Fix: ensure docker-compose.yml has:" >&2
  echo "[itacm]   api.volumes: [ app-data:/app/data ]" >&2
  echo "[itacm]   volumes.app-data: {}" >&2
  echo "[itacm] Then: docker compose up -d --force-recreate api" >&2
  echo "================================================================" >&2
  exit 1
fi

chown -R node:node "$DATA_DIR" || true

# Prove the node user can write (catches bad ownership / read-only mounts).
if ! su-exec node sh -c "touch \"$DATA_DIR/.itacm-write-test\" && rm -f \"$DATA_DIR/.itacm-write-test\""; then
  echo "[itacm] FATAL: $DATA_DIR is mounted but not writable by user 'node'." >&2
  exit 1
fi

echo "[itacm] DATA_DIR=$DATA_DIR mount=yes writable=yes"
exec su-exec node "$@"
