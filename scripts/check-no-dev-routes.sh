#!/usr/bin/env bash
# scripts/check-no-dev-routes.sh — T0.4.05 / AD-13: production and staging builds must contain no /dev routes.
# For each mode: build, grep the server bundle, then start it and expect 404 from /dev/outbox.
set -euo pipefail
PORT="${PORT:-3197}"
port_busy() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1/"; }
for m in production staging; do
  # Something else on the port would answer the curl below and fake a pass (a shared dev host may run other projects).
  if port_busy "$PORT"; then echo "FAIL: port $PORT is already in use; set PORT" >&2; exit 1; fi
  # Fresh build output, but keep Turbopack's cache (.next/cache): it's keyed on the config, so a cache warmed
  # by another APP_MODE can't put /dev routes in this bundle (checked both ways when the CI cache was added).
  find .next -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} + 2>/dev/null || true
  APP_MODE="$m" pnpm build >/dev/null
  if grep -rqE "dev/(outbox|tick|state|login)" .next/server/app; then
    echo "FAIL: APP_MODE=$m bundle contains a /dev route" >&2
    exit 1
  fi
  # Boot validates the env (T0.1.11), so start with obviously fake placeholder values.
  # Own process group, so the cleanup kills next-server too (not just the pnpm wrapper).
  setsid bash -c 'export APP_MODE="$1" PORT="$2" && source scripts/ci-placeholder-env.sh && exec pnpm start -H 127.0.0.1 -p "$2"' _ "$m" "$PORT" >/dev/null 2>&1 &
  pid=$!
  trap 'kill -- -$pid 2>/dev/null || true' EXIT
  code=000
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/dev/outbox" || true)
    [[ "$code" != "000" ]] && break
    sleep 1
  done
  # pr76 F2: a guest booking page is never cached (GET and HEAD send no-store; a later revalidate/force-static
  # would otherwise cache it silently), and an unknown dish is a 404.
  book_get=$(curl -s -D - -o /dev/null "http://127.0.0.1:$PORT/book/the-long-lunch" || true)
  book_head=$(curl -s -I "http://127.0.0.1:$PORT/book/the-long-lunch" || true)
  nope=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/book/nope" || true)
  kill -- -"$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  trap - EXIT
  if [[ "$code" != "404" ]]; then
    echo "FAIL: APP_MODE=$m /dev/outbox returned $code (want 404)" >&2
    exit 1
  fi
  echo "ok: APP_MODE=$m has no /dev routes (404)"
  for r in "GET:$book_get" "HEAD:$book_head"; do
    if ! grep -qiE '^cache-control:.*no-store' <<<"${r#*:}"; then
      echo "FAIL: APP_MODE=$m ${r%%:*} /book/the-long-lunch has no Cache-Control no-store" >&2
      exit 1
    fi
  done
  if [[ "$nope" != "404" ]]; then
    echo "FAIL: APP_MODE=$m /book/nope returned $nope (want 404)" >&2
    exit 1
  fi
  echo "ok: APP_MODE=$m /book/the-long-lunch is no-store (GET + HEAD), /book/nope is 404"
done
