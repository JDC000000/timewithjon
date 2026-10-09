// /book/[dish] view model (T1.5.U1, T1.5.U4): what the page shows around the picker, from the dish and the C3
// engine output. Pure and serialisable: the server page builds it, the client flow renders it. Client code imports
// this module, so it uses the browser-safe date helpers in src/lib/civil.ts, never date-fns.
import { FLOW, SECTIONS, type DateRule, type Dish, type Flow } from '@/content';
import { crewRange, type CrewRange } from '@/content/menu-helpers';
import type { EngineOutput } from '@/features/availability/types';
import type { Invite } from '@/features/invites/repo';
import { civilDateIn, monthDay, monthNameDay } from '@/lib/civil';
import { TZ } from '@/lib/tz';

/** The dish as the client flow needs it (no server-only fields). */
export interface DishView {
  slug: string;
  name: string;
  /** "Mains", the course the dish sits in. */
  course: string;
  detail: string;
  /** The menu line (Pitch Me's lead). */
  line: string;
  flow: Flow;
  dateRule: DateRule | null;
  overnightAllowed: boolean;
  suggestions: string[];
  /** Pitch Me's line before the starters ("You choose."); null for every other dish. */
  suggestionsLead: string | null;
  /** The Long Distance asks for the guest's time zone (T1.6.U2, TSD M2). */
  asksTimeZone: boolean;
  /** How many may come (Q9): min = max means the screens don't ask. */
  crew: CrewRange;
}

export interface FlowNotices {
  /** FLOW.away(...): "I’m away until May 3. I’ll confirm by May 5." */
  away: string | null;
  /** FLOW.opensOn(...): before the invite's release time the flow shows only this line. */
  opensOn: string | null;
}

/** Who is sending (T1.7.U4): a personal invite's name and email arrive filled in (still editable); a general
 * invite starts blank and carries the Turnstile check (AD-9). No site key (local, mock mode) = no widget. */
export interface GuestView {
  name: string;
  email: string;
  general: boolean;
  siteKey?: string;
}

export const NO_GUEST: GuestView = { name: '', email: '', general: false };

export function guestView(
  invite: Pick<Invite, 'kind' | 'prefill_name' | 'prefill_email'>,
  siteKey: string | undefined,
  /** The session was just switched to this invite from another one (session.ts SWITCHED_COOKIE): no prefill. */
  switched = false,
): GuestView {
  const personal = invite.kind === 'personal';
  const prefill = personal && !switched;
  return {
    name: (prefill && invite.prefill_name) || '',
    email: (prefill && invite.prefill_email) || '',
    general: !personal,
    ...(personal || !siteKey ? {} : { siteKey }),
  };
}

export function dishView(d: Dish): DishView {
  return {
    slug: d.slug,
    name: d.name,
    course: SECTIONS.find((s) => s.id === d.section)?.title ?? '',
    detail: d.detail,
    line: d.line,
    flow: d.flow,
    dateRule: d.dateRule ?? null,
    overnightAllowed: d.overnightAllowed,
    suggestions: d.suggestions ?? [],
    suggestionsLead: d.suggestionsLead ?? null,
    asksTimeZone: d.slug === 'the-long-distance',
    crew: crewRange(d),
  };
}

export function flowNotices(engine: Pick<EngineOutput, 'awayNotice' | 'opensAt'>): FlowNotices {
  const a = engine.awayNotice;
  return {
    // An away block always carries its confirm-by date (admin season schema); without one there is nothing to say.
    away: a && a.confirmBy ? FLOW.away(monthDay(a.until), monthDay(a.confirmBy)) : null,
    opensOn: engine.opensAt ? FLOW.opensOn(monthNameDay(civilDateIn(new Date(engine.opensAt), TZ))) : null,
  };
}

/** The pack's page titles: "When works? · The Long Lunch · Time with Jon". */
export function pageTitle(d: Pick<DishView, 'name'>): string {
  return `${pickerHeading()} · ${d.name} · Time with Jon`;
}

/** FLOW.pickerTitle is the heading and its lead in one line: "When works? Tap as many as you like. I'll lock one in." */
export function pickerHeading(): string {
  return FLOW.pickerTitle.slice(0, FLOW.pickerTitle.indexOf('?') + 1);
}
export function pickerLead(): string {
  return FLOW.pickerTitle.slice(FLOW.pickerTitle.indexOf('?') + 1).trim();
}

/** The v2.0 slots.json key for a dish's photo: the slug without "the-" ("the-long-lunch" -> "long-lunch"). */
const SLOT_EXCEPTIONS: Readonly<Record<string, string>> = { 'catch-and-release': 'catch-release' };
export function dishPhotoSlot(slug: string): string {
  return SLOT_EXCEPTIONS[slug] ?? slug.replace(/^the-/, '');
}
