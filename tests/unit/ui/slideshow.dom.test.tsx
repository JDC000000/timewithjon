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
import { slideState, SLIDE_MS } from '@/ui/Slideshow';
import { PhotoTiles } from '@/ui/PhotoTiles';
import { BLANK_PIXEL } from '@/ui/PhotoSlot';

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
/** the photo on top (1-based): the slide marked is-top, else photo 1 */
const onTop = (c: HTMLElement) => {
  const slides = [...c.querySelectorAll('figure .ph-slide')];
  return slides.findIndex((s) => s.classList.contains('is-top')) + 2;
};
/** each slide's state class, photos 2..n */
const states = (c: HTMLElement) =>
  [...c.querySelectorAll('figure .ph-slide')].map((s) =>
    s.classList.contains('is-on') ? 'on' : s.classList.contains('is-out') ? 'out' : 'off',
  );
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

  it('a photo that fails to load is passed over: the photo after it joins and the show goes on', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="band" slots={FIXTURE} />);
    expect(imgs(container)).toHaveLength(2);
    act(() => void imgs(container)[1]!.dispatchEvent(new Event('error'))); // photo 2: a bad file
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(1); // photo 1 holds, and photo 3 joins the page past the bad one
    expect(imgs(container)).toHaveLength(3);
    act(() => void imgs(container)[2]!.dispatchEvent(new Event('load')));
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(3); // 1 → 3, over the bad photo 2
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(1); // and round again
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(3);
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

describe('slideshow stacking (photo rounds 3 and 4, PH-07)', () => {
  it('two photos at a time: the incoming one over the one it replaced; the loop back fades the last one alone', () => {
    const at = (active: number, from: number) => [1, 2, 3, 4, 5].map((p) => slideState(p, active, from));
    expect(at(0, 0)).toEqual(['off', 'off', 'off', 'off', 'off']); // photo 1 alone
    expect(at(1, 0)).toEqual(['on', 'off', 'off', 'off', 'off']); // photo 2 fades in over photo 1
    expect(at(2, 1)).toEqual(['on', 'on', 'off', 'off', 'off']); // photo 3 over photo 2
    expect(at(5, 4)).toEqual(['off', 'off', 'off', 'on', 'on']); // never slides 2..6 stacked
    // the loop back: photo 6 fades out over photo 1, and photo 5 (under it) is gone at once, so it never shows through
    expect(at(0, 5)).toEqual(['off', 'off', 'off', 'off', 'out']);
    // photo 4 failed to load and is passed over: photo 5 fades in over photo 3, never over the bad photo 4
    expect(at(4, 2)).toEqual(['off', 'on', 'off', 'on', 'off']);
  });

  it('only a photo fading in or out has an opacity transition; a photo turning off goes at once', () => {
    const css = readFileSync('src/ui/site.css', 'utf8');
    // every rule for the selector, joined
    const rule = (sel: string) =>
      [...css.matchAll(new RegExp(`^${sel.replace(/[.()]/g, '\\$&')} \\{([^}]*)\\}`, 'gm'))]
        .map((m) => m[1])
        .join('');
    expect(rule('.ph .ph-slide')).not.toMatch(/opacity \d/);
    expect(rule('.ph .ph-slide:is(.is-on, .is-out)')).toMatch(/opacity 1\.2s/);
    expect(rule('.ph .ph-slide.is-on')).toMatch(/opacity: 1;/);
  });

  it('the rotation: each step marks the incoming photo over the one it replaced; the loop back fades out the last', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="band" slots={FIXTURE} />);
    slidesLoad(container);
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    slidesLoad(container);
    expect(states(container)).toEqual(['on', 'off']); // photo 2 over photo 1
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(states(container)).toEqual(['on', 'on']); // photo 3 over photo 2
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(states(container)).toEqual(['off', 'out']); // loop back: photo 3 fades out alone; photo 2 is gone at once
    expect(onTop(container)).toBe(1);
  });

  it('the framing fallback ratios match the --ph-ratio-* tokens', () => {
    const tokens = readFileSync('src/ui/tokens.css', 'utf8');
    const css = readFileSync('src/ui/site.css', 'utf8');
    const ratio = (key: string) => {
      const m = new RegExp(`--ph-ratio-${key}: (\\d+) / (\\d+);`).exec(tokens)!;
      return Number(m[1]) / Number(m[2]);
    };
    for (const key of [
      'hero-s',
      'hero-m',
      'hero',
      'band',
      'band-l',
      'close-tile',
      'dish',
      'sheet',
      'sheet-l',
      'thumb',
      'thumb-l',
      'sent',
      'sent-m',
    ]) {
      const m = new RegExp(`--ph-f: var\\(--f-${key}, ([\\d.]+)\\)`).exec(css);
      expect(m, key).not.toBeNull();
      expect(Number(m![1]), key).toBeCloseTo(ratio(key), 3);
    }
  });
});

