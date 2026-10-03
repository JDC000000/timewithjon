// src/app/admin/(app)/invites/_a5/model.ts — T2.6.U1: the A5 logic. Pure: no reads, no React.
// The "our things" rules are the server's own (ourThingError / OurThings, TSD v1.8), so the sheet refuses exactly
// what POST /api/admin/invites refuses; the preview model is landingModel() itself, so it is the S2 hero verbatim.
import type { Dish } from '@/content';
import type { InviteListItem } from '@/features/admin/invites';
import { landingModel } from '@/features/invites/landing-model';
import { ourThingError, OUR_THINGS_MAX } from '@/features/invites/our-things';
import type { PersonalModel } from '@/app/_landing/PersonalHero';
import { A5 } from './copy';

export const THING_SLOTS = OUR_THINGS_MAX;
export const MAX_WORDS = 4;
export const NAME_MAX = 60;

/** Plain spaces only, as the server trims (a tab stays and is refused). */
const trimSpaces = (s: string) => s.replace(/^ +| +$/g, '');

/** The live "n of 4 words" count for one box. */
export function wordCount(raw: string): number {
  const s = trimSpaces(raw);
  return s ? s.split(/ +/).length : 0;
}

/** One box's problem (null = fine; a blank box is fine: it is dropped). */
export function thingProblem(raw: string): string | null {
  const s = trimSpaces(raw);
  if (!s) return null;
  const code = ourThingError(s);
  return code ? A5.err[code] : null;
}

/** The phrases that get sent: trimmed, blanks dropped (the server drops them too). */
export function keptThings(raw: readonly string[]): string[] {
  return raw.map(trimSpaces).filter((s) => s.length > 0);
}

export interface DishOption {
  slug: string;
  name: string;
  section: Dish['section'];
}

export interface CreateForm {
  name: string;
  things: string[];
  dish: string; // '' = none
  email: string;
  hopedFor: boolean;
}

export type CreateField = 'name' | 'thing0' | 'thing1' | 'thing2' | 'dish' | 'email';
export const thingField = (i: number) => `thing${i}` as CreateField;

// The route's z.email() is the authority; this only catches the obvious slips before the round trip.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BAD_NAME_CHAR = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/u; // = invites.ts

/** The sheet's field errors, in form order ({} = ready to send). */
export function createErrors(f: CreateForm): Partial<Record<CreateField, string>> {
  const out: Partial<Record<CreateField, string>> = {};
  const name = f.name.trim();
  if (!name || name.length > NAME_MAX) out.name = A5.err.name;
  else if (BAD_NAME_CHAR.test(name)) out.name = A5.err.bad_character;
  f.things.forEach((t, i) => {
    const p = thingProblem(t);
    if (p) out[thingField(i)] = p;
  });
  const email = f.email.trim();
  if (email && (!EMAIL.test(email) || email.length > 254)) out.email = A5.err.email;
  return out;
}

/** The POST body (CreateInviteBody). Blank things are dropped here AND on the server. */
export function createBody(f: CreateForm) {
  return {
    name: f.name.trim(),
    ourThings: keptThings(f.things),
    pickedDish: f.dish || null,
    prefillEmail: f.email.trim() || null,
    hopedFor: f.hopedFor,
  };
}

type Issue = { path: string; code: string };
const message = (code: string): string => (A5.err as Record<string, string | undefined>)[code] ?? A5.failed;

/**
 * The server's 400 `issues`, put back on the boxes. `ourThings.N` counts only the kept (non-blank) phrases, so N
 * maps back to the Nth non-blank box.
 */
export function serverErrors(
  issues: Issue[],
  things: readonly string[],
): Partial<Record<CreateField, string>> {
  const kept = things.flatMap((t, i) => (trimSpaces(t) ? [i] : []));
  const out: Partial<Record<CreateField, string>> = {};
  for (const { path, code } of issues) {
    const [head, idx] = path.split('.');
    if (head === 'name') out.name = code === 'bad_character' ? A5.err.bad_character : A5.err.name;
    else if (head === 'pickedDish') out.dish = message(code);
    else if (head === 'prefillEmail') out.email = A5.err.email;
    else if (head === 'ourThings') {
      const box = idx === undefined ? undefined : kept[Number(idx)];
      out[thingField(box ?? 0)] = message(code);
    }
  }
  return out;
}

/** The S2 hero model for the live preview: landingModel() over the invite as it would be saved. */
export function previewModel(f: CreateForm, dishes: readonly DishOption[], now = new Date()): PersonalModel {
  const things = keptThings(f.things).filter((t) => ourThingError(t) === null);
  const m = landingModel(
    {
      state: 'valid',
      invite: {
        id: 'preview',
        kind: 'personal',
        is_test: false,
        name_slug: 'friend',
        display_name: f.name.trim() || A5.previewName,
        our_things: things,
        picked_dish: dishes.some((d) => d.slug === f.dish) ? f.dish : null,
        prefill_name: null,
        prefill_email: null,
        revoked_at: null,
      },
    },
    now,
  );
  if (m.variant !== 'personal') throw new Error('unreachable: a valid personal invite');
  return m;
}

/** The row's meta pieces: opens, request status, flags. */
export function inviteMeta(i: InviteListItem): string[] {
  const out = [i.openCount > 0 ? A5.opens(i.openCount) : A5.notOpened];
  if (i.kind === 'personal') {
    out.push(
      i.requests.latest
        ? `${A5.requests(i.requests.count)}, latest ${i.requests.latest.status}`
        : A5.noRequest,
    );
    if (i.hopedFor) out.push(A5.hoped);
    if (i.dishNotBookable) out.push(A5.dishGone);
  }
  if (i.isTest) out.push(A5.test);
  if (i.revoked) out.push(A5.revoked);
  return out;
}

/** The general link on top (the active one), then personal links; revoked general links are listed with them. */
export function splitInvites(all: InviteListItem[]): {
  general: InviteListItem | null;
  rest: InviteListItem[];
} {
  const general = all.find((i) => i.kind === 'general' && !i.revoked) ?? null;
  return { general, rest: all.filter((i) => i !== general) };
}
