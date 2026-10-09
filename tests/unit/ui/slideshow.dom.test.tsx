// tests/unit/ui/slideshow.dom.test.tsx: a PhotoSlot whose slot has `slides` > 1 (src/ui/Slideshow.tsx), on a fixture
// slot registry (a private build is the only writer of `slides`). Real-browser crossfade and layout:
// tests/e2e/ui/slideshow.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DishPhotoScope } from '@/app/_menu/Menu';
import { SLIDESHOW } from '@/content/ui/foundation';
import { PhotoSlot } from '@/ui';
import { readFileSync } from 'node:fs';
import {
  PHOTO_VIEWS,
  photoSlides,
  photoViewStyle,
  slideCount,
  type PhotoSlots,
  type PhotoViews,
} from '@/ui/photo-slots';
import { SLIDE_MS } from '@/ui/Slideshow';

const FIXTURE: PhotoSlots = {
  show: { file: 'show', w: [480, 800], alt: '', slides: 3 },
  still: { file: 'still', w: [480, 800], alt: '' },
};

let readyState: DocumentReadyState = 'loading';
let reduced = false;
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  readyState = 'loading';
  reduced = false;
  visibility = 'visible';
  vi.spyOn(document, 'readyState', 'get').mockImplementation(() => readyState);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' && reduced,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const imgs = (c: HTMLElement) => [...c.querySelectorAll('figure img')] as HTMLImageElement[];
const onTop = (c: HTMLElement) => {
  const on = [...c.querySelectorAll('figure .ph-slide.is-on')];
  return on.length === 0 ? 1 : on.length + 1; // photo n is on top when photos 2..n are faded in
};
function pageLoads() {
  readyState = 'complete';
  act(() => {
    window.dispatchEvent(new Event('load'));
  });
}
function slidesLoad(c: HTMLElement) {
  for (const img of imgs(c).slice(1)) act(() => void img.dispatchEvent(new Event('load')));
}

describe('photo-slots slides', () => {
  it('lists photos 2..n as <file>-<n>-<w>.webp; a still photo has none', () => {
    expect(photoSlides('show', FIXTURE)).toEqual([
      { src: '/img/show-2-480.webp', srcSet: '/img/show-2-480.webp 480w, /img/show-2-800.webp 800w' },
      { src: '/img/show-3-480.webp', srcSet: '/img/show-3-480.webp 480w, /img/show-3-800.webp 800w' },
    ]);
    expect(slideCount('show', FIXTURE)).toBe(3);
    expect(photoSlides('still', FIXTURE)).toEqual([]);
    expect(slideCount('still', FIXTURE)).toBe(1);
    expect(slideCount('nope', FIXTURE)).toBe(1);
  });
});

