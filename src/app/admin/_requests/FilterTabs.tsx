'use client';
// src/app/admin/_requests/FilterTabs.tsx — A2's filter row (pack a2): an APG tab list over the six panels, roving
// tabindex, Arrow/Home/End select and focus (automatic activation), a click selects. The filter lives in the URL
// hash (`/admin#locked`, the pack's deep link), so Back from a request returns to the same filter. The row sits in
// a horizontal scroller; the global keep-visible rule brings a keyboard-focused tab into view (FOC-06).
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { moveFocus } from '@/ui/focus';
import type { FilterKey } from './rows';

export interface FilterTab {
  key: FilterKey;
  label: string;
  count: number;
  panel: ReactNode;
}

/** `head` is the pane's top (the h1, meter, Check these); the pack puts the tab row under it, in the same padding. */
export function FilterTabs({
  head,
  tabs,
  label,
  initial,
}: {
  head: ReactNode;
  tabs: FilterTab[];
  label: string;
  initial: FilterKey;
}) {
  const [selected, setSelected] = useState<FilterKey>(initial);
  const buttons = useRef(new Map<FilterKey, HTMLButtonElement>());

  // A deep link (#locked) picks its filter on arrival and on hash changes (e.g. A3's "‹ Locked in").
  useEffect(() => {
    const fromHash = () => {
      const k = window.location.hash.slice(1);
      if (tabs.some((t) => t.key === k)) setSelected(k as FilterKey);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [tabs]);

  /** Keys move focus as 'keyboard' (kept in view, FOC-06); a click as 'pointer' (never scrolled under the press, INT-07). */
  const select = (k: FilterKey, via: 'keyboard' | 'pointer') => {
    setSelected(k);
    // replaceState: switching filters isn't a history step; Back still leaves the inbox in one press.
    window.history.replaceState(window.history.state, '', `#${k}`);
    moveFocus(buttons.current.get(k) ?? null, via);
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = tabs.length;
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (i + 1) % n
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    select(tabs[to]!.key, 'keyboard');
  };

  return (
    <>
      <div className="pane-pad">
        {head}
        <div className="filters scroller" role="tablist" aria-label={label}>
          {tabs.map((t, i) => {
            const on = t.key === selected;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`ft-${t.key}`}
                aria-controls={`fp-${t.key}`}
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                ref={(el) => {
                  if (el) buttons.current.set(t.key, el);
                  else buttons.current.delete(t.key);
                }}
                onClick={() => select(t.key, 'pointer')}
                onKeyDown={(e) => onKey(e, i)}
              >
                {t.label}
                <span className="n" data-cnt={t.key}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {tabs.map((t) => (
        <div
          key={t.key}
          role="tabpanel"
          id={`fp-${t.key}`}
          aria-labelledby={`ft-${t.key}`}
          hidden={t.key !== selected}
        >
          {t.panel}
        </div>
      ))}
    </>
  );
}
