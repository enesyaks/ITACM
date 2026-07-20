#!/usr/bin/env bash
#
# ITACM — full system migration IMPORT (database + uploaded documents).
#
#   npm run migrate:import migrations/itacm-migrate-YYYYMMDD-HHMMSS
#   npm run migrate:import path/to/itacm-migrate-….zip
#   npm run migrate:import … --yes
#
# Called from: package.json "migrate:import"; scripts/setup.js (migrate path).
# Related but different: scripts/restore.sh (DB-only).
#
# Package layout (itacm-migrate-v1):
#   MANIFEST.json { format, createdAt ISO8601 UTC, gitSha, database, dbBytes, documentsBytes, jwtSecretRequired }
#   db/itacm.sql.gz
#   files/documents.tar.gz
set -euo pipefail

cd "$(dirname "$0")/.."

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }

SRC=""
YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    *) SRC="$arg" ;;
  esac
done

if [ -z "$SRC" ]; then
  red "Usage: npm run migrate:import <package-dir-or-zip> [--yes]"
  exit 1
fi

env_get() { [ -f .env ] && grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '\r'; }
POSTGRES_DB="$(env_get POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-itacm}"
POSTGRES_USER="$(env_get POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-itacm}"
API_PORT="$(env_get API_PORT)"; API_PORT="${API_PORT:-8000}"
COMPOSE_PROJECT="$(docker compose config --format json 2>/dev/null | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-itacm}"
VOL_NAME="${COMPOSE_PROJECT}_app-data"
docker volume inspect "${VOL_NAME}" >/dev/null 2>&1 || VOL_NAME="itacm_app-data"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/itacm-migrate-XXXXXX")"
cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

# Reject zip-slip style members (absolute paths, .. components) before extract.
assert_safe_members() {
  while IFS= read -r member; do
    [ -z "$member" ] && continue
    case "$member" in
      /*)
        red "Unsafe archive member (absolute path): $member"
        exit 1
        ;;
    esac
    if printf '%s' "$member" | grep -qE '(^|/)\.\.(/|$)'; then
      red "Unsafe archive member (path traversal): $member"
      exit 1
    fi
  done
}

PKG=""
if [ -d "$SRC" ]; then
  PKG="$SRC"
elif [ -f "$SRC" ]; then
  case "$SRC" in
    *.zip)
      command -v unzip >/dev/null 2>&1 || { red "unzip is required for .zip packages"; exit 1; }
      unzip -Z1 "$SRC" | assert_safe_members
      unzip -q "$SRC" -d "${WORKDIR}/unz"
      PKG="$(find "${WORKDIR}/unz" -maxdepth 2 -type d -name 'itacm-migrate-*' | head -1)"
      [ -n "$PKG" ] || PKG="$(find "${WORKDIR}/unz" -maxdepth 1 -mindepth 1 -type d | head -1)"
      ;;
    *.tar.gz|*.tgz)
      mkdir -p "${WORKDIR}/unz"
      tar tzf "$SRC" | assert_safe_members
      tar xzf "$SRC" -C "${WORKDIR}/unz"
      PKG="$(find "${WORKDIR}/unz" -maxdepth 2 -type d -name 'itacm-migrate-*' | head -1)"
      [ -n "$PKG" ] || PKG="${WORKDIR}/unz"
      ;;
    *)
      red "Unsupported package file (use a migrate folder, .zip, or .tar.gz): $SRC"
      exit 1
      ;;
  esac
else
  red "Package not found: $SRC"
  exit 1
fi

SQL="${PKG}/db/itacm.sql.gz"
DOCS="${PKG}/files/documents.tar.gz"
if [ ! -f "$SQL" ]; then
  red "Missing ${SQL} — not a valid itacm-migrate package"
  exit 1
fi

if [ -z "$(docker compose ps -q db 2>/dev/null)" ]; then
  red "The 'db' container is not running. Start: docker compose up -d"
  exit 1
fi

if [ "$YES" -ne 1 ]; then
  printf '\033[31m⚠ This REPLACES all data in "%s" and uploaded documents.\033[0m\n' "$POSTGRES_DB"
  echo  "    Package: $PKG"
  printf 'Type "yes" to continue: '
  read -r CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted — nothing changed."
    exit 0
  fi
fi

echo "  Stopping API (briefly)…"
docker compose stop api >/dev/null 2>&1 || true

echo "  Restoring database…"
gunzip -c "$SQL" | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

if [ -f "$DOCS" ]; then
  tar tzf "$DOCS" | assert_safe_members
  # members must stay under documents/
  bad_docs="$(tar tzf "$DOCS" | grep -vE '^$|^documents(/|$)' || true)"
  if [ -n "$bad_docs" ]; then
    red "documents.tar.gz must only contain paths under documents/"
    exit 1
  fi
  echo "  Restoring documents into volume ${VOL_NAME}…"
  if docker volume inspect "${VOL_NAME}" >/dev/null 2>&1; then
    docker run --rm \
      -v "${VOL_NAME}:/data" \
      -v "$(cd "$(dirname "$DOCS")" && pwd):/pkg:ro" \
      alpine:3.20 \
      sh -c 'rm -rf /data/documents && mkdir -p /data && tar xzf /pkg/documents.tar.gz -C /data && chmod -R a+rwX /data/documents 2>/dev/null || true'
  else
    yellow "⚠ Volume ${VOL_NAME} missing — start the stack once so app-data exists, then re-run import for files."
  fi
else
  yellow "⚠ No documents.tar.gz in package — DB restored only."
fi

echo "  Starting API…"
docker compose up -d api >/dev/null

green "✔ Migration import complete."
yellow "⚠ Ensure target .env JWT_SECRET matches the source (SMTP decrypt). Then sign in with a restored Owner account."
echo "  open http://localhost:${API_PORT}"