describe('PhotoSlot slideshow', () => {
  it('renders one image (photo 1, as a still photo) until the page loads, then only the next photo joins', () => {
    const { container } = render(<PhotoSlot slot="show" kind="hero" priority="hero" slots={FIXTURE} />);
    expect(imgs(container)).toHaveLength(1);
    const first = imgs(container)[0]!;
    expect(first.getAttribute('src')).toBe('/img/show-480.webp');
    expect(first.getAttribute('loading')).toBe('eager');
    expect(first.getAttribute('fetchpriority')).toBe('high');
    expect(screen.queryByRole('button')).toBeNull();
    pageLoads();
    const all = imgs(container);
    // photo 3 is not fetched until photo 2 is on top: a visitor downloads only what the rotation reaches
    expect(all.map((i) => i.getAttribute('src'))).toEqual(['/img/show-480.webp', '/img/show-2-480.webp']);
    expect(all[1]!.getAttribute('loading')).toBe('lazy');
    expect(all[1]!.getAttribute('fetchpriority')).toBe('low');
    expect(all[1]!.getAttribute('alt')).toBe('');
    expect(container.querySelector('figure')!.dataset.slides).toBe('3');
  });

  it('a page already loaded adds the next photo at once', () => {
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="band" slots={FIXTURE} />);
    expect(imgs(container)).toHaveLength(2);
  });

  it('advances every SLIDE_MS, one photo ahead in the page, holds until the next has loaded, loops to photo 1', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="band" slots={FIXTURE} />);
    expect(onTop(container)).toBe(1);
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(1); // photo 2 has not loaded: photo 1 stays
    slidesLoad(container);
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(2);
    expect(imgs(container)).toHaveLength(3); // photo 2 on top: photo 3 joins now
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(2); // photo 3 not loaded yet: photo 2 holds
    slidesLoad(container);
    act(() => void vi.advanceTimersByTime(SLIDE_MS - 1));
    expect(onTop(container)).toBe(2);
    act(() => void vi.advanceTimersByTime(1));
    expect(onTop(container)).toBe(3);
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(1);
    expect(imgs(container)).toHaveLength(3); // once in the page, a photo stays (no refetch)
  });

  it('off screen: no photo beyond the first is fetched, and nothing rotates, until the figure is seen', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const observers: { cb: IntersectionObserverCallback }[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          observers.push({ cb });
        }
        observe() {}
        disconnect() {}
      },
    );
    const { container } = render(<PhotoSlot slot="show" kind="band" slots={FIXTURE} />);
    const report = (isIntersecting: boolean) =>
      act(() =>
        observers.forEach((o) => o.cb([{ isIntersecting } as IntersectionObserverEntry], {} as never)),
      );
    expect(imgs(container)).toHaveLength(1);
    report(false);
    act(() => void vi.advanceTimersByTime(SLIDE_MS * 2));
    expect(imgs(container)).toHaveLength(1);
    report(true);
    expect(imgs(container)).toHaveLength(2);
    slidesLoad(container);
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(2);
    report(false); // scrolled away: the rotation stops
    act(() => void vi.advanceTimersByTime(SLIDE_MS * 3));
    expect(onTop(container)).toBe(2);
    vi.unstubAllGlobals();
  });

  it('Pause stops the rotation; Play resumes it (QA4 L8: the name is the word shown, no aria-pressed)', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="band" slots={FIXTURE} />);
    slidesLoad(container);
    const btn = screen.getByRole('button', { name: SLIDESHOW.pause });
    expect(btn.hasAttribute('aria-pressed')).toBe(false);
    expect(btn.closest('figure')).not.toBeNull();
    fireEvent.click(btn);
    // label in name (WCAG 2.5.3): the name follows the visible word; never "Play, pressed"
    expect(screen.getByRole('button', { name: SLIDESHOW.play })).toBe(btn);
    expect(btn.textContent).toBe(SLIDESHOW.play);
    expect(btn.hasAttribute('aria-pressed')).toBe(false);
    act(() => void vi.advanceTimersByTime(SLIDE_MS * 3));
    expect(onTop(container)).toBe(1);
    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: SLIDESHOW.pause })).toBe(btn);
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(2);
  });

  it('stops while the tab is hidden', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="band" slots={FIXTURE} />);
    slidesLoad(container);
    visibility = 'hidden';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(SLIDE_MS * 3));
    expect(onTop(container)).toBe(1);
    visibility = 'visible';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(2);
  });

  it('reduced motion: photo 1 only, no toggle, no rotation', () => {
    vi.useFakeTimers();
    reduced = true;
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="hero" priority="hero" slots={FIXTURE} />);
    pageLoads();
    act(() => void vi.advanceTimersByTime(SLIDE_MS * 3));
    expect(imgs(container)).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a still photo is unchanged: one image, no toggle, no data-slides', () => {
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="still" kind="band" slots={FIXTURE} />);
    expect(imgs(container)).toHaveLength(1);
    expect(container.querySelector('figure')!.hasAttribute('data-slides')).toBe(false);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a photo inside a link: the toggle is the link’s sibling, never inside the <a>', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(
      <ul>
        <li className="dish">
          <DishPhotoScope slot="show" slots={FIXTURE}>
            <a className="dish-row" href="#x">
              <PhotoSlot slot="show" kind="dish" controls="outside" slots={FIXTURE} />
            </a>
          </DishPhotoScope>
        </li>
      </ul>,
    );
    slidesLoad(container);
    const btn = screen.getByRole('button', { name: SLIDESHOW.pause });
    expect(btn.closest('a')).toBeNull();
    expect(btn.parentElement!.className).toBe('ph-ctl');
    expect(container.querySelector('a button')).toBeNull();
    fireEvent.click(btn);
    act(() => void vi.advanceTimersByTime(SLIDE_MS * 2));
    expect(onTop(container)).toBe(1);
  });
});

