// src/app/sent/model.ts — S11's read-only page model. The request comes ONLY from the twj_req capability (C2): no
// id in the URL. No capability (or it expired after 2 hours) → the friendly stale line (T1.8 AC3). SELECTs only.
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import { getEnv } from '@/config/env';
import { q } from '@/lib/db';
import { loadSettings } from '@/lib/settings';
import { addDays } from '@/lib/time';
import { dateLabel, slotLabel } from '../_guest/when';

export type SentModel =
  | { kind: 'stale' }
  | {
      kind: 'sent';
      dishName: string;
      /** The picked times, dates or idea, one per line; empty for a stand-by. */
      lines: string[];
      /** Stand-by only: "Apr 12" (the week, for the promise) and "Apr 15–16" (its Thu/Fri, the receipt line). */
      standby: { week: string; days: string } | null;
      sentTo: string;
      fromAddress: string;
      before60: boolean;
    };

interface Row {
  dish: string;
  contact_email: string;
  status: string;
  date_prefs: { dates?: string[]; window_text?: string | null } | null;
  standby_week: string | null;
}

/** The address guest mail comes from, as the guest sees it ("jon@timewithjon.com"). */
export function guestFromAddress(from: string | undefined): string {
  const raw = from ?? 'Jon <jon@timewithjon.com>';
  return /<([^>]+)>/.exec(raw)?.[1] ?? raw;
}

/** "Apr 15–16" for the Thursday and Friday of a stand-by week (weeks start on Monday). */
export function standbyDays(weekStart: string): string {
  const [thu, fri] = [3, 4].map((d) => dateLabel(addDays(weekStart, d)).split(' ')) as [string[], string[]];
  return thu[1] === fri[1] ? `${thu[1]} ${thu[2]}–${fri[2]}` : `${thu[1]} ${thu[2]}–${fri[1]} ${fri[2]}`;
}

export async function loadSentModel(requestId: string | null): Promise<SentModel> {
  if (!requestId) return { kind: 'stale' };
  const [r] = await q<Row>(
    `select dish, contact_email, status, date_prefs, standby_week::text from request where id = $1`,
    [requestId],
  );
  if (!r) return { kind: 'stale' };
  const slots = await q<{ starts_at: Date; ends_at: Date; window_kind: 'lunch' | 'evening' }>(
    `select s.starts_at, s.ends_at, s.window_kind from request_slot_choice c join slot s on s.id = c.slot_id
      where c.request_id = $1 order by s.starts_at`,
    [requestId],
  );
  const prefs = r.date_prefs ?? {};
  const lines = [
    ...slots.map((s) => slotLabel(s.starts_at, s.ends_at, s.window_kind)),
    ...(prefs.dates ?? []).map(dateLabel),
    ...(prefs.window_text ? [prefs.window_text] : []),
  ];
  const standby =
    r.status === 'standby' && r.standby_week
      ? { week: dateLabel(r.standby_week).split(' ').slice(1).join(' '), days: standbyDays(r.standby_week) }
      : null;
  const settings = await loadSettings();
  return {
    kind: 'sent',
    dishName: dishBySlug(r.dish)?.name ?? r.dish,
    lines,
    standby,
    sentTo: r.contact_email,
    fromAddress: guestFromAddress(getEnv().EMAIL_FROM_GUEST),
    before60: settings.before60_enabled,
  };
}
