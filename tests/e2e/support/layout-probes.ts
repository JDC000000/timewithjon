// Layout probes for the INT cases: read the live page only (never injected state). Each probe is self-contained
// because Playwright serialises it into the page.

/**
 * INT-02: a row of controls re-lays out cleanly. `lines` (tiles): every control in a visual row has the same number
 * of text lines (no mixed stacked / one-line tiles). `firstLine` (month tabs, VD9-04 TABLINE): every name in a row
 * starts on the same line. Both: no separator dot ("·") sits alone on a line.
 */
export function rowProblems(elements: Element[], rule: 'lines' | 'firstLine'): string[] {
  // The text a person sees: skips visually hidden text (the .vh pattern: a clipped 1 px box).
  const boxes = (el: Element): { text: string; top: number }[] => {
    const out: { text: string; top: number }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue?.trim();
      if (!text) continue;
      let hidden = false;
      for (let a = node.parentElement; a && a !== el.parentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (
          cs.clip !== 'auto' ||
          cs.clipPath !== 'none' ||
          (cs.display !== 'inline' && a.clientWidth <= 1 && a.clientHeight <= 1)
        )
          hidden = true;
      }
      if (hidden) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width) out.push({ text, top: rect.top });
    }
    return out;
  };
  const lines = (el: Element): number[] => {
    const tops: number[] = [];
    for (const box of boxes(el)) if (!tops.some((top) => Math.abs(top - box.top) <= 2)) tops.push(box.top);
    return tops;
  };
  const strayDot = (el: Element): boolean => {
    const all = boxes(el);
    return all.some(
      (b) => b.text === '·' && !all.some((o) => o.text !== '·' && Math.abs(o.top - b.top) <= 2),
    );
  };
  const shown = elements.filter((el) => el.getClientRects().length > 0);
  const rows: Element[][] = [];
  for (const el of shown) {
    const top = el.getBoundingClientRect().top;
    const row = rows.find((r) => r[0] && Math.abs(r[0].getBoundingClientRect().top - top) <= 4);
    if (row) row.push(el);
    else rows.push([el]);
  }
  const problems: string[] = [];
  const name = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
  for (const row of rows) {
    if (rule === 'lines') {
      const counts = row.map((el) => lines(el).length);
      if (new Set(counts).size > 1) {
        problems.push(
          `mixed line counts in a row: ${row.map((el, i) => `${name(el)}=${counts[i]}`).join(' / ')}`,
        );
      }
    } else {
      const firsts = row.map((el) => Math.min(...lines(el)));
      if (Math.max(...firsts) - Math.min(...firsts) > 1) {
        problems.push(
          `names off one line: ${row.map((el, i) => `${name(el)}@${Math.round(firsts[i] ?? 0)}`).join(' / ')}`,
        );
      }
    }
  }
  for (const el of shown) if (strayDot(el)) problems.push(`a separator alone on a line in "${name(el)}"`);
  return problems;
}

/** INT-05: for each picked tile, the gap (px) between its tick (its text-less icon) and its label text; < 1 = touching. */
export function tickGaps(tiles: Element[]): { tile: string; gap: number | null }[] {
  return tiles.map((tile) => {
    const tileName = tile.getAttribute('aria-label') ?? (tile.textContent ?? '').trim();
    const icon = [...tile.querySelectorAll('svg, [aria-hidden="true"]')].find(
      (el) => !(el.textContent ?? '').trim() && el.getClientRects().length > 0,
    );
    if (!icon) return { tile: tileName, gap: null };
    const t = icon.getBoundingClientRect();
    let gap = Infinity;
    const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim() || icon.contains(node)) continue;
      // Visually hidden text (the .vh pattern: a clipped 1 px box) is not part of the label a person sees.
      let hidden = false;
      for (let a = node.parentElement; a && a !== tile.parentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (
          cs.clip !== 'auto' ||
          cs.clipPath !== 'none' ||
          (cs.display !== 'inline' && a.clientWidth <= 1 && a.clientHeight <= 1)
        )
          hidden = true;
      }
      if (hidden) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (!r.width) continue;
        const dx = Math.max(r.left - t.right, t.left - r.right);
        const dy = Math.max(r.top - t.bottom, t.top - r.bottom);
        gap = Math.min(gap, Math.max(dx, dy));
      }
    }
    return { tile: tileName, gap: gap === Infinity ? null : Math.round(gap * 10) / 10 };
  });
}

/** INT-04: date words (month / weekday names, day numbers) broken across two lines. */
export function splitDateWords(): string[] {
  const DATE =
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun)[a-z]*[,.]?$|^\d{1,2}(–\d{1,2})?[,.]?$/i;
  const out: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    for (const match of text.matchAll(/\S+/g)) {
      if (!DATE.test(match[0])) continue;
      const range = document.createRange();
      range.setStart(node, match.index ?? 0);
      range.setEnd(node, (match.index ?? 0) + match[0].length);
      const tops = new Set([...range.getClientRects()].filter((r) => r.width).map((r) => Math.round(r.top)));
      if (tops.size > 1) out.push(match[0]);
    }
  }
  return out;
}

/** INT-09: controls whose centre is on screen but under another element (other than their own box). */
export function coveredControls(elements: Element[]): string[] {
  const out: string[] = [];
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !el.contains(hit) && !hit.contains(el)) {
      const name = (e: Element) =>
        (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
      out.push(`"${name(el)}" under "${name(hit)}"`);
    }
  }
  return out;
}
