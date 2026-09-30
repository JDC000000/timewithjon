// src/ui/keep-whole.ts (U1, taken over from U3 src/app/book/[dish]/_lib): the pure half of KeepWhole.tsx (unit-tested).
const MONTH =
  'January|February|March|April|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec';
const DAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),? ';
const CLOCK = '\\d{1,2}(?::\\d\\d)?';
// Order matters (the first alternative that matches at a position wins): a date (optionally after its weekday,
// "Fri May 14" / "Fri, May 14", "Sept 14"), then a time range ending in am/pm ("noon–2 pm", "11 am–2 pm",
// "7:30–9 pm"), then a bare range ("12–2", "1–15": never split after the dash, pr73 F7 / INT-04), then one time.
const WHOLE = new RegExp(
  `(?:${DAY})?(?:${MONTH}) \\d{1,2}(?:–(?:(?:${MONTH}) )?\\d{1,2})?\\b` +
    `|(?:noon|${CLOCK}(?: ?(?:am|pm))?)–${CLOCK} ?(?:am|pm)\\b` +
    `|\\b${CLOCK}–${CLOCK}\\b` +
    `|\\b${CLOCK} (?:am|pm)\\b`,
  'g',
);
const WEEKDAY = new RegExp(`^${DAY}`);

export type Piece = { text: string; whole: boolean; weekday?: string; wbr?: boolean };

/** Splits text into plain runs and the dates/times to keep whole (pure; tested). */
export function splitWhole(text: string): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(WHOLE)) {
    const start = m.index;
    if (start > at) out.push({ text: text.slice(at, start), whole: false });
    const wd = WEEKDAY.exec(m[0]);
    out.push({
      text: wd ? m[0].slice(wd[0].length) : m[0],
      whole: true,
      ...(wd ? { weekday: wd[0] } : {}),
      ...(start > 0 && text[start - 1] === ' ' ? { wbr: true } : {}),
    });
    at = start + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), whole: false });
  return out;
}
