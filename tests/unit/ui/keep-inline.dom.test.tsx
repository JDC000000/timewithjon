// FOC-06, the inline axis (fix/ui-keepvisible-inline): keepVisible brings a keyboard-focused control fully inside
// its nearest horizontal scroller (A2's filter row), inside its scroll-padding-inline, instantly. jsdom has no
// layout, so the boxes are stubbed; the key presses are real (user-event). Both engines: the lane's Playwright check.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard, keepVisible, moveFocus } from '@/ui/focus';

const LABELS = ['Needs a reply', 'Waiting on them', 'Stand-by', 'Locked in', 'Done', 'Cancelled'];
const TAB_W = 130;
const GAP = 8;
const ROW = { left: 0, width: 375, pad: 20 };

let uninstall: () => void = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  cleanup(); // unmount React roots first: a live root's scheduler would fire after jsdom teardown
  document.body.innerHTML = '';
});

function Row() {
  return (
    <div
      role="tablist"
      aria-label="Show"
      className="filters"
      // longhands: jsdom doesn't expand the scroll-padding-inline shorthand that site.css uses
      style={{ overflowX: 'auto', scrollPaddingLeft: `${ROW.pad}px`, scrollPaddingRight: `${ROW.pad}px` }}
      onKeyDown={(e) => {
        const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')];
        const to = e.key === 'End' ? tabs.at(-1) : e.key === 'Home' ? tabs[0] : null;
        if (to) moveFocus(to, 'keyboard');
      }}
    >
      {LABELS.map((l, i) => (
        <button
          key={l}
          type="button"
          role="tab"
          tabIndex={i === 0 ? 0 : -1}
          // as A2's FilterTabs: a click moves focus as 'pointer'
          onClick={(e) => moveFocus(e.currentTarget, 'pointer')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Lay the row out like a 375 px phone: tabs side by side, the row scrolled by scrollLeft. */
function layout(): { row: HTMLElement; scrollBy: ReturnType<typeof vi.fn> } {
  const row = screen.getByRole('tablist', { name: 'Show' });
  let scrollLeft = 0;
  const rect = (left: number, width: number) =>
    ({ left, right: left + width, width, top: 100, bottom: 144, height: 44, x: left, y: 100 }) as DOMRect;
  Object.defineProperty(row, 'scrollWidth', {
    value: ROW.pad * 2 + LABELS.length * (TAB_W + GAP),
    configurable: true,
  });
  Object.defineProperty(row, 'clientWidth', { value: ROW.width, configurable: true });
  row.getBoundingClientRect = () => rect(ROW.left, ROW.width);
  const scrollBy = vi.fn((o: ScrollToOptions) => {
    scrollLeft += o.left ?? 0;
  });
  row.scrollBy = scrollBy as unknown as HTMLElement['scrollBy'];
  screen.getAllByRole('tab').forEach((t, i) => {
    t.getBoundingClientRect = () => rect(ROW.pad + i * (TAB_W + GAP) - scrollLeft, TAB_W);
    t.getClientRects = () => [rect(0, TAB_W)] as unknown as DOMRectList;
  });
  return { row, scrollBy };
}

describe('keepVisible, inline axis (FOC-06)', () => {
  it('End brings the last tab fully in, inside the right scroll-padding; Home brings the first back', async () => {
    const user = userEvent.setup();
    render(<Row />);
    const { scrollBy } = layout();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Needs a reply' }));
    expect(scrollBy).not.toHaveBeenCalled(); // already in view: no scroll
    await user.keyboard('{End}');
    const last = screen.getByRole('tab', { name: 'Cancelled' });
    expect(document.activeElement).toBe(last);
    expect(scrollBy).toHaveBeenCalledWith({ left: expect.any(Number), behavior: 'instant' });
    const r = last.getBoundingClientRect();
    expect(r.right).toBe(ROW.width - ROW.pad); // exactly at the padding edge: nearest, not centred
    expect(r.left).toBeGreaterThanOrEqual(ROW.pad);
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Needs a reply' }).getBoundingClientRect().left).toBe(ROW.pad);
  });

  it('a control already fully inside the padding never scrolls the row', () => {
    render(<Row />);
    const { scrollBy } = layout();
    keepVisible(screen.getByRole('tab', { name: 'Waiting on them' })); // 158..288, inside 20..355
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('a control wider than the row aligns its start with the padding edge', () => {
    render(<Row />);
    const { scrollBy } = layout();
    const tab = screen.getByRole('tab', { name: 'Done' });
    tab.getBoundingClientRect = () =>
      ({ left: 600, right: 1000, width: 400, top: 100, bottom: 144, height: 44 }) as DOMRect;
    keepVisible(tab);
    expect(scrollBy).toHaveBeenCalledWith({ left: 600 - ROW.pad, behavior: 'instant' });
  });

  it('a row that does not overflow is not a scroller: nothing scrolls', () => {
    render(<Row />);
    const { row, scrollBy } = layout();
    Object.defineProperty(row, 'scrollWidth', { value: ROW.width, configurable: true });
    keepVisible(screen.getByRole('tab', { name: 'Cancelled' }));
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('pointer focus on a partly visible tab never scrolls the row (INT-07)', async () => {
    const user = userEvent.setup();
    render(<Row />);
    const { scrollBy } = layout();
    const last = screen.getByRole('tab', { name: 'Cancelled' });
    // partly past the right padding edge (355): 300..430
    last.getBoundingClientRect = () =>
      ({ left: 300, right: 430, width: 130, top: 100, bottom: 144, height: 44, x: 300, y: 100 }) as DOMRect;
    await user.click(last);
    expect(document.activeElement).toBe(last);
    expect(scrollBy).not.toHaveBeenCalled(); // the native focusin (pointer origin) and the click handler both skip
    act(() => moveFocus(last, 'pointer'));
    expect(scrollBy).not.toHaveBeenCalled();
    act(() => moveFocus(last, 'keyboard')); // the same tab by key IS brought in: the guard is pointer-only
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });
});
