// UX-14 (r5): /tag scrolled sideways in Firefox on phones. Firefox says CSS.supports for the stylesheet's
// zoom: min(1, tan(atan2(100cqi, 680px))) yet doesn't apply it, so SheetFit no longer asks the engine: it measures.
// A Letter page wider than its column after layout gets data-fit="js" and --sheet-k (column / page); one that fits
// (the stylesheet's scale worked) is left alone.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { overflows, SheetFit, sheetScale } from '../SheetFit';

type RO = { cb: ResizeObserverCallback };
const observers: RO[] = [];
class FakeResizeObserver {
  private o: RO;
  constructor(cb: ResizeObserverCallback) {
    this.o = { cb };
    observers.push(this.o);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

afterEach(() => {
  cleanup();
  observers.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A column `col` px wide holding a page laid out `page` px wide (what the engine made of the stylesheet's zoom). */
function sheet(col: { w: number }, page: { w: number }) {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => col.w);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: page.w }) as DOMRect,
  );
  return render(
    <SheetFit label="A Letter page" describedBy="w">
      <div className="sheet-letter" />
    </SheetFit>,
  ).container.querySelector<HTMLDivElement>('.sheet-fit')!;
}

describe('SheetFit (UX-14, r5)', () => {
  it('sheetScale: the column over the page, never above 1; overflows: wider than the column by more than 1 px', () => {
    expect(sheetScale(340, 680)).toBe(0.5);
    expect(sheetScale(1200, 680)).toBe(1);
    expect(sheetScale(0, 680)).toBe(1);
    expect(overflows(680, 320)).toBe(true);
    expect(overflows(320.5, 320)).toBe(false);
    expect(overflows(680, 0)).toBe(false);
  });

  it('the engine left the page at 680 px in a 320 column (Firefox): the measured scale takes over, and follows resizes', () => {
    const col = { w: 320 };
    const el = sheet(col, { w: 680 });
    expect(el.dataset.fit).toBe('js');
    expect(el.style.getPropertyValue('--sheet-k')).toBe(String(320 / 680));
    col.w = 390;
    act(() => observers[0]!.cb([], {} as ResizeObserver));
    expect(el.style.getPropertyValue('--sheet-k')).toBe(String(390 / 680));
  });

  it('the stylesheet’s scale worked (the page fits its column): nothing is set', () => {
    const el = sheet({ w: 320 }, { w: 320 });
    expect(el.dataset.fit).toBeUndefined();
    expect(el.style.getPropertyValue('--sheet-k')).toBe('');
  });

  it('site.css: the measured scale wins over the stylesheet’s, and print resets both to 1', () => {
    const css = readFileSync(path.resolve(__dirname, '../../../ui/site.css'), 'utf8');
    expect(css).toContain('zoom: min(1, tan(atan2(100cqi, var(--letter-w))));');
    expect(css).toMatch(/\.sheet-fit\[data-fit='js'\] \.sheet-letter \{\s*zoom: var\(--sheet-k, 1\);/);
    expect(css).toMatch(
      /\.sheet-fit \.sheet-letter,\s*\.sheet-fit\[data-fit='js'\] \.sheet-letter \{\s*width: 8\.5in;\s*zoom: 1;/,
    );
  });
});
