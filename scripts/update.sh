#!/usr/bin/env bash
#
# ITACM — one-command update.
#
#   npm run update              # backup -> git pull -> rebuild with the right profile
#   npm run update -- --dry-run # just show what it would do
#
# Detects the compose profile from your .env (plain / tls / cloudflare) so you
# never have to remember which --profile or --build flags to pass. Migrations
# run automatically on start; your .env and certs/ are left untouched.
# (no `set -u`: an empty profile array must expand cleanly to no flags.)
set -o pipefail
cd "$(dirname "$0")/.."

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
red()  { printf '\033[31m%s\033[0m\n' "$1"; }
grn()  { printf '\033[32m%s\033[0m\n' "$1"; }
env_get() { [ -f .env ] && grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '\r'; }

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# --- Detect the compose profile from .env + cert files ---
APP_DOMAIN="$(env_get APP_DOMAIN)"
PROFILE_ARGS=()
MODE="local / plain HTTP"
if [ -n "$APP_DOMAIN" ]; then
  if [ -f certs/origin.pem ]; then
    PROFILE_ARGS=(--profile cloudflare); MODE="Cloudflare — ${APP_DOMAIN}"
  else
    PROFILE_ARGS=(--profile tls); MODE="own domain (Let's Encrypt) — ${APP_DOMAIN}"
  fi
fi

bold "ITACM update"
echo "  Detected mode: ${MODE}"
echo "  Will run:      docker compose ${PROFILE_ARGS[*]} up -d --build"
echo ""

if [ "$DRY" = "1" ]; then
  bold "Dry run — nothing changed."
  exit 0
fi

# --- 1) Backup (best-effort; a backup hiccup must not block the update) ---
bold "1/3  Backing up the database…"
if npm run --silent backup >/dev/null 2>&1; then
  grn "     ✔ backup saved under ./backups/"
else
  warn "     ⚠ backup skipped (is the db container running?) — continuing"
fi

# --- 2) Pull the latest code ---
bold "2/3  Pulling the latest code…"
if ! git pull --ff-only; then
  red "     ✖ git pull failed (local changes or a diverged branch)."
  red "       Fix it, then run 'npm run update' again. Nothing was rebuilt."
  exit 1
fi

# --- 3) Rebuild + restart with the detected profile ---
bold "3/3  Rebuilding and restarting…"
if ! docker compose "${PROFILE_ARGS[@]}" up -d --build; then
  red "     ✖ 'docker compose up' failed — check the output above."
  exit 1
fi

# --- Report the running version ---
echo ""
bold "Waiting for the API to come back…"
for _ in $(seq 1 30); do
  v="$(docker compose exec -T api wget -qO- http://localhost:8000/api/health 2>/dev/null | grep -oE '"version":"[^"]*"' | cut -d'"' -f4)"
  if [ -n "$v" ]; then grn "✔ Update complete — now running v${v}"; exit 0; fi
  sleep 2
done
warn "The API didn't report healthy in time. Check: docker compose logs api"
