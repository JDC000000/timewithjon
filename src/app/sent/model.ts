// src/app/sent/model.ts — S11's read-only page model. The request comes ONLY from the twj_req capability (C2): no
// id in the URL. No capability (or it expired after 2 hours) → the friendly stale line (T1.8 AC3). SELECTs only.
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import { AFTER_SEND_STANDBY } from '@/content/ui/guest-after';
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
      /** EML-24: an E1 (or E6) was queued for this request; false when a daily cap or suppression skipped it. */
      emailComing: boolean;
      before60: boolean;
    };

interface Row {
  dish: string;
  contact_email: string;
  status: string;
  date_prefs: { dates?: string[]; window_text?: string | null } | null;
  standby_week: string | null;
}
interface SentRow extends Row {
  email_coming: boolean;
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

/** The picked times, then the dates and the rough window, one receipt line each (S11). */
async function choiceLines(requestId: string, prefs: Row['date_prefs']): Promise<string[]> {
  const slots = await q<{ starts_at: Date; ends_at: Date; window_kind: 'lunch' | 'evening' }>(
    `select s.starts_at, s.ends_at, s.window_kind from request_slot_choice c join slot s on s.id = c.slot_id
      where c.request_id = $1 order by s.starts_at`,
    [requestId],
  );
  return [
    ...slots.map((s) => slotLabel(s.starts_at, s.ends_at, s.window_kind)),
    ...(prefs?.dates ?? []).map(dateLabel),
    ...(prefs?.window_text ? [prefs.window_text] : []),
  ];
}

/**
 * QA L7: what a request asked for, as /sent's receipt writes it (its stand-by line for a stand-by), so S17 shows the
 * times sent while nothing is locked ("Ask for another time" used to end on "Sent: The Flat White" alone).
 */
export async function loadRequestLines(requestId: string): Promise<string[]> {
  const [r] = await q<Pick<Row, 'status' | 'date_prefs' | 'standby_week'>>(
    `select status, date_prefs, standby_week::text from request where id = $1`,
    [requestId],
  );
  if (!r) return [];
  if (r.status === 'standby' && r.standby_week)
    return [AFTER_SEND_STANDBY.receiptLine(standbyDays(r.standby_week))];
  return choiceLines(requestId, r.date_prefs);
}

export async function loadSentModel(requestId: string | null): Promise<SentModel> {
  if (!requestId) return { kind: 'stale' };
  const [r] = await q<SentRow>(
    `select r.dish, r.contact_email, r.status, r.date_prefs, r.standby_week::text,
            exists (select 1 from email_log l where l.request_id = r.id and l.template in ('E1', 'E6')) as email_coming
       from request r where r.id = $1`,
    [requestId],
  );
  if (!r) return { kind: 'stale' };
  const lines = await choiceLines(requestId, r.date_prefs);
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
    emailComing: r.email_coming,
    before60: settings.before60_enabled,
  };
}
