'use client';
// The focus helper's bench: one control per rule in src/ui/focus.ts. Dev-only labels (not guest copy).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { announce, holdStill, moveFocus, nextTabStop, useInView, useReturnFocus, whenFree } from '@/ui/focus';

// fixed px, not vh: a viewport resize must not change the layout above a control (the INT-08 cases measure scroll)
const TALL = { height: 1200 } as const;

function InViewCounter() {
  const box = useRef<HTMLDivElement>(null);
  const seen = useInView(box);
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    if (!seen) return;
    const t = setInterval(() => setTicks((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [seen]);
  return (
    <div ref={box} role="status" aria-label="In-view box" style={{ height: 200 }}>
      {seen ? 'in view' : 'out of view'} · {ticks > 0 ? 'ticked' : 'not ticked'}
    </div>
  );
}

function ReturnPanel() {
  const [open, setOpen] = useState(false);
  useReturnFocus(open);
  const close = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => moveFocus(close.current));
        }}
      >
        Open panel
      </button>
      {open && (
        <div role="group" aria-label="Panel">
          <button type="button" ref={close} onClick={() => setOpen(false)}>
            Close panel
          </button>
        </div>
      )}
    </div>
  );
}

function SwapChip() {
  const [clicks, setClicks] = useState(0);
  const [gen, setGen] = useState(0);
  return (
    <p>
      <button
        key={gen}
        type="button"
        onPointerDown={() => whenFree(() => setGen((g) => g + 1))}
        onClick={() => setClicks((c) => c + 1)}
      >
        Swap chip
      </button>
      <output aria-label="Chip clicks">{clicks}</output>
      <output aria-label="Chip rebuilds">{gen}</output>
    </p>
  );
}

/** holdStill: an error line above the tiles goes when a tile is picked; the picked tile must not move. */
function HoldTiles() {
  const tileOne = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <section aria-label="Tiles">
      {error && (
        <p role="alert" style={{ minHeight: 160 }}>
          Pick at least one time
        </p>
      )}
      {['Tile one', 'Tile two', 'Tile three'].map((t) => (
        <p key={t}>
          <button
            type="button"
            ref={t === 'Tile one' ? tileOne : undefined}
            aria-pressed={picked.includes(t)}
            onClick={(e) => {
              const el = e.currentTarget;
              holdStill(el, () =>
                flushSync(() => {
                  setError(false);
                  setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
                }),
              );
            }}
          >
            {t}
          </button>
        </p>
      ))}
      <p>
        <button type="button" onClick={() => moveFocus(tileOne.current)}>
          Focus tile one
        </button>
      </p>
    </section>
  );
}

export function FocusLab({ bar }: { bar: 'toast' | 'send' }) {
  // false in the server HTML, true once hydrated: tests wait for it before any input
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const far = useRef<HTMLButtonElement>(null);
  const covered = useRef<HTMLButtonElement>(null);
  return (
    <main id="main" className="wrap">
      <h1 className="h1">Focus bench</h1>
      <p role="status" aria-label="Bench">
        {ready ? 'ready' : 'loading'}
      </p>
      <p>
        <button type="button" onClick={() => moveFocus(far.current)}>
          Move focus far
        </button>{' '}
        <button type="button" onClick={() => moveFocus(covered.current)}>
          Move focus under the bar
        </button>{' '}
        <button type="button" onClick={() => announce('Saved.')}>
          Say saved
        </button>
      </p>
      <p>
        <button type="button" onClick={(e) => moveFocus(nextTabStop(e.currentTarget, 1), 'keyboard')}>
          Step forward
        </button>
        <button type="button" disabled>
          Disabled stop
        </button>
        <button type="button" tabIndex={-1}>
          Not a stop
        </button>
        <button type="button" hidden>
          Hidden stop
        </button>
        <span inert>
          <button type="button">Inert stop</button>
        </span>
        <label>
          <input type="radio" name="r" /> Radio one
        </label>
        <label>
          <input type="radio" name="r" /> Radio two
        </label>
        <button type="button" onClick={(e) => moveFocus(nextTabStop(e.currentTarget, -1), 'keyboard')}>
          Step back
        </button>
      </p>
      <SwapChip />
      <div style={TALL} />
      <HoldTiles />
      <ReturnPanel />
      <label>
        Top field <input className="input" />
      </label>
      <div style={TALL} />
      <p>
        <button type="button" ref={covered}>
          Covered target
        </button>
      </p>
      <div style={TALL} />
      <InViewCounter />
      <p>
        <button type="button" ref={far}>
          Far target
        </button>
      </p>
      <div style={{ height: 200 }} />
      {/* the pinned bar: a fixed .toast (every width) or the pack's sticky send bar (.sbar, phones only) */}
      <div
        className={bar === 'send' ? 'sbar' : 'toast'}
        role="region"
        aria-label="Pinned bar"
        style={bar === 'send' ? { minHeight: 120 } : { bottom: 0, left: 0, minHeight: 120 }}
      >
        Pinned bar
      </div>
    </main>
  );
}
