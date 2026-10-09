// src/features/invites/manage-model.ts — T2.7.03 read-only loaders for the token pages: S17 manage, and the
// S18 offer and new-date pages. Every token link is a GET that renders a page with NO side effects (T2.7 AC1,
// N2): these functions only SELECT (never spend a token, record an open or lazily write "done"), so a GET, a HEAD
// or a link scanner's prefetch changes nothing. Actions happen only through the POST routes.
// A tampered token → 'not_found' (the page calls notFound(), AC4); an expired one → the friendly "text me" line
// (AC3); a spent single-use token, or an offer that has gone → the request's current state (AC2).
// S17 shows a Surprise Me guest their OWN plan (TSD §4.8 S17, C4): only to the holder of that request's manage
// token, and never to admin code, email, calendar or export (tests/unit/sealed-plan-static.test.ts).
import 'server-only';
import { ALREADY, CLOSED_IN_PERSON_LABEL, ERRORS, GUEST_LABEL, JON_CANCELLED_LABEL } from '@/content';
import { dishBySlug } from '@/content/menu-helpers';
import type { RequestStatus } from '@/features/availability/types';
import { q } from '@/lib/db';
import { hasStarted, isJonCancelled } from '@/features/requests/guest-cancel';
import { guestWhen } from '@/lib/when';
import { findToken, tokenState, type ActionToken, type TokenPurpose } from './action-tokens';

export type Missing = { kind: 'not_found' } | { kind: 'expired'; message: string };

export interface RequestView {
  requestId: string;
  dish: { slug: string; name: string };
  status: RequestStatus; // lazily 'done' once the (host's) end has passed
  label: string; // the guest label (§6 "Guest labels")
  when: string | null; // "Thu May 13 · noon–2 pm" when it has a time (QA C: as the site writes it)
  where: string | null;
}

export type ManageModel =
  | Missing
  | (RequestView & {
      kind: 'manage';
      ownPlan: string | null; // Surprise Me only: the guest's own sealed plan, back to its owner
      /** Pitch Me only (EML-05): the guest's own pitch and rough "when", to start the shorter version from. */
      ownPitch: { idea: string; when: string } | null;
      canCancel: boolean;
      canAskAnother: boolean;
      canAddStory: boolean;
      /** QA4b M3: the booking they joined fell through (the host left, rule 4): nothing of theirs is booked or asked. */
      hostLeft: boolean;
      /** r5 N-L7: they said it's one night away: the new-time form starts ticked. */
      overnight: boolean;
    });

export interface OfferWindow {
  slotId: string | null;
  startsAt: Date;
  endsAt: Date;
  label: string;
}
export type OfferModel =
  | Missing
  | (RequestView & { kind: 'current'; message: string | null })
  | (RequestView & { kind: 'offer'; offerId: string; offerKind: string; windows: OfferWindow[] });
export type NewDateModel =
  | Missing
  | (RequestView & { kind: 'current'; message: string | null })
  | (RequestView & {
      kind: 'new_date';
      offerId: string | null;
      /** r5 N-L7: starts ticked */ overnight: boolean;
    });

interface Row {
  status: RequestStatus;
  dish: string;
  closed_in_person: boolean;
  cancelled_by: 'guest' | 'jon' | null;
  guest_time_zone: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  where_text: string | null;
  own_plan: string | null;
  own_pitch: string | null;
  own_when: string | null;
  joined_to_request_id: string | null;
  overnight: boolean;
}