describe('zoom (design round 6, 8a)', () => {
  it('a view with zoom puts --zm-<key> on its photo; the CSS scales every photo by its key about its position', () => {
    const views: PhotoViews = { show: [{ 'close-s': { pos: '55% 40%', zoom: 1.6 } }] };
    expect(photoViewStyle('show', 0, undefined, views)).toEqual({
      '--p-close-s': '55% 40%',
      '--zm-close-s': 1.6,
    });
    const css = readFileSync('src/ui/site.css', 'utf8');
    for (const key of [
      'hero-s',
      'hero',
      'band',
      'close-s',
      'close-m',
      'close-l',
      'close-tile',
      'dish',
      'thumb',
    ])
      expect(css, key).toContain(`--ph-z: var(--zm-${key}, 1);`);
    expect(css).toMatch(/\.ph img \{\s*scale: var\(--ph-z, 1\);\s*transform-origin: var\(--ph-p, 50% 50%\);/);
  });
});

describe('PhotoTiles (design round 6, P3 B: the closing row of three)', () => {
  const SIX: PhotoSlots = { six: { file: 'close', w: [480, 800], alt: '', slides: 6 } };
  const tiles = (c: HTMLElement) => [...c.querySelectorAll('.ph-tiles figure.ph--tile')];
  const tileOn = (c: HTMLElement) =>
    tiles(c).map((f) => (f.querySelector('.ph-slide.is-top') ? 'second' : 'first'));

  it('three square tiles: photos 1-3, each pairing with photo k+3; one toggle for the row; lazy', () => {
    readyState = 'complete';
    const { container } = render(<PhotoTiles slot="six" slots={SIX} />);
    expect(tiles(container)).toHaveLength(3);
    // photo k's files only from 1024 px (a <picture> source); below it the <img> holds a blank pixel
    expect(
      tiles(container).map((f) => f.querySelector('picture > source')!.getAttribute('srcset')!.split(' ')[0]),
    ).toEqual(['/img/close-480.webp', '/img/close-2-480.webp', '/img/close-3-480.webp']);
    for (const f of tiles(container)) {
      expect(f.querySelector('picture > source')!.getAttribute('media')).toBe('(min-width: 1024px)');
      expect(f.querySelector('picture > img')!.getAttribute('src')).toBe(BLANK_PIXEL);
      expect(f.querySelector('picture > img')!.getAttribute('loading')).toBe('lazy');
    }
    expect(tiles(container).map((f) => f.querySelector('.ph-slide img')!.getAttribute('src'))).toEqual([
      '/img/close-4-480.webp',
      '/img/close-5-480.webp',
      '/img/close-6-480.webp',
    ]);
    expect(screen.getAllByRole('button', { name: SLIDESHOW.pause })).toHaveLength(1);
  });

  it('the row turns together, once every tile has its second photo; Pause holds all three', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(<PhotoTiles slot="six" slots={SIX} />);
    const second = () => tiles(container).map((f) => f.querySelector<HTMLImageElement>('.ph-slide img')!);
    act(() => void second()[0]!.dispatchEvent(new Event('load')));
    act(() => void second()[1]!.dispatchEvent(new Event('load')));
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(tileOn(container)).toEqual(['first', 'first', 'first']); // tile 3's photo 6 not loaded: all hold
    act(() => void second()[2]!.dispatchEvent(new Event('load')));
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(tileOn(container)).toEqual(['second', 'second', 'second']);
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(tileOn(container)).toEqual(['first', 'first', 'first']);
    fireEvent.click(screen.getByRole('button', { name: SLIDESHOW.pause }));
    act(() => void vi.advanceTimersByTime(SLIDE_MS * 3));
    expect(tileOn(container)).toEqual(['first', 'first', 'first']);
  });

  it('each photo carries its own close-tile view', () => {
    readyState = 'complete';
    const views: PhotoViews = {
      six: [{ 'close-tile': '50% 2.2%' }, {}, {}, { 'close-tile': '100% 50%' }, {}, {}],
    };
    const { container } = render(<PhotoTiles slot="six" slots={SIX} views={views} />);
    expect(tiles(container)[0]!.querySelector('picture > img')!.getAttribute('style')).toContain(
      '--p-close-tile: 50% 2.2%',
    );
    expect(tiles(container)[0]!.querySelector('.ph-slide img')!.getAttribute('style')).toContain(
      '--p-close-tile: 100% 50%',
    );
  });

  it('4 photos: only tile 1 turns (1<->4); under 3 photos (or a still): nothing, the single photo stays', () => {
    readyState = 'complete';
    const four: PhotoSlots = { six: { ...SIX.six!, slides: 4 } };
    const { container } = render(<PhotoTiles slot="six" slots={four} />);
    expect(tiles(container).map((f) => f.querySelectorAll('img').length)).toEqual([2, 1, 1]);
    cleanup();
    for (const slides of [1, 2]) {
      const { container: c } = render(<PhotoTiles slot="six" slots={{ six: { ...SIX.six!, slides } }} />);
      expect(c.innerHTML).toBe('');
      cleanup();
    }
  });

  it('reduced motion: photos 1-3 only, no toggle', () => {
    readyState = 'complete';
    reduced = true;
    const { container } = render(<PhotoTiles slot="six" slots={SIX} />);
    expect(container.querySelectorAll('img')).toHaveLength(3);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PhotoSlot media (design round 6: the single closing photo where the tiles are not)', () => {
  it('with media: photo 1 is a <picture> source for that media only, its <img> a blank pixel; without: as before', () => {
    readyState = 'complete';
    const { container } = render(
      <PhotoSlot slot="show" kind="close" slots={FIXTURE} media="(max-width: 1023px)" />,
    );
    const source = container.querySelector('figure > picture > source')!;
    expect(source.getAttribute('media')).toBe('(max-width: 1023px)');
    expect(source.getAttribute('srcset')).toBe('/img/show-480.webp 480w, /img/show-800.webp 800w');
    const img = container.querySelector('figure > picture > img')!;
    expect(img.getAttribute('src')).toBe(BLANK_PIXEL);
    expect(img.getAttribute('srcset')).toBeNull();
    cleanup();
    const plain = render(<PhotoSlot slot="show" kind="close" slots={FIXTURE} />).container;
    expect(plain.querySelector('picture')).toBeNull();
    expect(plain.querySelector('figure > img')!.getAttribute('src')).toBe('/img/show-480.webp');
  });
});

describe('the framing variables never share a name with a design token (PH-24)', () => {
  // A view's per-key variables (--p-<key>, --f-<key>, --zm-<key>) are read with a fallback: if a token of the same
  // name exists (as --z-sheet, the z-index token, once did for the zoom), the token silently wins and a photo is
  // drawn at that value (scale 50). Every name the photo layer reads or photoViewStyle writes must be one no
  // stylesheet declares.
  const tokens = readFileSync('src/ui/tokens.css', 'utf8');
  const site = readFileSync('src/ui/site.css', 'utf8');
  const declared = new Set([...`${tokens}\n${site}`.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]!));
  // every per-key variable feeding the photo layer: the first var() of each --ph-p / --ph-f / --ph-z declaration
  const read = [...site.matchAll(/--ph-[pfz]:\s*var\((--[a-z0-9-]+)/gi)]
    .map((m) => m[1]!)
    .filter((n) => n !== '--p');
  const written = Object.keys(
    photoViewStyle('x', 0, undefined, {
      x: [
        Object.fromEntries(
          [...new Set(read.map((n) => n.replace(/^--(?:p|f|zm)-/, '')))].map((k) => [
            k,
            { pos: '50% 50%', zoom: 2 },
          ]),
        ),
      ],
    }) ?? {},
  );

  it('reads a zoom, frame and position variable for every view key', () => {
    expect(read.filter((n) => n.startsWith('--zm-')).length).toBeGreaterThanOrEqual(16);
    expect(read).toContain('--zm-sheet');
    expect(written).toContain('--zm-sheet');
  });
  it('no variable the photo layer reads or writes is declared as a token anywhere', () => {
    expect(read.filter((n) => declared.has(n))).toEqual([]);
    expect(written.filter((n) => declared.has(n))).toEqual([]);
  });
  it('the zoom namespace is not the z-index one', () => {
    expect(site).not.toMatch(/--ph-z: var\(--z-/);
    expect([...declared].filter((n) => n.startsWith('--zm-'))).toEqual([]);
  });
});
