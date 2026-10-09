// UX-14 (ux-a11y-adversarial 2026-10-08): /tag scrolled sideways in Firefox on phones, because the preview's scale used
// calc(length / length), which Firefox doesn't compute, and nothing set the --sheet-k fallback. Now the stylesheet uses
// tan(atan2(column, page)) and SheetFit sets --sheet-k from the column's width where even that isn't supported.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetFit, sheetScale } from '../SheetFit';

type RO = { cb: ResizeObserverCallback; el?: Element };
const observers: RO[] = [];
class FakeResizeObserver {
  private o: RO;
  constructor(cb: ResizeObserverCallback) {
    this.o = { cb };
    observers.push(this.o);
  }
  observe(el: Element) {
    this.o.el = el;
  }
  disconnect() {}
  unobserve() {}
}

afterEach(() => {
  cleanup();
  observers.length = 0;
  vi.unstubAllGlobals();
});

const sheet = () =>
  render(
    <SheetFit label="A Letter page" describedBy="w">
      <div className="sheet-letter" />
    </SheetFit>,
  ).container.querySelector<HTMLDivElement>('.sheet-fit')!;

describe('SheetFit (UX-14)', () => {
  it('sheetScale: the column over the page, never above 1', () => {
    expect(sheetScale(340, 680)).toBe(0.5);
    expect(sheetScale(1200, 680)).toBe(1);
    expect(sheetScale(0, 680)).toBe(1);
  });

  it('where the stylesheet can’t scale (no tan(atan2()) in zoom), it sets --sheet-k from the column and follows resizes', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('CSS', { supports: () => false });
    const widths = [320];
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => widths[0]!);
    const el = sheet();
    expect(el.style.getPropertyValue('--sheet-k')).toBe(String(320 / 680));
    widths[0] = 390;
    act(() => observers[0]!.cb([], {} as ResizeObserver));
    expect(el.style.getPropertyValue('--sheet-k')).toBe(String(390 / 680));
    vi.restoreAllMocks();
  });

  it('where the stylesheet scales it, nothing is set', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('CSS', { supports: (p: string, v: string) => p === 'zoom' && v.includes('atan2') });
    expect(sheet().style.getPropertyValue('--sheet-k')).toBe('');
    expect(observers).toHaveLength(0);
  });

  it('site.css scales with tan(atan2()), never calc(length / length), and print stays at 1', () => {
    const css = readFileSync(path.resolve(__dirname, '../../../ui/site.css'), 'utf8');
    expect(css).toContain('zoom: min(1, tan(atan2(100cqi, var(--letter-w))));');
    expect(css).not.toMatch(/zoom:\s*min\(1,\s*calc\(100cqi\s*\//);
    expect(css).toMatch(/\.sheet-fit \.sheet-letter \{\s*width: 8\.5in;\s*zoom: 1;/);
  });
});
