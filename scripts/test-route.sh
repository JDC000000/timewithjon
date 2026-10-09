#!/usr/bin/env bash
# scripts/test-route.sh — T1.7.11: build the prototype, start it on 127.0.0.1 against the loopback test DB
# (pnpm db:test first), run tests/route/*, stop the server. Placeholder env only (scripts/ci-placeholder-env.sh).
set -euo pipefail
export PORT="${PORT:-3200}" APP_MODE=prototype
# An exported DATABASE_URL wins (a lane's own test DB); the placeholder :55432 is only the default when unset.
# Loopback only: route tests write rows, so a non-local URL is refused (scripts/loopback-db-url.sh).
own_db="${DATABASE_URL:-}"
source scripts/ci-placeholder-env.sh
source scripts/loopback-db-url.sh
if [[ -n "$own_db" ]]; then
  if ! is_loopback_db_url "$own_db"; then
    echo "FAIL: DATABASE_URL must be postgres://user:pass@127.0.0.1|localhost:PORT/DB (loopback, no ?query or #)" >&2
    exit 1
  fi
  export DATABASE_URL="$own_db"
fi
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/"; then
  echo "FAIL: port $PORT is already in use; set PORT" >&2
  exit 1
fi
# Fresh build output; keep Turbopack's cache (.next/cache), which CI restores between runs.
[[ "${SKIP_BUILD:-}" == "1" ]] || { find .next -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} + 2>/dev/null || true; pnpm build >/dev/null; }
# Own process group, so the cleanup kills next-server too (killing only the pnpm wrapper leaves it running).
# --keepAliveTimeout 70000: as playwright.config.ts (the ?for= rewrite's proxy hop and Node's 5 s keep-alive race).
setsid pnpm start -H 127.0.0.1 -p "$PORT" --keepAliveTimeout 70000 >.next/route-server.log 2>&1 &
pid=$!
trap 'kill -- -$pid 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/robots.txt" && break; sleep 1; done
if ! curl -sf -o /dev/null "http://127.0.0.1:$PORT/robots.txt"; then
  echo "FAIL: the prototype server didn't boot on :$PORT; last log lines:" >&2
  tail -50 .next/route-server.log >&2
  exit 1
fi
ROUTE_BASE_URL="http://127.0.0.1:$PORT" pnpm vitest run -c vitest.route.config.ts
