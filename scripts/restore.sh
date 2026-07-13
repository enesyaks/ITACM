#!/usr/bin/env bash
#
# ITACM — database restore.
#
#   npm run restore backups/itacm-YYYYMMDD-HHMMSS.sql.gz
#
# Replaces the CURRENT database contents with the given backup. This overwrites
# live data, so it asks for explicit confirmation. Take a fresh backup first if
# you're unsure: npm run backup
set -euo pipefail

cd "$(dirname "$0")/.."

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }

FILE="${1:-}"
if [ -z "$FILE" ]; then
  red "Usage: npm run restore <backup-file.sql.gz>"
  echo  "Available backups:" >&2
  ls -1 backups/*.sql.gz 2>/dev/null >&2 || echo "  (none in ./backups)" >&2
  exit 1
fi
if [ ! -f "$FILE" ]; then
  red "Backup file not found: $FILE"
  exit 1
fi

# Read keys from .env directly — never source it (it is compose-format, not shell).
env_get() { [ -f .env ] && grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '\r'; }
POSTGRES_DB="$(env_get POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-itacm}"
POSTGRES_USER="$(env_get POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-itacm}"

if [ -z "$(docker compose ps -q db 2>/dev/null)" ]; then
  red "The 'db' container is not running. Start the stack first: docker compose up -d"
  exit 1
fi

printf '\033[31m⚠ This REPLACES all current data in database "%s" with:\033[0m\n' "$POSTGRES_DB"
echo  "    $FILE"
printf 'Type "yes" to continue: '
read -r CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted — nothing changed."
  exit 0
fi

echo "  Restoring ${FILE} → database '${POSTGRES_DB}'…"
# ON_ERROR_STOP so a broken dump fails loudly instead of half-applying.
gunzip -c "$FILE" | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

green "✔ Restore complete."
echo  "  Restart the API to be safe:  docker compose restart api"
