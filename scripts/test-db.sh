#!/usr/bin/env bash
#
# Integration tests against a REAL PostgreSQL.
#
# Starts a throwaway postgres container on a spare port, runs tests/db against
# it, then removes it. Your own stack and its data are never touched — the
# container is fresh, unnamed in compose, and deleted on exit.
#
#   npm run test:db
#
# In CI, provide the database yourself and skip this script:
#   TEST_DATABASE_URL=postgres://... node --test tests/db/*.test.js
set -euo pipefail

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  echo "[test:db] using TEST_DATABASE_URL from the environment"
  exec node --test tests/db/*.test.js
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[test:db] docker not found — set TEST_DATABASE_URL to a Postgres you control instead." >&2
  exit 1
fi

PORT="${TEST_DB_PORT:-55432}"
NAME="itacm-test-db-$$"
PASSWORD="itacm_test_$RANDOM"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "[test:db] starting throwaway postgres on 127.0.0.1:$PORT ..."
# Bound to loopback only, tmpfs data dir (nothing survives, nothing to clean up).
docker run -d --rm --name "$NAME" \
  -p "127.0.0.1:$PORT:5432" \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  -e POSTGRES_USER=itacm_test \
  -e POSTGRES_DB=postgres \
  --tmpfs /var/lib/postgresql/data \
  postgres:16-alpine >/dev/null

echo -n "[test:db] waiting for it to accept connections"
for i in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U itacm_test -d postgres >/dev/null 2>&1; then
    echo " — ready"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo " — TIMEOUT" >&2
    docker logs "$NAME" >&2 || true
    exit 1
  fi
  echo -n "."
  sleep 1
done

export TEST_DATABASE_URL="postgres://itacm_test:${PASSWORD}@127.0.0.1:${PORT}/postgres"
node --test tests/db/*.test.js
