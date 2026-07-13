#!/usr/bin/env bash
#
# ITACM — database backup.
#
#   npm run backup            # or: bash scripts/backup.sh
#
# Dumps the entire PostgreSQL database (which includes the document archive —
# scanned/generated PDFs are stored inside the DB) to a single gzipped SQL file
# under ./backups/. Restore any of them with `npm run restore <file>`.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- read specific keys from .env (do NOT source it — .env is compose-format,
#     not shell-safe: e.g. `ADMIN_USERNAME=IT Admin` would run as a command) ---
env_get() { [ -f .env ] && grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '\r'; }
POSTGRES_DB="$(env_get POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-itacm}"
POSTGRES_USER="$(env_get POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-itacm}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }

# --- the db container must be running ----------------------------------------
if ! docker compose ps db --status running >/dev/null 2>&1 \
   || [ -z "$(docker compose ps -q db 2>/dev/null)" ]; then
  red "The 'db' container is not running. Start the stack first: docker compose up -d"
  exit 1
fi

mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/itacm-${STAMP}.sql.gz"

echo "  Backing up database '${POSTGRES_DB}' → ${OUT}"
# --clean --if-exists makes the dump drop-and-recreate objects, so a restore
# cleanly replaces current data instead of colliding with it.
docker compose exec -T db pg_dump --clean --if-exists -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${OUT}"

SIZE="$(du -h "${OUT}" | cut -f1)"
green "✔ Backup complete: ${OUT} (${SIZE})"
echo "  Restore with:  npm run restore ${OUT}"
