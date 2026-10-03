// src/app/admin/(app)/requests/_check/landing.ts — T2.9.U2 (wireframe 09 n15): after a confirmed delete, focus goes
// to the next row, or to the list caption when none is left. The detail pane picks the target before it navigates
// (the rows are in the DOM then); CheckLanding, in the Check these list, takes it once after the list renders.
// A module value is enough: the navigation is client-side, so the same JS runtime reads it.

/** The id of the "Requests · Check these" caption (the landing when no row is left). */
export const CHECK_CAPTION_ID = 'check-these-caption';
const ROW = 'a[href^="/admin/requests/"]';

/** undefined = nothing pending; null = the caption; a string = that row's href. */
let pending: string | null | undefined;

/** The row after the current one (else the one before it), or null when it is the only row. */
export function nextRowHref(doc: Document = document): string | null {
  const li = doc.querySelector(`${ROW}[aria-current="page"]`)?.closest('li');
  const near = [li?.nextElementSibling, li?.previousElementSibling];
  for (const el of near) {
    const href = el?.querySelector(ROW)?.getAttribute('href');
    if (href) return href;
  }
  return null;
}

export function setLanding(href: string | null): void {
  pending = href;
}

/** Takes (and clears) the pending landing element, if any. */
export function takeLanding(doc: Document = document): HTMLElement | null | undefined {
  if (pending === undefined) return undefined;
  const href = pending;
  pending = undefined;
  const row = href ? doc.querySelector<HTMLElement>(`${ROW}[href="${href}"]`) : null;
  return row ?? doc.getElementById(CHECK_CAPTION_ID);
}