async function loadView(
  requestId: string,
  now: Date,
  withPlan: boolean,
): Promise<{
  view: RequestView;
  ownPlan: string | null;
  ownPitch: { idea: string; when: string } | null;
  tz: string | null;
  jonCancelled: boolean;
  started: boolean;
  hostLeft: boolean;
  overnight: boolean;
} | null> {
  const [r] = await q<Row>(
    `select r.status, r.dish, r.closed_in_person, r.cancelled_by::text as cancelled_by, r.guest_time_zone,
            case when r.joined_to_request_id is null then r.locked_starts_at else h.locked_starts_at end as starts_at,
            case when r.joined_to_request_id is null then r.locked_ends_at else h.locked_ends_at end as ends_at,
            case when r.joined_to_request_id is null then r.locked_where else h.locked_where end as where_text,
            case when $2 then r.surprise_plan_sealed end as own_plan,
            case when $2 then r.pitch_idea end as own_pitch,
            case when $2 then r.date_prefs->>'window_text' end as own_when, r.joined_to_request_id, r.overnight
       from request r left join request h on h.id = r.joined_to_request_id
      where r.id = $1`,
    [requestId, withPlan],
  );
  if (!r) return null;
  const dish = dishBySlug(r.dish);
  const status: RequestStatus = r.status === 'locked' && r.ends_at && r.ends_at <= now ? 'done' : r.status;
  const timed = (status === 'locked' || status === 'done') && r.starts_at;
  const view: RequestView = {
    requestId,
    dish: { slug: r.dish, name: dish?.name ?? r.dish },
    status,
    label: status === 'cancelled' ? cancelledLabel(r) : GUEST_LABEL[status],
    when: timed && r.ends_at ? guestWhen(r.starts_at!, r.ends_at, r.guest_time_zone) : null,
    where: timed ? r.where_text : null,
  };
  return {
    view,
    ownPlan: dish?.flow === 'surprise' ? r.own_plan : null,
    ownPitch: dish?.flow === 'pitch' && r.own_pitch ? { idea: r.own_pitch, when: r.own_when ?? '' } : null,
    tz: r.guest_time_zone,
    jonCancelled: isJonCancelled(r),
    started: hasStarted(r, now),
    // A joined guest whose host left (rule 4) still names it, and waits on Jon for a new time.
    hostLeft: r.status === 'needs_new_time' && r.joined_to_request_id !== null,
    overnight: r.overnight,
  };
}

function cancelledLabel(r: Pick<Row, 'status' | 'cancelled_by' | 'closed_in_person'>): string {
  if (r.closed_in_person) return CLOSED_IN_PERSON_LABEL;
  return isJonCancelled(r) ? JON_CANCELLED_LABEL : GUEST_LABEL.cancelled;
}

/** The token for this page, or why there's nothing to show. A token of another purpose is as good as none. */
async function tokenFor(
  raw: string | null | undefined,
  purpose: TokenPurpose,
  now: Date,
): Promise<ActionToken | Missing> {
  const t = await findToken(raw);
  if (!t || t.purpose !== purpose) return { kind: 'not_found' };
  if (tokenState(t, now) === 'expired') return { kind: 'expired', message: ERRORS.stale };
  return t;
}
const isMissing = (x: ActionToken | Missing): x is Missing => 'kind' in x;

export async function loadManageModel(
  raw: string | null | undefined,
  now = new Date(),
): Promise<ManageModel> {
  const t = await tokenFor(raw, 'manage', now);
  if (isMissing(t)) return t;
  const loaded = await loadView(t.request_id, now, true);
  if (!loaded) return { kind: 'not_found' };
  const v = loaded.view;
  // ENG-13: under way (its start passed) = no Cancel and no Ask for another time; the page just reads Locked in.
  const open = ['requested', 'needs_new_time', 'standby', 'locked'].includes(v.status) && !loaded.started;
  return {
    kind: 'manage',
    ...v,
    ownPlan: loaded.ownPlan,
    ownPitch: loaded.ownPitch,
    canCancel: open,
    // 2026-10-05: after Jon cancelled for them, the guest can send new times (rerequest takes it back to Jon).
    canAskAnother: open || loaded.jonCancelled,
    canAddStory: true,
    hostLeft: loaded.hostLeft,
    overnight: loaded.overnight,
  };
}

