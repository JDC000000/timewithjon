#!/usr/bin/env bash
# tests/lighthouse/run.sh — T4.6.04 (+T1.11.U3): Lighthouse mobile (the default preset: Moto G class device, slow 4G,
# simulated throttling) on /, /menu, /book/<dish> and After Send; performance and accessibility must both be 90 or
# more. CI only (.github/workflows/lighthouse.yml), after `pnpm db:test`. The prototype is built and started exactly
# as tests/e2e/run.sh does (placeholder env, stand-in admin auth, loopback), then prepare.ts sets up each page's
# state, each page is audited LH_RUNS times, and check.ts takes the median run and fails under 90.
set -euo pipefail
LIGHTHOUSE="lighthouse@13.5.0" # pinned: package.json / pnpm-lock.yaml are not this lane's (PR #107)
LH_RUNS="${LH_RUNS:-3}"
OUT="${LH_OUT:-test-results/lighthouse}" # git-ignored
export APP_MODE=prototype
export PORT="${LH_PORT:-3300}"
source scripts/ci-placeholder-env.sh
export FEATURE_ADMIN_AUTH=1
export SUPABASE_URL="http://127.0.0.1:${E2E_FAKE_AUTH_PORT:-54999}"
base="http://127.0.0.1:${PORT}"

find .next -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} + 2>/dev/null || true
pnpm build >/dev/null

pnpm start -H 127.0.0.1 -p "$PORT" >/dev/null &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
# Same readiness probe and 60 s limit as the Playwright webServer (playwright.config.ts).
timeout 60 bash -c "until curl -sf '$base/robots.txt' >/dev/null; do sleep 1; done"

rm -rf "$OUT" && mkdir -p "$OUT"
pnpm exec tsx tests/lighthouse/prepare.ts "$base" "$OUT/targets.tsv"

chrome="${CHROME_PATH:-$(command -v google-chrome || command -v chromium || true)}"
[[ -n "$chrome" ]] || { echo "run.sh: no Chrome on this runner" >&2; exit 2; }
export CHROME_PATH="$chrome"
i=0
while IFS=$'\t' read -r page url cookie; do
  headers=()
  [[ -n "$cookie" ]] && headers=(--extra-headers "$(jq -cn --arg c "$cookie" '{Cookie: $c}')")
  for run in $(seq 1 "$LH_RUNS"); do
    echo "lighthouse: $page run $run/$LH_RUNS"
    pnpm dlx "$LIGHTHOUSE" "$url" --quiet --output=json --output-path="$OUT/page-$i-run-$run.json" \
      --only-categories=performance,accessibility --chrome-flags="--headless=new --no-sandbox" "${headers[@]}"
  done
  i=$((i + 1))
done <"$OUT/targets.tsv"

pnpm exec tsx tests/lighthouse/check.ts "$OUT"
