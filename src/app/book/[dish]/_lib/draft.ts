// The booking form's draft (QA M3): what the guest picked and typed on /book/<dish>, kept in sessionStorage (this tab
// only; gone when the tab closes) so a reload or Back doesn't wipe it, and cleared after a saved Send. One key per
// dish. Never localStorage, never the URL, never logged; never the honeypot or a Turnstile token. A draft that
// doesn't parse is dropped; each flow drops what is no longer offered when it restores (useDraft.ts).
import { z } from 'zod';

const text = (max: number) => z.string().max(max).optional();

export const Draft = z.object({
  /** BookingFlow: picked slot ids (tap order) or one stand-by week; Surprise Me's two notes */
  picks: z.array(z.string().max(100)).max(50).optional(),
  standbyWeek: z.string().max(10).nullable().optional(),
  need: text(1000),
  plan: text(2000),
  /** DatesFlow: picked dates, the rough window, overnight, the Long Distance zone option */
  dates: z.array(z.string().max(10)).max(2).optional(),
  rough: text(200),
  roughOpen: z.boolean().optional(),
  overnight: z.boolean().optional(),
  zone: z.string().max(100).nullable().optional(),
  /** PitchFlow: the idea, when, which night */
  idea: text(2000),
  when: text(200),
  night: text(200),
  /** the details (a personal invite's arrive filled in) */
  name: text(80),
  email: text(254),
});
export type Draft = z.infer<typeof Draft>;

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
    const parsed = Draft.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeDraft(store: Storage | null, dish: string, draft: Draft): void {
  try {
    store?.setItem(draftKey(dish), JSON.stringify(Draft.parse(draft)));
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
