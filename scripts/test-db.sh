#!/usr/bin/env bash
# scripts/test-db.sh — disposable Postgres 15 for integration tests, bound to LOOPBACK ONLY (never 0.0.0.0).
# Usage: scripts/test-db.sh up | down.   Then: DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/postgres
set -euo pipefail
NAME=twj-test-db
if [[ "${1:-up}" == "down" ]]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; exit 0; fi
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:15-alpine >/dev/null
for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
docker exec "$NAME" psql -U postgres -qc "create role anon; create role authenticated; create schema extensions;"
for f in supabase/migrations/*.sql supabase/seed.sql; do
  grep -v 'TWJ:SUPABASE-ONLY' "$f" | docker exec -i "$NAME" psql -U postgres -q -v ON_ERROR_STOP=1 >/dev/null
done
echo "test db ready on 127.0.0.1:55432"
