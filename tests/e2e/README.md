# E2E suite (T4.3)

Playwright, **Chromium and WebKit**, against a prototype build (`APP_MODE=prototype`, placeholder env, loopback
test DB, mocks for every external service).

```bash
pnpm db:test          # loopback Postgres 15 (scripts/test-db.sh)
pnpm test:e2e         # SMOKE: what CI runs (both engines, 375 + 1440, 100% text, 1 run)
pnpm test:e2e:full    # FULL: the T4.3.09 matrix (6 viewports x 3 text modes x 2 engines x 5 runs), local only
SKIP_BUILD=1 pnpm test:e2e --project='webkit-*'   # reuse the last build, one engine
```

## Rules (decision 29, `t4.3-carryover-focus-cases.md`)

- **Real input only**: `page.keyboard`, `page.mouse`, `locator.click()`/`tap()`. Never `element.focus()`,
  `scrollIntoView()` or injected state.
- **Selectors by role / accessible name only** (`getByRole`, `getByLabel`, `getByText`): no test ids, no classes.
- **Text size is set before load**: every project has a `textMode` (`t100`, `t200`, `sp125` = WCAG 1.4.12 + 125%),
  applied by `support/fixtures.ts` through `addInitScript`. Import `test`/`expect` from `./support/fixtures`.
- **A clean console**: any console error or uncaught page error fails the test (automatic `pageErrors` fixture,
  checked at the end of the test); only the harness's own bad-page probe opts out (`allowPageErrors`).
- Lane specs that size text themselves (`ui/`, `admin-season/`) run in the `t100` projects only.
- **No retries.** A flaky pass is a fail: find the cause and name the owner lane.
- A case for a screen that isn't on main yet stays `test.fixme` with the owner lane in its title.

## Local set-up without root

Local runs must set `PLAYWRIGHT_BROWSERS_PATH` (the vendored 1.61.1 builds): the local config never downloads
browsers, so Playwright errors without it.

`E2E_WK_LIBS=<dir>` points WebKit at system libraries unpacked without root (see `support/local-webkit.ts`);
`PLAYWRIGHT_BROWSERS_PATH` points at already-downloaded browsers (the pinned `@playwright/test` version must match
them). `E2E_DATABASE_URL` and `E2E_PORT` override the DB and port; `E2E_BASE_URL` targets a server that is already
running. CI installs browsers with `playwright install --with-deps`.

## T4.3.09: the keyboard + focus suite (`focus/`, `interaction/`)

One spec per carry-over case (`t4.3-carryover-focus-cases.md`): `focus/foc-01…06`, `interaction/int-01…09`. Each
file runs on the part of the matrix its case names (`support/scope.ts`; the other projects skip it before a page
opens). Shared real-input helpers live in `support/`: `input.ts` (keys, human-speed clicks, wheel scrolling that
waits for smooth scroll to stop), `focus-probe.ts` (where focus is, in view / covered, full Tab walks), `flows.ts`
(send a request, lock in, Back), `layout.ts` + `layout-probes.ts` (sideways scroll, row re-layout, tick gap, split
dates, covered controls).

- **Route map** (`support/screens.ts`): each screen's pack file and real route. A screen whose route isn't on main
  has `app: null` and its cases are `test.fixme` naming the owner lane; set `app` when that lane's PR merges.
- **Against the design pack** (local only, the pack is not in the repo):
  `E2E_TARGET=pack E2E_PACK_DIR=<designs/> tests/e2e/run.sh full tests/e2e/focus tests/e2e/interaction --project='chromium-*'`
- **Every case can fail**: `support/pack-faults.mjs` holds one named fault per case (the prefix names it: `foc01-…`
  = FOC-01) that breaks exactly what the case guards. `tests/e2e/prove-red.sh [engine] [fault…]` runs each case with
  its fault injected and prints RED (good) or GREEN (the case missed its fault; exit 1).
- The full matrix is heavy (5 runs × 18 projects × both engines): run it for a focus PR and on request, one engine
  at a time (`--project='chromium-*'`, then `--project='webkit-*'`), at most 2 workers.

### What CI covers (smoke) vs the local matrix

CI runs the smoke profile only (375x812 + 1440x900, 100 % text, both engines, 1 run). Of T4.3.09 that is FOC-04,
FOC-06, INT-01, INT-02, INT-05, INT-06 and INT-07 (plus `probes.spec.ts`). **CI runs 0 tests** of FOC-01/02/03/05
and INT-03/04/08/09: they are scoped to other widths / text modes, or fixme until their screens land. The 200 %,
1.4.12 + 125 % and short-phone paths, and every 5-run verdict, are local-only gates: `pnpm test:e2e:full`, one
engine at a time.
