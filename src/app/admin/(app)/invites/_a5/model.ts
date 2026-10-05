// src/app/admin/(app)/invites/_a5/model.ts — T2.6.U1: the A5 logic. Pure: no reads, no React.
// The preview model is landingModel() itself, so it is the S2 hero verbatim. Jon (2026-10-05): the hero line is the
// same for everyone, so the sheet no longer asks for "our things" (the API still accepts the field; none is sent).
import type { Dish } from '@/content';
import { INBOX } from '@/content/ui/admin-requests';
import type { InviteListItem } from '@/features/admin/invites';
import type { RequestStatus } from '@/features/availability/types';
import { landingModel } from '@/features/invites/landing-model';
import type { PersonalModel } from '@/app/_landing/PersonalHero';
import { A5 } from './copy';

export const NAME_MAX = 60;

export interface DishOption {
  slug: string;
  name: string;
  section: Dish['section'];
}

export interface CreateForm {
  name: string;
  dish: string; // '' = none
  email: string;
  hopedFor: boolean;
}

export type CreateField = 'name' | 'dish' | 'email';

// The route's z.email() is the authority; this only catches the obvious slips before the round trip.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BAD_NAME_CHAR = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/u; // = invites.ts

/** The sheet's field errors, in form order ({} = ready to send). */
export function createErrors(f: CreateForm): Partial<Record<CreateField, string>> {
  const out: Partial<Record<CreateField, string>> = {};
  const name = f.name.trim();
  if (!name || name.length > NAME_MAX) out.name = A5.err.name;
  else if (BAD_NAME_CHAR.test(name)) out.name = A5.err.bad_character;
  const email = f.email.trim();
  if (email && (!EMAIL.test(email) || email.length > 254)) out.email = A5.err.email;
  return out;
}

/** The POST body (CreateInviteBody; its ourThings defaults to none). */
export function createBody(f: CreateForm) {
  return {
    name: f.name.trim(),
    pickedDish: f.dish || null,
    prefillEmail: f.email.trim() || null,
    hopedFor: f.hopedFor,
  };
}

type Issue = { path: string; code: string };
const message = (code: string): string => (A5.err as Record<string, string | undefined>)[code] ?? A5.failed;

/** The server's 400 `issues`, put back on their boxes. */
export function serverErrors(issues: Issue[]): Partial<Record<CreateField, string>> {
  const out: Partial<Record<CreateField, string>> = {};
  for (const { path, code } of issues) {
    const [head] = path.split('.');
    if (head === 'name') out.name = code === 'bad_character' ? A5.err.bad_character : A5.err.name;
    else if (head === 'pickedDish') out.dish = message(code);
    else if (head === 'prefillEmail') out.email = A5.err.email;
  }
  return out;
}

/** The S2 hero model for the live preview: landingModel() over the invite as it would be saved. */
export function previewModel(f: CreateForm, dishes: readonly DishOption[], now = new Date()): PersonalModel {
  const m = landingModel(
    {
      state: 'valid',
      invite: {
        id: 'preview',
        kind: 'personal',
        is_test: false,
        name_slug: 'friend',
        display_name: f.name.trim() || A5.previewName,
        our_things: [],
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

/** QA L3: a request status as the inbox filter that holds it (the admin's own words, never the raw value). */
const STATUS_LABEL: Record<RequestStatus, string> = {
  requested: INBOX.filters.needs,
  needs_new_time: INBOX.filters.waiting,
  standby: INBOX.filters.standby,
  locked: INBOX.filters.locked,
  done: INBOX.filters.done,
  cancelled: INBOX.filters.cancelled,
};

/** The row's meta pieces: opens, the request count and the latest request's status, flags. */
export function inviteMeta(i: InviteListItem): string[] {
  const out = [i.openCount > 0 ? A5.opens(i.openCount) : A5.notOpened];
  if (i.kind === 'personal') {
    const latest = i.requests.latest;
    out.push(...(latest ? [A5.requests(i.requests.count), STATUS_LABEL[latest.status]] : [A5.noRequest]));
    if (i.hopedFor) out.push(A5.hopedFor);
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
