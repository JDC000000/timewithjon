// Layout probes read from the live page (never injected state).
import type { Page } from '@playwright/test';

/** How many CSS pixels the page scrolls sideways (0 = no horizontal scroll; INT-01 / INT-04). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}
