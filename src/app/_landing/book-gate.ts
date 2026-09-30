// src/app/_landing/book-gate.ts — what stands where a Book button would be (wireframe 04 E, S16; T1.2.U3).
// Pure: the page loads the session (and the settings, for a valid invite) and passes them in.
import { formatInTimeZone } from 'date-fns-tz';
import { ERRORS, FLOW, type Dish } from '@/content';
import { isBookable } from '@/content/menu-helpers';
import type { InviteSession } from '@/features/invites/session';
import { isReleased, opensAt } from '@/features/invites/release';
import type { SettingsRow } from '@/lib/settings';
import { TZ } from '@/lib/time';

export type BookGate = { kind: 'book' } | { kind: 'note'; text: string } | { kind: 'off' };
export type ReleaseTimes = Pick<SettingsRow, 'personal_open_at' | 'general_open_at'>;

/**
 * off · the dish itself can't be booked (the Bluebird while BLUEBIRD_BOOKABLE is false, or past its last day): no Book
 * and no note, whoever asks (its row shows the dish's own detail line).
 * a · a valid invite whose booking has opened: Book. b · a valid invite before its release: "Booking opens {date}."
 * c · no invite (a bare URL): the no-invite line. d · a stale, revoked or rotated link (S16): the stale line.
 * The route handlers enforce the same rules (requireInvite, POST /api/requests); this only decides the words.
 */
export function bookGate(
  session: InviteSession,
  release: ReleaseTimes | null,
  now = new Date(),
  dish?: Dish,
): BookGate {
  if (dish && !isBookable(dish, now)) return { kind: 'off' };
  if (session.state === 'stale') return { kind: 'note', text: ERRORS.stale };
  if (session.state === 'none') return { kind: 'note', text: ERRORS.noInvite };
  const kind = session.invite.kind;
  if (release && !isReleased(kind, release, now))
    return { kind: 'note', text: FLOW.opensOn(formatInTimeZone(opensAt(kind, release), TZ, 'MMMM d')) };
  return { kind: 'book' };
}
