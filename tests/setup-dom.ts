// tests/setup-dom.ts — setup for the "dom" vitest project (*.dom.test.tsx, jsdom). F4 (pr94-review-r2):
// src/ui/focus.ts re-keeps a focused control after layout settles (a frame, then SETTLE_MS = 120 ms, on a Node timer).
// A focus near the end of a file left that timer pending; it fired after jsdom was torn down and threw
// "ReferenceError: document is not defined" (intermittent CI Unit failure, e.g. run 36374518871 from DateFlows).
// Let pending settle/pointer timers run while the jsdom globals still exist, before the environment closes.
import { afterAll, beforeEach, vi } from 'vitest';

// QA M3: the booking flows keep a draft in sessionStorage; every test starts from an empty tab.
beforeEach(() => {
  sessionStorage.clear();
});

/** One frame (~16 ms) + SETTLE_MS (120 ms) + margin for a loaded CI runner. */
export const DOM_SETTLE_WAIT_MS = 250;

afterAll(async () => {
  vi.useRealTimers(); // a file that left fake timers on would never resolve the wait below
  await new Promise<void>((resolve) => setTimeout(resolve, DOM_SETTLE_WAIT_MS));
});
