// tests/unit/ui/focus.dom.test.tsx (U1): the parts of src/ui/focus.ts that need no layout, driven by user-event
// (real event sequences; never element.focus()). Layout rules (keepVisible, the bar lift, holdStill) are covered in
// both engines by tests/e2e/ui/focus.spec.ts.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  announce,
  focusOrigin,
  holdStill,
  installFocusGuard,
  keepVisible,
  moveFocus,
  onTextSize,
  resizeMayKeep,
  TEXT_SIZE_EVENT,
  useInView,
  useReturnFocus,
  whenFree,
} from '@/ui/focus';

let uninstall: () => void = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  cleanup();
  uninstall();
  document.body.innerHTML = '';
});

function Panel() {
  const [open, setOpen] = useState(false);
  useReturnFocus(open);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Other</button>
      {open && (
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      )}
    </>
  );
}

describe('useReturnFocus', () => {
  it('returns focus to the invoker when the panel closes', async () => {
    const user = userEvent.setup();
    render(<Panel />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });

  it('keyboard: Enter opens, Enter on Close returns to the opener', async () => {
    const user = userEvent.setup();
    render(<Panel />);
    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });
});

describe('focus origin', () => {
  it('pointer for a click, key for Tab, script for moveFocus, pointer for moveFocus(…, "pointer")', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">A</button>
        <button type="button">B</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'A' }));
    expect(focusOrigin()).toBe('pointer');
    await user.tab();
    expect(focusOrigin()).toBe('key');
    act(() => moveFocus(screen.getByRole('button', { name: 'A' })));
    // a key was pressed under 700 ms ago, so this still reads as keyboard focus (the pack's rule)
    expect(['key', 'script']).toContain(focusOrigin());
    act(() => moveFocus(screen.getByRole('button', { name: 'B' }), 'pointer'));
    expect(focusOrigin()).toBe('pointer');
    expect(resizeMayKeep(document.activeElement)).toBe(false);
  });

  it('script focus long after any input reads as script; resizeMayKeep is false while it is on screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<button type="button">Solo</button>);
    vi.advanceTimersByTime(2000);
    act(() => moveFocus(screen.getByRole('button', { name: 'Solo' })));
    expect(focusOrigin()).toBe('script');
    // jsdom has no layout: the box is 0,0,0,0, i.e. not "on screen" by the rule (bottom > 0 fails) -> may keep
    expect(resizeMayKeep(document.activeElement)).toBe(true);
    expect(resizeMayKeep(document.body)).toBe(false);
    expect(resizeMayKeep(null)).toBe(false);
    vi.useRealTimers();
  });
});

describe('byPointer', () => {
  it('a press on a label (for=) counts as pointer focus for its control', async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="n">Name</label>
        <input id="n" />
      </>,
    );
    await user.click(screen.getByText('Name'));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
    expect(focusOrigin()).toBe('pointer');
  });
});

describe('whenFree (INT-06)', () => {
  it('runs at once with no pointer down, after release while pressed, and only once per fn', async () => {
    const user = userEvent.setup();
    render(<button type="button">Chip</button>);
    const chip = screen.getByRole('button', { name: 'Chip' });
    const now = vi.fn();
    whenFree(now);
    expect(now).toHaveBeenCalledTimes(1);
    const later = vi.fn();
    await user.pointer({ keys: '[MouseLeft>]', target: chip });
    whenFree(later);
    whenFree(later);
    expect(later).not.toHaveBeenCalled();
    await user.pointer({ keys: '[/MouseLeft]', target: chip });
    await act(() => new Promise((r) => setTimeout(r, 5)));
    expect(later).toHaveBeenCalledTimes(1);
  });
});

describe('announce', () => {
  it('writes to #live and alternates a no-break space for a repeat', () => {
    render(<div id="live" />);
    const live = document.getElementById('live')!;
    announce('Saved.');
    expect(live.textContent).toBe('Saved.');
    announce('Saved.');
    expect(live.textContent).toBe('Saved. ');
    announce('Saved.');
    expect(live.textContent).toBe('Saved.');
    announce('Copied.');
    expect(live.textContent).toBe('Copied.');
  });
});