/**
 * A spent token, or an offer that has gone: what the guest sees instead (§14.4 S18 lines). null = the guest's own
 * new times are with Jon (`requested`, e.g. right after their Send on this page): the page shows the "Sent" state
 * with what they sent, as /manage does after "Ask for another time" (QA r2 M1), not "Looks like that one went".
 */
function currentMessage(v: RequestView): string | null {
  if (v.status === 'locked' && v.when) return ALREADY.lockedIn(v.when);
  if (v.status === 'cancelled') {
    if (v.label === CLOSED_IN_PERSON_LABEL) return v.label;
    // Q7 (approved: Jon 2026-10-09): after Jon cancelled, the heading "Cancelled, no problem" says it all; the
    // guest didn't cancel, so no "Already cancelled. No guilt." under it ('' = no line). A guest's own cancel keeps it.
    return v.label === JON_CANCELLED_LABEL ? '' : ALREADY.cancelled;
  }
  if (v.status === 'done') return v.label;
  if (v.status === 'requested') return null;
  return ERRORS.offerGone;
}

interface OfferRow {
  id: string;
  kind: string;
  slot_ids: string[];
  ranges: { starts_at: string; ends_at: string }[];
  expires_at: Date | null;
  taken_at: Date | null;
  released_at: Date | null;
}

async function liveOffer(offerId: string | null, now: Date): Promise<OfferRow | null> {
  if (!offerId) return null;
  const [o] = await q<OfferRow>(
    `select id, kind, slot_ids, ranges, expires_at, taken_at, released_at from offer where id = $1`,
    [offerId],
  );
  const live = o && !o.taken_at && !o.released_at && (!o.expires_at || o.expires_at > now);
  return live ? o : null;
}

async function offerWindows(o: OfferRow, guestTimeZone: string | null): Promise<OfferWindow[]> {
  const slots = o.slot_ids.length
    ? await q<{ id: string; starts_at: Date; ends_at: Date }>(
        `select id, starts_at, ends_at from slot where id = any($1::uuid[]) order by starts_at`,
        [o.slot_ids],
      )
    : [];
  const label = (s: Date, e: Date) => guestWhen(s, e, guestTimeZone);
  return [
    ...slots.map((s) => ({
      slotId: s.id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      label: label(s.starts_at, s.ends_at),
    })),
    ...o.ranges.map((r) => {
      const startsAt = new Date(r.starts_at);
      const endsAt = new Date(r.ends_at);
      return { slotId: null, startsAt, endsAt, label: label(startsAt, endsAt) };
    }),
  ];
}

/** S18 take an offered time or a stand-by offer (purpose take_offer). */
export async function loadOfferModel(raw: string | null | undefined, now = new Date()): Promise<OfferModel> {
  const t = await tokenFor(raw, 'take_offer', now);
  if (isMissing(t)) return t;
  const loaded = await loadView(t.request_id, now, false);
  if (!loaded) return { kind: 'not_found' };
  const { view } = loaded;
  const o = tokenState(t, now) === 'used' ? null : await liveOffer(t.offer_id, now);
  if (!o) return { kind: 'current', ...view, message: currentMessage(view) };
  return {
    kind: 'offer',
    ...view,
    offerId: o.id,
    offerKind: o.kind,
    windows: await offerWindows(o, loaded.tz),
  };
}

/** S18 pick a new date after a weather call (purpose pick_new_date). */
export async function loadNewDateModel(
  raw: string | null | undefined,
  now = new Date(),
): Promise<NewDateModel> {
  const t = await tokenFor(raw, 'pick_new_date', now);
  if (isMissing(t)) return t;
  const loaded = await loadView(t.request_id, now, false);
  if (!loaded) return { kind: 'not_found' };
  const { view } = loaded;
  const live = tokenState(t, now) !== 'used' && view.status === 'needs_new_time';
  if (!live) return { kind: 'current', ...view, message: currentMessage(view) };
  return { kind: 'new_date', ...view, offerId: t.offer_id, overnight: loaded.overnight };
}
