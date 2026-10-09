'use client';
// src/ui/Slideshow.tsx: a PhotoSlot whose slot shows several photos in turn (photo-slots.ts `slides`, written only by
// a private build: scripts/fetch-real-photos.mjs). Photo 1 is PhotoSlot's own server-rendered <img>, loaded exactly
// as a still photo (eager/priority unchanged), so the page's largest paint is the same. Nothing more starts before
// the page's load event and an idle moment, and nothing while the figure is off screen. Then photos join ONE AT A
// TIME: only the next photo is in the page (lazy, low priority), loading during the SLIDE_MS the current one shows, so
// a visitor downloads only the photos the rotation reaches. They stack over photo 1 in the same box (no layout shift)
// and crossfade in turn. A Pause/Play toggle sits on the photo. Reduced motion: photo 1 only, no toggle. The rotation
// stops while the tab is hidden or the figure is off screen, and holds the current photo until the next has loaded.
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
  /** how many of photos 2..n are in the page (the ones reached so far, plus the next one) */
  mounted: number;
  toggle: () => void;
  loaded: (i: number) => void;
  /** the figure entered or left the screen (SlideshowSlides' sentinel) */
  seen: (visible: boolean) => void;
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
  // the photo on top, and the furthest the rotation has reached (photos up to reach + 1 stay in the page)
  const [{ active, reach }, setShow] = useState({ active: 0, reach: 0 });
  // on screen: until the sentinel reports, unknown (false): nothing is fetched for a figure no one has scrolled to
  const [visible, setVisible] = useState(false);
  const [everSeen, setEverSeen] = useState(false);
  const ready = useRef<boolean[]>([true]);

  useEffect(() => {
    // after the load event, at the next idle moment (where the browser can say): the photos come after everything else
    let idle: number | undefined;
    const done = () => {
      if (typeof window.requestIdleCallback === 'function')
        idle = window.requestIdleCallback(() => setPageLoaded(true), { timeout: 2000 });
      else setPageLoaded(true);
    };
    if (document.readyState === 'complete') done();
    else window.addEventListener('load', done, { once: true });
    return () => {
      window.removeEventListener('load', done);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, []);
  useEffect(() => subscribeMedia('(prefers-reduced-motion: reduce)', setReduced), []);
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const on = count > 1 && pageLoaded && !reduced;
  const running = on && !paused && !hidden && visible;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      // the next photo, once it has loaded; until then the current one stays
      setShow((s) => {
        const next = (s.active + 1) % count;
        return ready.current[next] ? { active: next, reach: Math.max(s.reach, next) } : s;
      });
    }, SLIDE_MS);
    return () => window.clearInterval(t);
  }, [running, count]);
  const toggle = useCallback(() => setPaused((p) => !p), []);
  const loaded = useCallback((i: number) => {
    ready.current[i] = true;
  }, []);
  const seen = useCallback((v: boolean) => {
    setVisible(v);
    if (v) setEverSeen(true);
  }, []);
  // photos reached so far + the next one; none until the figure has been on screen
  const mounted = on && everSeen ? Math.min(count - 1, reach + 1) : 0;
  const value = useMemo(
    () => ({ count, on, active: on ? active : 0, paused, mounted, toggle, loaded, seen }),
    [count, on, active, paused, mounted, toggle, loaded, seen],
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
  return (
    <>
      <SlideshowSentinel seen={show.seen} />
      {renderSlides(slides.slice(0, show.mounted), sizes, show)}
    </>
  );
}

/** Covers the figure (no box of its own to the user): tells the show whether the figure is on screen. */
function SlideshowSentinel({ seen }: { seen: (visible: boolean) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // no IntersectionObserver (old browsers, test DOMs): treat the figure as on screen
    if (typeof IntersectionObserver !== 'function') {
      seen(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => seen(Boolean(e?.isIntersecting)), {
      rootMargin: '200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return <span ref={ref} className="ph-seen" aria-hidden="true" />;
}

/**
 * Photo `p` (1-based slide = photo index; photo 0 is the base image, always there) is shown when it is on top, or
 * directly under the top one: the incoming photo fades in over a photo that stays opaque, and nothing older stays
 * stacked. On the loop back to photo 1 only the last photo fades out, so slides 2..n never cross-fade at once as a
 * multi-exposure (photo round 3, PH-07). An older photo turns off while fully covered by the two above it.
 */
export function onAt(p: number, active: number): boolean {
  return p === active || p === active - 1;
}

function renderSlides(
  slides: readonly { src: string; srcSet: string; style?: Record<string, string | number> }[],
  sizes: string,
  show: SlideshowState,
) {
  // Each slide is an unfiltered frame box (the paper around a framed photo) holding its graded <img>: site.css.
  return slides.map((s, i) => (
    <span
      key={s.src}
      className={cx('ph-slide', onAt(i + 1, show.active) && 'is-on')}
      style={s.style as CSSProperties | undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
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
    </span>
  ));
}

/**
 * The Pause/Play toggle. Nothing when the photos are not rotating (see `on`). QA4 L8: the name is the action the
 * button shows, "Pause" or "Play" (+ `label`, which slideshow: the dish), with no aria-pressed, so the visible word is
 * always the start of the name (WCAG 2.5.3) and it never reads "Play, pressed".
 */
export function SlideshowToggle({ label }: { label?: string } = {}) {
  const show = useContext(SlideshowContext);
  if (!show?.on) return null;
  const word = show.paused ? SLIDESHOW.play : SLIDESHOW.pause;
  return (
    <button
      type="button"
      className="ph-play"
      aria-label={label ? `${word} ${label}` : undefined} // NEW COPY (needs Jon): "Pause {dish}" / "Play {dish}"
      onClick={show.toggle}
    >
      {word}
    </button>
  );
}
