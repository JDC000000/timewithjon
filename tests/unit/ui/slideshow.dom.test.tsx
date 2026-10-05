// tests/unit/ui/slideshow.dom.test.tsx: a PhotoSlot whose slot has `slides` > 1 (src/ui/Slideshow.tsx), on a fixture
// slot registry (a private build is the only writer of `slides`). Real-browser crossfade and layout:
// tests/e2e/ui/slideshow.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DishPhotoScope } from '@/app/_menu/Menu';
import { SLIDESHOW } from '@/content/ui/foundation';
import { PhotoSlot } from '@/ui';
import { photoSlides, slideCount, type PhotoSlots } from '@/ui/photo-slots';
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
  const on = imgs(c).filter((i) => i.classList.contains('is-on'));
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
  it('renders one image (photo 1, as a still photo) until the page loads, then all n', () => {
    const { container } = render(<PhotoSlot slot="show" kind="hero" priority="hero" slots={FIXTURE} />);
    expect(imgs(container)).toHaveLength(1);
    const first = imgs(container)[0]!;
    expect(first.getAttribute('src')).toBe('/img/show-480.webp');
    expect(first.getAttribute('loading')).toBe('eager');
    expect(first.getAttribute('fetchpriority')).toBe('high');
    expect(screen.queryByRole('button')).toBeNull();
    pageLoads();
    const all = imgs(container);
    expect(all.map((i) => i.getAttribute('src'))).toEqual([
      '/img/show-480.webp',
      '/img/show-2-480.webp',
      '/img/show-3-480.webp',
    ]);
    for (const i of all.slice(1)) {
      expect(i.getAttribute('loading')).toBe('lazy');
      expect(i.getAttribute('alt')).toBe('');
    }
    expect(container.querySelector('figure')!.dataset.slides).toBe('3');
  });

  it('a page already loaded adds the photos at once', () => {
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="band" slots={FIXTURE} />);
    expect(imgs(container)).toHaveLength(3);
  });

  it('advances every SLIDE_MS, loops back to photo 1, and skips a photo not loaded yet', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="band" slots={FIXTURE} />);
    expect(onTop(container)).toBe(1);
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(1); // photo 2 has not loaded: stays on photo 1
    slidesLoad(container);
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(2);
    act(() => void vi.advanceTimersByTime(SLIDE_MS - 1));
    expect(onTop(container)).toBe(2);
    act(() => void vi.advanceTimersByTime(1));
    expect(onTop(container)).toBe(3);
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(onTop(container)).toBe(1);
  });

  it('Pause stops the rotation; Play resumes it (aria-pressed, the label is the action)', () => {
    vi.useFakeTimers();
    readyState = 'complete';
    const { container } = render(<PhotoSlot slot="show" kind="band" slots={FIXTURE} />);
    slidesLoad(container);
    const btn = screen.getByRole('button', { name: SLIDESHOW.pause });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.closest('figure')).not.toBeNull();
    fireEvent.click(btn);
    expect(btn.textContent).toBe(SLIDESHOW.play);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    act(() => void vi.advanceTimersByTime(SLIDE_MS * 3));
    expect(onTop(container)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: SLIDESHOW.play }));
    expect(btn.textContent).toBe(SLIDESHOW.pause);
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
