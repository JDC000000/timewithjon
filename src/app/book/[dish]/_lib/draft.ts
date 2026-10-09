// The booking form's draft (QA M3): what the guest picked and typed on /book/<dish>, kept in sessionStorage (this tab
// only; gone when the tab closes) so a reload or Back doesn't wipe it, and cleared after a saved Send. One key per
// dish. Never localStorage, never the URL, never logged; never the honeypot or a Turnstile token. A draft that
// doesn't parse is dropped; each flow drops what is no longer offered when it restores (useDraft.ts).
// Checked by hand, not with Zod: this file runs in the browser on /book, and Zod would add ~100 KB (gzip) of script to
// the page before its photo paints (Lighthouse LCP and TBT). The rules match the server's habit: a field is absent or
// of its type and length, unknown keys are dropped, and anything else drops the whole draft.

/** each field: a string of at most `max` characters (`null` too where nullable), a boolean, or a list of strings */
const FIELDS = {
  /** BookingFlow: picked slot ids (tap order) or one stand-by week; Surprise Me's two notes */
  picks: { list: 50, max: 100 },
  standbyWeek: { max: 10, nullable: true },
  need: { max: 1000 },
  plan: { max: 2000 },
  /** DatesFlow: picked dates, the rough window, overnight, the Long Distance zone option */
  dates: { list: 2, max: 10 },
  rough: { max: 200 },
  roughOpen: { bool: true },
  overnight: { bool: true },
  zone: { max: 100, nullable: true },
  /** PitchFlow: the idea, when, which night */
  idea: { max: 2000 },
  when: { max: 200 },
  night: { max: 200 },
  /** the details (a personal invite's arrive filled in); crew = the stepper's number as text (Q9) */
  crew: { max: 2 },
  name: { max: 80 },
  email: { max: 254 },
} as const satisfies Record<string, { max?: number; list?: number; nullable?: true; bool?: true }>;

export type Draft = {
  picks?: string[];
  standbyWeek?: string | null;
  need?: string;
  plan?: string;
  dates?: string[];
  rough?: string;
  roughOpen?: boolean;
  overnight?: boolean;
  zone?: string | null;
  idea?: string;
  when?: string;
  night?: string;
  crew?: string;
  name?: string;
  email?: string;
};

const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** The draft's known fields from `value`, or null when any of them is the wrong type or too long (or it isn't an object). */
export function parseDraft(value: unknown): Draft | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(FIELDS) as [
    string,
    { max?: number; list?: number; nullable?: true; bool?: true },
  ][]) {
    const v = input[key];
    if (v === undefined) continue;
    const ok = rule.bool
      ? typeof v === 'boolean'
      : rule.list !== undefined
        ? Array.isArray(v) && v.length <= rule.list && v.every((x) => isText(x, rule.max!))
        : (rule.nullable && v === null) || isText(v, rule.max!);
    if (!ok) return null;
    out[key] = Array.isArray(v) ? [...v] : v;
  }
  return out as Draft;
}

export const draftKey = (dish: string) => `twj_draft:${dish}`;

/** sessionStorage, or null where it can't be used (blocked storage, private modes that throw). */
export function draftStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readDraft(store: Storage | null, dish: string): Draft | null {
  try {
    const raw = store?.getItem(draftKey(dish));
    if (!raw) return null;
    return parseDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeDraft(store: Storage | null, dish: string, draft: Draft): void {
  try {
    const clean = parseDraft(draft);
    if (clean) store?.setItem(draftKey(dish), JSON.stringify(clean));
  } catch {
    // Full or blocked storage: the form still works, it just isn't kept.
  }
}

export function clearDraft(store: Storage | null, dish: string): void {
  try {
    store?.removeItem(draftKey(dish));
  } catch {
    // as writeDraft
  }
}
