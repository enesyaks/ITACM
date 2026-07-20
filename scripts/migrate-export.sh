#!/usr/bin/env bash
#
# ITACM — full system migration EXPORT (database + uploaded documents).
#
#   npm run migrate:export
#   npm run migrate:export -- /path/to/out-dir
#
# Produces a folder:
#   itacm-migrate-YYYYMMDD-HHMMSS/
#     MANIFEST.json
#     db/itacm.sql.gz
#     files/documents.tar.gz
#     README.txt
#
# Copy JWT_SECRET from .env to the target host separately (needed for SMTP decrypt).
#
# Called from: package.json "migrate:export"; optionally documented in README.
# Related but different: scripts/backup.sh (DB-only, no documents package).
set -euo pipefail

cd "$(dirname "$0")/.."

env_get() { [ -f .env ] && grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '\r'; }
POSTGRES_DB="$(env_get POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-itacm}"
POSTGRES_USER="$(env_get POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-itacm}"
COMPOSE_PROJECT="$(docker compose config --format json 2>/dev/null | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-itacm}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }

if ! docker compose ps db --status running >/dev/null 2>&1 \
   || [ -z "$(docker compose ps -q db 2>/dev/null)" ]; then
  red "The 'db' container is not running. Start the stack first: docker compose up -d"
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_ROOT="${1:-migrations}"
mkdir -p "${OUT_ROOT}"
PKG_DIR="${OUT_ROOT}/itacm-migrate-${STAMP}"
mkdir -p "${PKG_DIR}/db" "${PKG_DIR}/files"

echo "  Exporting database '${POSTGRES_DB}'…"
docker compose exec -T db pg_dump --clean --if-exists -U "${POSTGRES_USER}" "${POSTGRES_DB}" \
  | gzip > "${PKG_DIR}/db/itacm.sql.gz"

echo "  Exporting uploaded documents (app-data)…"
VOL_NAME="${COMPOSE_PROJECT}_app-data"
if ! docker volume inspect "${VOL_NAME}" >/dev/null 2>&1; then
  VOL_NAME="itacm_app-data"
fi
if docker volume inspect "${VOL_NAME}" >/dev/null 2>&1; then
  docker run --rm \
    -v "${VOL_NAME}:/data:ro" \
    -v "$(cd "${PKG_DIR}/files" && pwd):/out" \
    alpine:3.20 \
    sh -c 'if [ -d /data/documents ]; then tar czf /out/documents.tar.gz -C /data documents; else mkdir -p /tmp/empty/documents && tar czf /out/documents.tar.gz -C /tmp/empty documents; fi'
else
  yellow "⚠ Volume ${VOL_NAME} not found — packing empty documents archive."
  mkdir -p "${PKG_DIR}/files/_empty/documents"
  tar czf "${PKG_DIR}/files/documents.tar.gz" -C "${PKG_DIR}/files/_empty" documents
  rm -rf "${PKG_DIR}/files/_empty"
fi

DB_BYTES=$(wc -c < "${PKG_DIR}/db/itacm.sql.gz" | tr -d ' ')
DOC_BYTES=$(wc -c < "${PKG_DIR}/files/documents.tar.gz" | tr -d ' ')
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

cat > "${PKG_DIR}/MANIFEST.json" <<EOF
{
  "format": "itacm-migrate-v1",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gitSha": "${GIT_SHA}",
  "database": "${POSTGRES_DB}",
  "dbBytes": ${DB_BYTES},
  "documentsBytes": ${DOC_BYTES},
  "jwtSecretRequired": true,
  "notes": "Restore with npm run migrate:import. Copy JWT_SECRET from source .env to target before or after import so SMTP passwords decrypt."
}
EOF

cat > "${PKG_DIR}/README.txt" <<EOF
ITACM migration package (${STAMP})

Contents
  db/itacm.sql.gz           Full PostgreSQL dump (settings, users, assets, SMTP, templates, …)
  files/documents.tar.gz    Uploaded PDFs/images under /app/data/documents
  MANIFEST.json             Metadata

Target host
  1. Install same ITACM version; copy JWT_SECRET from source .env into target .env
  2. docker compose up -d
  3. npm run migrate:import ${PKG_DIR}
     (or choose "Migrate from another server" on first-open screen)

Do NOT use Hardware → Excel import for full system moves.
EOF

if command -v zip >/dev/null 2>&1; then
  (
    cd "${OUT_ROOT}"
    zip -qr "itacm-migrate-${STAMP}.zip" "itacm-migrate-${STAMP}"
  )
  green "✔ Export complete: ${PKG_DIR}"
  green "  Also zipped: ${OUT_ROOT}/itacm-migrate-${STAMP}.zip"
else
  green "✔ Export complete: ${PKG_DIR}"
  yellow "  (install 'zip' to also get a single .zip file)"
fi

yellow "⚠ Copy JWT_SECRET from .env to the new server — required for SMTP password decrypt."
echo "  Import:  npm run migrate:import ${PKG_DIR}"
