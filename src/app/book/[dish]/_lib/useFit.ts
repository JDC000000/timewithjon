'use client';
// Two layout checks from the pack's site.js, re-run on resize, a text-size change and when the fonts land; never
// while a pointer is pressed (whenFree), so the element under a pending click is never moved (INT-06).
//  - useTabStack (VD10-07, VD11-02): month tabs that can't fit one row stack. Measured with the WIDEST labels
//    (every month showing "· N picked", N = its number of times), so a pick never flips the layout (INT-01).
//  - useTileStack (VD7-02, INT-02): if any tile label in a month would wrap, every tile of that month stacks
//    (day over time), so a row never mixes stacked and one-line tiles.
// They only toggle data attributes React doesn't render (data-tabstack / data-stack), after measuring.
import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { onTextSize, whenFree } from '@/ui/focus';
import { PICKER } from '@/content/ui/booking';

function useRemeasure(measure: () => void, observe: RefObject<HTMLElement | null>, deps: unknown[]) {
  useLayoutEffect(measure, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => whenFree(measure));
    };
    window.addEventListener('resize', soon);
    const offText = onTextSize(soon);
    void document.fonts?.ready.then(soon);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon);
    if (observe.current) ro?.observe(observe.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', soon);
      offText();
      ro?.disconnect();
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useTabStack(list: RefObject<HTMLElement | null>, maxPerTab: readonly number[]) {
  useRemeasure(
    () => {
      const l = list.current;
      if (!l) return;
      l.removeAttribute('data-tabstack');
      const tabs = Array.from(l.querySelectorAll<HTMLElement>('[role="tab"]'));
      const probes: { probe: HTMLElement; shown: HTMLElement | null }[] = [];
      tabs.forEach((t, i) => {
        const max = maxPerTab[i] ?? 0;
        if (!max) return;
        const shown = t.querySelector<HTMLElement>('.tc');
        const probe = document.createElement('span');
        probe.className = 'tc';
        probe.innerHTML = '<span class="tsep vh"> · </span><span class="tcn"></span>';
        (probe.lastChild as HTMLElement).textContent = PICKER.monthPicked(max);
        if (shown) shown.style.display = 'none';
        t.appendChild(probe);
        probes.push({ probe, shown });
      });
      const tops = new Set(
        tabs.filter((t) => t.getClientRects().length).map((t) => Math.round(t.getBoundingClientRect().top)),
      );
      probes.forEach(({ probe, shown }) => {
        probe.remove();
        if (shown) shown.style.display = '';
      });
      if (tops.size > 1) l.setAttribute('data-tabstack', '');
    },
    list,
    [list, maxPerTab.join(',')],
  );
}

export function useTileStack(panel: RefObject<HTMLElement | null>, shown: boolean) {
  useRemeasure(
    () => {
      const p = panel.current;
      if (!p || !shown) return;
      const grids = Array.from(p.querySelectorAll<HTMLElement>('.tiles'));
      grids.forEach((g) => g.removeAttribute('data-stack'));
      const fits = grids.every((g) =>
        Array.from(g.querySelectorAll<HTMLElement>('.tile')).every((t) => {
          const a = t.querySelector('.tw');
          const b = t.querySelector('.tt');
          return (
            !a ||
            !b ||
            !t.getClientRects().length ||
            Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 2
          );
        }),
      );
      if (!fits) grids.forEach((g) => g.setAttribute('data-stack', ''));
    },
    panel,
    [panel, shown],
  );
}
