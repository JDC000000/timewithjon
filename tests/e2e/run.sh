#!/usr/bin/env bash
# tests/e2e/run.sh smoke|full [playwright args…] — T4.3.01: build the prototype (placeholder env, loopback test DB:
# `pnpm db:test` first) and run the Playwright suite against it. smoke = what CI runs; full = the local T4.3.09 matrix.
# SKIP_BUILD=1 reuses the last build. Local overrides: E2E_DATABASE_URL, E2E_PORT, E2E_WK_LIBS (tests/e2e/README.md).
set -euo pipefail
profile="${1:-smoke}"
shift || true
export APP_MODE=prototype
# The app's site URL must be the origin the browser uses, or same-origin writes (admin actions) answer 403.
export PORT="${E2E_PORT:-3300}"
source scripts/ci-placeholder-env.sh
# Admin screens sign in to the stand-in Supabase Auth that the suite starts (tests/e2e/support/sessions.ts).
export FEATURE_ADMIN_AUTH=1
# The e2e server runs parallel workers against one loopback DB: a larger pool than production's 3 (src/lib/db-config.ts).
export DB_POOL_MAX="${DB_POOL_MAX:-10}"
export SUPABASE_URL="http://127.0.0.1:${E2E_FAKE_AUTH_PORT:-54999}"
if [[ -n "${E2E_DATABASE_URL:-}" ]]; then
  # The suite writes to its database (global-setup opens booking): loopback test DBs only.
  if [[ ! "$E2E_DATABASE_URL" =~ @(127\.0\.0\.1|localhost)(:[0-9]+)?/ ]]; then
    echo "run.sh: E2E_DATABASE_URL must point at a loopback test DB" >&2
    exit 2
  fi
  export DATABASE_URL="$E2E_DATABASE_URL"
fi
if [[ "${SKIP_BUILD:-}" != "1" && "${E2E_TARGET:-app}" != "pack" ]]; then
  # Fresh build output; keep Turbopack's cache (.next/cache), which CI restores between runs.
  find .next -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} + 2>/dev/null || true
  pnpm build >/dev/null
fi
E2E_PROFILE="$profile" exec pnpm exec playwright test "$@"
