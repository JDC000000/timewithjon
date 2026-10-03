// S04b the sticky course bar (T1.3.U3, R1-16): one Courses nav, 4 links, aria-current follows the course in view,
// activation moves focus to the course heading. Real layout (sticky, 44 px, 320 px, Tab) is tests/e2e/ui/course-bar.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu } from '@/app/_menu/Menu';
import { menuModel } from '@/app/_menu/menu-model';
import { CourseBar } from '../CourseBar';

const model = menuModel(new Date('2027-03-01T12:00:00Z'));
const IDS = ['starters', 'mains', 'big-days', 'off-the-menu'];
/** Each course section's top on screen (jsdom has no layout); the nav's foot sits at 60. */
let tops: Record<string, number>;
const rect = (top: number, height = 0) =>
  ({
    top,
    bottom: top + height,
    left: 0,
    right: 320,
    width: 320,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

beforeEach(() => {
  tops = { starters: 400, mains: 1400, 'big-days': 2400, 'off-the-menu': 3400 };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.tagName === 'NAV') return rect(0, 60);
    return rect(tops[this.id] ?? 0);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

const setup = () => {
  render(
    <>
      <Menu model={model} gate={{ kind: 'book' }} />
      <CourseBar />
    </>,
  );
  const nav = screen.getByRole('navigation', { name: 'Courses' });
  return { nav, links: within(nav).getAllByRole('link') };
};
const currentText = (nav: HTMLElement) =>
  Array.from(nav.querySelectorAll('[aria-current]')).map((a) => a.textContent);
const scrollTo = async (next: Record<string, number>) => {
  tops = next;
  await act(async () => {
    window.dispatchEvent(new Event('scroll'));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
};

describe('CourseBar (S04b)', () => {
  it('keeps ONE nav aria-label="Courses" with a link per course section', () => {
    const { links } = setup();
    expect(screen.getAllByRole('navigation', { name: 'Courses' })).toHaveLength(1);
    expect(links).toHaveLength(4);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(IDS.map((id) => `#${id}`));
    for (const id of IDS) expect(document.getElementById(id)).not.toBeNull();
    expect(document.documentElement.style.getPropertyValue('--course-bar-h')).toBe('60px');
  });

  it('aria-current marks the course in view, and only that one, as the page scrolls', async () => {
    const { nav } = setup();
    expect(currentText(nav)).toEqual(['Starters']);
    await scrollTo({ starters: -900, mains: 40, 'big-days': 1000, 'off-the-menu': 2000 });
    expect(currentText(nav)).toEqual(['Mains']);
    await scrollTo({ starters: -2900, mains: -1900, 'big-days': -900, 'off-the-menu': 30 });
    expect(currentText(nav)).toEqual(['Off the Menu']);
    await scrollTo({ starters: -300, mains: 700, 'big-days': 1700, 'off-the-menu': 2700 });
    expect(currentText(nav)).toEqual(['Starters']);
    expect(nav.querySelector('[aria-current]')?.getAttribute('aria-current')).toBe('true');
  });

  it('activating a link marks it current and moves focus to that course heading once the jump rests', async () => {
    vi.useFakeTimers();
    const { nav, links } = setup();
    fireEvent.click(links[2]!);
    expect(currentText(nav)).toEqual(['Big Days']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const heading = screen.getByRole('heading', { level: 2, name: 'Big Days' });
    expect(heading.id).toBe('big-days-h');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
  });

  it('cleans up: no bar height left on <html> after unmount', () => {
    setup();
    cleanup();
    expect(document.documentElement.style.getPropertyValue('--course-bar-h')).toBe('');
  });
});
