#!/usr/bin/env bash
# tests/e2e/prove-red.sh [engine] [fault…] — T4.3.09: every case must be shown to fail when the behaviour it guards
# is broken. For each named fault (support/pack-faults.mjs; all by default) this runs its case (the fault's prefix,
# foc01 -> "FOC-01") on the pack with the fault injected, 1 run, on one engine (chromium by default; never both at
# once), and prints RED (≥1 test failed: good) or GREEN (the case missed its fault: bad). Exit 1 if any stays green.
# Needs E2E_PACK_DIR (the design pack's designs/ folder); run it from the repo root.
set -uo pipefail
engine="${1:-chromium}"
shift || true
faults=("$@")
if [[ ${#faults[@]} -eq 0 ]]; then
  mapfile -t faults < <(node -e "import('./tests/e2e/support/pack-faults.mjs').then(m=>console.log(Object.keys(m.PACK_FAULTS).join('\n')))")
fi
missed=0
for fault in "${faults[@]}"; do
  id=$(sed -E 's/^(foc|int)0?([0-9]+)-.*/\U\1\E-0\2/' <<<"$fault")
  out=$(E2E_TARGET=pack E2E_PROFILE=full E2E_PACK_FAULT="$fault" pnpm exec playwright test -g "$id " \
    --project="$engine-*" --repeat-each=1 --reporter=line 2>&1)
  failed=$(grep -oE '[0-9]+ failed' <<<"$out" | head -1 | cut -d' ' -f1)
  passed=$(grep -oE '[0-9]+ passed' <<<"$out" | head -1 | cut -d' ' -f1)
  if [[ "${failed:-0}" -gt 0 ]]; then verdict=RED; else verdict=GREEN; missed=1; fi
  printf '%-26s %-7s %-6s failed=%s passed=%s\n' "$fault" "$id" "$verdict" "${failed:-0}" "${passed:-0}"
  rm -rf test-results/e2e
done
exit "$missed"
