// Layout probes read from the live page (never injected state).
import { expect, test, type Page } from '@playwright/test';

/** How many CSS pixels the page scrolls sideways (0 = no horizontal scroll; INT-01 / INT-04). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}

/** The elements whose right edge is past the viewport (the widest first): what makes the page scroll sideways. */
export async function elementsPastViewport(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .map((e) => ({ e, right: e.getBoundingClientRect().right }))
      .filter(({ right }) => right > window.innerWidth + 0.5)
      .sort((a, b) => b.right - a.right)
      .slice(0, 10)
      .map(({ e, right }) => {
        const cls =
          typeof e.className === 'string' && e.className ? `.${e.className.split(' ').join('.')}` : '';
        return `${e.tagName.toLowerCase()}${cls} right=${Math.round(right)} "${(e.textContent ?? '').trim().slice(0, 40)}"`;
      }),
  );
}

/**
 * The page settles with no sideways scroll. Polled within the normal expect budget, because a page still laying out
 * on a busy WebKit run was once read mid-change (38 px on CI, 0 in its screenshot a moment later); a page that
 * really scrolls sideways stays over 0 and fails. On failure the elements past the viewport are attached, so the
 * red names its culprit.
 */
export async function expectNoSideScroll(page: Page, what: string): Promise<void> {
  try {
    await expect.poll(() => horizontalOverflow(page), { message: `${what}: px of sideways scroll` }).toBe(0);
  } catch (e) {
    await test.info().attach('elements past the viewport', {
      body: JSON.stringify(await elementsPastViewport(page).catch(() => []), null, 2),
      contentType: 'application/json',
    });
    throw e;
  }
}
