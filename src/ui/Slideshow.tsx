'use client';
// src/ui/Slideshow.tsx: a PhotoSlot whose slot shows several photos in turn (photo-slots.ts `slides`, written only by
// a private build: scripts/fetch-real-photos.mjs). Photo 1 is PhotoSlot's own server-rendered <img>, loaded exactly
// as a still photo (eager/priority unchanged), so the page's largest paint is the same. Photos 2..n join only after
// the page's load event (lazy, low priority), stack over photo 1 in the same box (no layout shift) and crossfade in
// turn every SLIDE_MS. A Pause/Play toggle sits on the photo. Reduced motion: photo 1 only, no toggle. The rotation
// stops while the tab is hidden. A photo that has not loaded yet is skipped (back to photo 1).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { SLIDESHOW } from '@/content/ui/foundation';
import { cx } from './cx';

/** how long each photo shows */
export const SLIDE_MS = 5000;

type SlideshowState = {
  /** photos in the show (photo 1 included) */
  count: number;
  /** the extra photos are in the page and the toggle shows: after load, motion allowed */
  on: boolean;
  /** 0-based index of the photo on top */
  active: number;
  paused: boolean;
  toggle: () => void;
  loaded: (i: number) => void;
};

const SlideshowContext = createContext<SlideshowState | null>(null);

function subscribeMedia(query: string, set: (v: boolean) => void): () => void {
  if (typeof window.matchMedia !== 'function') {
    set(false);
    return () => {};
  }
  const mq = window.matchMedia(query);
  const on = () => set(mq.matches);
  on();
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}

/**
 * The state of one slideshow, shared by its photos (SlideshowSlides, inside the figure) and its toggle
 * (SlideshowToggle, inside the figure or, for a photo inside a link, next to the link). Renders no element.
 */
export function SlideshowScope({ count, children }: { count: number; children: ReactNode }) {
  const [pageLoaded, setPageLoaded] = useState(false);
  // until the media query is read: treat motion as reduced (nothing extra renders)
  const [reduced, setReduced] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(0);
  const ready = useRef<boolean[]>([true]);

  useEffect(() => {
    const done = () => setPageLoaded(true);
    if (document.readyState === 'complete') {
      done();
      return;
    }
    window.addEventListener('load', done, { once: true });
    return () => window.removeEventListener('load', done);
  }, []);
  useEffect(() => subscribeMedia('(prefers-reduced-motion: reduce)', setReduced), []);
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const on = count > 1 && pageLoaded && !reduced;
  const running = on && !paused && !hidden;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setActive((a) => {
        const next = (a + 1) % count;
        return ready.current[next] ? next : 0;
      });
    }, SLIDE_MS);
    return () => window.clearInterval(t);
  }, [running, count]);

  const toggle = useCallback(() => setPaused((p) => !p), []);
  const loaded = useCallback((i: number) => {
    ready.current[i] = true;
  }, []);
  const value = useMemo(
    () => ({ count, on, active: on ? active : 0, paused, toggle, loaded }),
    [count, on, active, paused, toggle, loaded],
  );
  return <SlideshowContext.Provider value={value}>{children}</SlideshowContext.Provider>;
}

/** Photos 2..n, over photo 1 (inside its figure). Nothing before the page's load event, or with reduced motion. */
export function SlideshowSlides({
  slides,
  sizes,
}: {
  /** each with its own framing style (photo-slots.ts photoViewStyle) */
  slides: readonly { src: string; srcSet: string; style?: Record<string, string | number> }[];
  sizes: string;
}) {
  const show = useContext(SlideshowContext);
  if (!show?.on) return null;
  return slides.map((s, i) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={s.src}
      className={cx('ph-slide', show.active > i && 'is-on')}
      src={s.src}
      srcSet={s.srcSet}
      sizes={sizes}
      alt=""
      loading="lazy"
      fetchPriority="low"
      decoding="async"
      onLoad={() => show.loaded(i + 1)}
      style={s.style as CSSProperties | undefined}
    />
  ));
}

/**
 * The Pause/Play toggle. Nothing when the photos are not rotating (see `on`). QA4 L8: a toggle button keeps one name,
 * "Pause" (+ `label`, which slideshow: the dish), and aria-pressed says whether it's paused ("Pause The Grind,
 * pressed" = paused). The visible word still flips to Play.
 */
export function SlideshowToggle({ label }: { label?: string } = {}) {
  const show = useContext(SlideshowContext);
  if (!show?.on) return null;
  return (
    <button
      type="button"
      className="ph-play"
      aria-pressed={show.paused}
      aria-label={label ? `${SLIDESHOW.pause} ${label}` : SLIDESHOW.pause} // NEW COPY (needs Jon): "Pause {dish}"
      onClick={show.toggle}
    >
      {show.paused ? SLIDESHOW.play : SLIDESHOW.pause}
    </button>
  );
}