// QA4 L8: seven toggles on /menu all read "Pause"; each now names its dish (and its action).
describe('SlideshowToggle label (QA4 L8)', () => {
  afterEach(() => vi.useRealTimers());
  it('a card’s toggle carries the dish name, so each slideshow is told apart', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(
      <ul>
        {['The Grind', 'The Shore Ride'].map((name) => (
          <li className="dish" key={name}>
            <DishPhotoScope slot="show" slots={FIXTURE} label={name}>
              <a className="dish-row" href="#x">
                <PhotoSlot slot="show" kind="dish" controls="outside" slots={FIXTURE} />
              </a>
            </DishPhotoScope>
          </li>
        ))}
      </ul>,
    );
    slidesLoad(container);
    const grind = screen.getByRole('button', { name: `${SLIDESHOW.pause} The Grind` });
    expect(screen.getByRole('button', { name: `${SLIDESHOW.pause} The Shore Ride` })).not.toBe(grind);
    fireEvent.click(grind);
    expect(screen.getByRole('button', { name: `${SLIDESHOW.play} The Grind` })).toBe(grind);
    expect(grind.textContent).toBe(SLIDESHOW.play);
    expect(grind.hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('photo framing (photo-views.json)', () => {
  const SLOTS: PhotoSlots = {
    show: { file: 'show', w: [480, 800], alt: '', slides: 3, pos: '50% 30%' },
    still: { file: 'still', w: [480], alt: '', pos: '40% 20%' },
  };
  const VIEWS: PhotoViews = {
    show: [{ 'hero-s': { pos: '50% 13.9%', frame: 1.141 }, hero: '50% 18%' }, { 'hero-s': '20% 10%' }, {}],
  };
  const css = (el: Element) => (el as HTMLElement).getAttribute('style') ?? '';

  it('this repo commits no views: the file is {}', () => {
    expect(JSON.parse(readFileSync('src/ui/photo-views.json', 'utf8'))).toEqual({});
    expect(PHOTO_VIEWS).toEqual({});
  });

  it('photoViewStyle: custom properties with a view; a plain object-position (today) without one', () => {
    expect(photoViewStyle('show', 0, '50% 30%', VIEWS)).toEqual({
      '--p': '50% 30%',
      '--p-hero-s': '50% 13.9%',
      '--f-hero-s': 1.141,
      '--p-hero': '50% 18%',
    });
    expect(photoViewStyle('show', 2, '50% 30%', VIEWS)).toEqual({ objectPosition: '50% 30%' });
    expect(photoViewStyle('still', 0, '40% 20%', VIEWS)).toEqual({ objectPosition: '40% 20%' });
    expect(photoViewStyle('still', 0, undefined, VIEWS)).toBeUndefined();
  });

  it("photo 1 and EACH slide carry their own view (a slide never borrows photo 1's position)", () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="hero" slots={SLOTS} views={VIEWS} />);
    slidesLoad(container);
    act(() => void vi.advanceTimersByTime(SLIDE_MS)); // photo 2 on top: photo 3 joins
    const [first, second, third] = imgs(container);
    expect(css(first!)).toContain('--p-hero-s: 50% 13.9%');
    expect(css(first!)).toContain('--f-hero-s: 1.141');
    expect(css(first!)).toContain('--p-hero: 50% 18%');
    expect(css(second!)).toContain('--p-hero-s: 20% 10%');
    expect(css(second!)).not.toContain('--f-hero-s');
    expect(css(second!)).not.toContain('13.9%');
    expect(css(third!)).toBe('object-position: 50% 30%;');
  });

  it('no views: the same markup as before framing existed', () => {
    readyState = 'complete';
    const a = render(<PhotoSlot slot="still" kind="dish" slots={SLOTS} />).container.innerHTML;
    cleanup();
    const b = render(<PhotoSlot slot="still" kind="dish" slots={SLOTS} views={{}} />).container.innerHTML;
    expect(a).toBe(b);
    expect(a).toContain('style="object-position: 40% 20%;"');
    expect(a).not.toContain('--p');
  });
});