describe('onTextSize', () => {
  it('subscribes and unsubscribes', () => {
    const fn = vi.fn();
    const off = onTextSize(fn);
    document.dispatchEvent(new Event(TEXT_SIZE_EVENT));
    off();
    document.dispatchEvent(new Event(TEXT_SIZE_EVENT));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('keepVisible: the whole-pixel nudge (FOC-04, lane U6)', () => {
  /** An element whose box moves with window.scrollBy, after a scrollIntoView that leaves it where it was. */
  function box(top: number, height: number) {
    const el = document.createElement('p');
    document.body.appendChild(el);
    let t = top;
    el.getBoundingClientRect = () =>
      ({ top: t, bottom: t + height, left: 0, right: 10, width: 10, height }) as DOMRect;
    el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList;
    el.scrollIntoView = () => {};
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation((o) => {
      t -= (o as ScrollToOptions).top ?? 0;
    });
    return { el, scrollBy };
  }
  afterEach(() => vi.restoreAllMocks());

  it('a bottom edge a hair below the viewport is nudged 1 px up', () => {
    const { el, scrollBy } = box(window.innerHeight - 40 + 0.3, 40); // bottom = innerHeight + 0.3
    keepVisible(el);
    expect(scrollBy).toHaveBeenCalledWith({ top: 1, behavior: 'instant' });
    expect(el.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
  });
  it('a top edge a hair above it is nudged 1 px down', () => {
    const { el, scrollBy } = box(-0.4, 40);
    keepVisible(el);
    expect(scrollBy).toHaveBeenCalledWith({ top: -1, behavior: 'instant' });
    expect(el.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  });
  it('no room for the nudge (the other edge would leave): left alone, both ways (pr82-review F1)', () => {
    const low = box(0.5, window.innerHeight - 0.2); // bottom = innerHeight + 0.3, but top - 1 < 0
    keepVisible(low.el);
    expect(low.scrollBy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    const high = box(-0.3, window.innerHeight - 0.2); // top < 0, but bottom + 1 > innerHeight
    keepVisible(high.el);
    expect(high.scrollBy).not.toHaveBeenCalled();
  });

  /** A nested y-scroller (rect 100..500) holding el; scrollBy moves el unless the scroller is at its end. */
  function nested(elTop: number, atEnd: boolean) {
    const sc = document.createElement('div');
    sc.style.overflowY = 'auto';
    Object.defineProperty(sc, 'scrollHeight', { value: 2000 });
    Object.defineProperty(sc, 'clientHeight', { value: 400 });
    sc.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 300, height: 400 }) as DOMRect;
    const el = document.createElement('p');
    sc.appendChild(el);
    document.body.appendChild(sc);
    let t = elTop;
    el.getBoundingClientRect = () =>
      ({ top: t, bottom: t + 40, left: 0, right: 10, width: 10, height: 40 }) as DOMRect;
    el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList;
    el.scrollIntoView = () => {};
    const inner = vi.fn((o: ScrollToOptions) => {
      if (atEnd) return;
      t -= o.top ?? 0;
      sc.scrollTop += o.top ?? 0;
    });
    sc.scrollBy = inner as unknown as typeof sc.scrollBy;
    const page = vi.spyOn(window, 'scrollBy').mockImplementation((o) => {
      t -= (o as ScrollToOptions).top ?? 0;
    });
    return { el, inner, page };
  }

  it('inside a scroller: the scroller is nudged, not the page (pr82-review F1)', () => {
    const { el, inner, page } = nested(460.3, false); // bottom 500.3 of the scroller's 500
    keepVisible(el);
    expect(inner).toHaveBeenCalledWith({ top: 1, behavior: 'instant' });
    expect(page).not.toHaveBeenCalled();
    expect(el.getBoundingClientRect().bottom).toBeLessThanOrEqual(500);
  });

  it('a scroller already at its end: the page takes the nudge (pr82-review F2)', () => {
    const { el, inner, page } = nested(460.3, true);
    keepVisible(el);
    expect(inner).toHaveBeenCalledWith({ top: 1, behavior: 'instant' });
    expect(page).toHaveBeenCalledWith({ top: 1, behavior: 'instant' });
  });

  it('the inline axis rounds a fractional overflow to whole pixels (pr82-review F3)', () => {
    const row = document.createElement('div');
    row.style.overflowX = 'auto';
    Object.defineProperty(row, 'scrollWidth', { value: 900 });
    Object.defineProperty(row, 'clientWidth', { value: 300 });
    row.getBoundingClientRect = () => ({ top: 100, bottom: 150, left: 0, right: 300, width: 300 }) as DOMRect;
    const el = document.createElement('button');
    row.appendChild(el);
    document.body.appendChild(row);
    el.getBoundingClientRect = () =>
      ({ top: 100, bottom: 140, left: 250.3, right: 300.3, width: 50, height: 40 }) as DOMRect;
    el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList;
    const inline = vi.fn();
    row.scrollBy = inline as unknown as typeof row.scrollBy;
    keepVisible(el);
    expect(inline).toHaveBeenCalledWith({ left: 1, behavior: 'instant' });
  });

  it('fully in view, or with no room for the nudge: left alone', () => {
    const inView = box(100, 40);
    keepVisible(inView.el);
    expect(inView.scrollBy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    const tall = box(-0.4, window.innerHeight + 0.2); // taller than the viewport: never scrolled by the nudge
    keepVisible(tall.el);
    expect(tall.scrollBy).not.toHaveBeenCalled();
  });
});

describe('holdStill', () => {
  it('runs fn even with no element', () => {
    const fn = vi.fn();
    holdStill(null, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('scrolls by the element shift', () => {
    const el = document.createElement('p');
    document.body.appendChild(el);
    let top = 300;
    el.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 10 }) as DOMRect;
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    holdStill(el, () => (top = 180));
    expect(scrollBy).toHaveBeenCalledWith({ top: -120, behavior: 'instant' });
    scrollBy.mockClear();
    holdStill(el, () => (top = 180.5));
    expect(scrollBy).not.toHaveBeenCalled();
    scrollBy.mockRestore();
  });
});

function Seen() {
  const boxRef = useRef<HTMLDivElement>(null);
  const seen = useInView(boxRef);
  return <div ref={boxRef}>{seen ? 'seen' : 'unseen'}</div>;
}

describe('useInView', () => {
  it('counts as in view where IntersectionObserver is missing (jsdom)', () => {
    render(<Seen />);
    expect(screen.getByText('seen')).toBeTruthy();
  });
});
