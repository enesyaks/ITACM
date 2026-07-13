#!/usr/bin/env bash
#
# ITACM — safely change the PostgreSQL password WITHOUT losing data.
#
#   npm run change-db-password        # or: bash scripts/change-db-password.sh
#
# The DB password is fixed inside the data volume when it is first created, so
# editing POSTGRES_PASSWORD in .env and restarting does NOT work — the API then
# fails to log in. This script does it the right way:
#   1. ALTER USER … PASSWORD inside the running database (keeps all data)
#   2. update POSTGRES_PASSWORD + DATABASE_URL in .env
#   3. restart the API so it picks up the new password
set -euo pipefail

cd "$(dirname "$0")/.."

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }

if [ ! -f .env ]; then red "No .env found. Run: npm run setup"; exit 1; fi
# Read keys from .env directly — never source it (it is compose-format, not shell).
env_get() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '\r'; }
POSTGRES_DB="$(env_get POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-itacm}"
POSTGRES_USER="$(env_get POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-itacm}"

if [ -z "$(docker compose ps -q db 2>/dev/null)" ]; then
  red "The 'db' container is not running. Start the stack first: docker compose up -d"
  exit 1
fi

printf 'New database password (leave EMPTY to auto-generate a strong one): '
read -rs NEWPW; echo
if [ -z "$NEWPW" ]; then
  NEWPW="$(node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))")"
  echo "  Generated a new password."
fi

# 1) change it inside the DB (local socket auth is trusted → no old password needed)
echo "  Updating password for role '${POSTGRES_USER}' in the database…"
PW_SQL="${NEWPW//\'/\'\'}" # escape single quotes for SQL
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -c "ALTER USER \"${POSTGRES_USER}\" WITH PASSWORD '${PW_SQL}';" >/dev/null

# 2) rewrite .env (node handles any special chars safely — no sed escaping)
echo "  Updating .env…"
NEWPW="$NEWPW" DBUSER="$POSTGRES_USER" DBNAME="$POSTGRES_DB" node -e '
  const fs = require("fs");
  const pw = process.env.NEWPW, u = process.env.DBUSER, d = process.env.DBNAME;
  let env = fs.readFileSync(".env", "utf8");
  env = env.replace(/^POSTGRES_PASSWORD=.*$/m, "POSTGRES_PASSWORD=" + pw);
  if (/^DATABASE_URL=/m.test(env)) {
    env = env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=postgres://${u}:${pw}@localhost:5432/${d}`);
  }
  fs.writeFileSync(".env", env, { mode: 0o600 });
'

# 3) restart the API with the new credentials
echo "  Restarting the API…"
docker compose up -d >/dev/null

green "✔ Database password changed — all data preserved."
echo  "  Verify:  docker compose logs api --tail 20   (should show 'listening')"
