// src/app/admin/(app)/settings/_a7/model.ts — T2.9.U1 / T3.3.U1 / T3.15.U1: the A7 rules (wireframe 09 A7, A7b, A7c,
// A7d): Vancouver wall clock <-> the release instants, which fields a Save changes, and the words for each answer.
// Pure: no reads, no React.
import { formatInTimeZone } from 'date-fns-tz';
import { ERRORS } from '@/content';
import { CALENDAR, OPENING } from '@/content/ui/admin-season';
import { TZ, vancouverDate, vancouverInstantOrNull } from '@/lib/time';
import { clock } from '@/app/admin/_season/model';

/** The hours the A7b time pickers offer (wireframe 09: 6 am to 10 pm). */
const FIRST_HOUR = 6;
const LAST_HOUR = 22;

/** An ISO instant as the Vancouver date + 'HH:mm' the A7b fields hold. */
export function splitRelease(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: vancouverDate(d), time: formatInTimeZone(d, TZ, 'HH:mm') };
}

/** 'HH:mm' -> "6 am", "noon", "1:30 pm" (the admin's 12-hour clock, G1 decision 3). */
export function timeLabel(time: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  if (h === 12 && m === 0) return 'noon';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`} ${h < 12 ? 'am' : 'pm'}`;
}

/** The picker's times: every hour from 6 am to 10 pm, plus the saved one when it's off that grid. */
export function timeChoices(current: string): string[] {
  const hours = Array.from(
    { length: LAST_HOUR - FIRST_HOUR + 1 },
    (_, i) => `${String(FIRST_HOUR + i).padStart(2, '0')}:00`,
  );
  return hours.includes(current) ? hours : [...hours, current].sort();
}

export interface ReleaseForm {
  personalDate: string;
  personalTime: string;
  generalDate: string;
  generalTime: string;
}

export type OpeningField = 'personal' | 'general';

/**
 * A7b Save: the PATCH body with only the instants that moved, or the field whose wall-clock time doesn't exist
 * (an empty date, or the spring-forward hour). `{}` = nothing changed.
 */
export function openingPatch(
  saved: { personalOpenAt: string; generalOpenAt: string },
  form: ReleaseForm,
): { patch: { personalOpenAt?: string; generalOpenAt?: string } } | { bad: OpeningField } {
  const personal = vancouverInstantOrNull(form.personalDate, form.personalTime);
  if (!personal) return { bad: 'personal' };
  const general = vancouverInstantOrNull(form.generalDate, form.generalTime);
  if (!general) return { bad: 'general' };
  const patch: { personalOpenAt?: string; generalOpenAt?: string } = {};
  if (personal.getTime() !== new Date(saved.personalOpenAt).getTime())
    patch.personalOpenAt = personal.toISOString();
  if (general.getTime() !== new Date(saved.generalOpenAt).getTime())
    patch.generalOpenAt = general.toISOString();
  return { patch };
}

/** A refused A7b Save (PATCH /api/admin/settings 400 codes, T2.9.02): what to say and which field it's about. */
export function openingRefusal(code: string | null): { field: OpeningField | null; message: string } {
  if (code === 'personal_after_general') return { field: 'personal', message: OPENING.errOrder };
  if (code === 'release_out_of_range') return { field: null, message: OPENING.errRange };
  return { field: null, message: ERRORS.generic };
}

/** The A7c reply promise choices (wireframe 09: 2 days, 3 days), plus the saved one when it's another. */
export function promiseChoices(current: number): number[] {
  return [2, 3].includes(current) ? [2, 3] : [2, 3, current].sort((a, b) => a - b);
}

/** A7c Save: the PATCH body with only what changed (`{}` = nothing). */
export function repliesPatch(
  saved: { replyPromiseDays: number; before60Enabled: boolean },
  form: { replyPromiseDays: number; before60Enabled: boolean },
): { replyPromiseDays?: number; before60Enabled?: boolean } {
  const patch: { replyPromiseDays?: number; before60Enabled?: boolean } = {};
  if (form.replyPromiseDays !== saved.replyPromiseDays) patch.replyPromiseDays = form.replyPromiseDays;
  if (form.before60Enabled !== saved.before60Enabled) patch.before60Enabled = form.before60Enabled;
  return patch;
}

/** "7 am" when Google was last fine today (Vancouver), else "Tue 7 am"; null when it never was. */
export function checkedLabel(lastOkAt: string | null, now: Date): string | null {
  if (!lastOkAt) return null;
  const at = new Date(lastOkAt);
  return vancouverDate(at) === vancouverDate(now)
    ? clock(at)
    : `${formatInTimeZone(at, TZ, 'EEE')} ${clock(at)}`;
}

/** The A7 Re-sync answer (POST /api/admin/google/resync, T3.15.02). */
export function resyncLine(res: { status: number; queued?: number; synced?: number } | null): {
  ok: boolean;
  line: string;
} {
  if (res?.status === 409) return { ok: false, line: CALENDAR.resyncNotConnected };
  if (res?.status !== 200 || typeof res.queued !== 'number' || typeof res.synced !== 'number') {
    return { ok: false, line: ERRORS.generic };
  }
  if (res.queued === 0) return { ok: true, line: CALENDAR.resyncNone };
  if (res.synced >= res.queued) return { ok: true, line: CALENDAR.resyncAll(res.queued) };
  return { ok: true, line: CALENDAR.resyncSome(res.synced, res.queued) };
}

/**
 * After POST /api/admin/google/disconnect: where A7 goes next (`?google=` picks the notice), or the line to show
 * by the button when it failed. 503 = Google couldn't be told, the grant is still live (pr35 F5): try again.
 */
export function disconnectOutcome(
  res: { status: number; revoked?: boolean } | null,
): { ok: true; google: 'disconnected' | 'disconnected_here' } | { ok: false; line: string } {
  if (res?.status === 200)
    return { ok: true, google: res.revoked === false ? 'disconnected_here' : 'disconnected' };
  if (res?.status === 503) return { ok: false, line: CALENDAR.disconnectRetry };
  return { ok: false, line: ERRORS.generic };
}

/** What to say after Google's consent screen (`?google=` from /api/admin/google/callback); null = no news. */
export function googleResultLine(raw: string | string[] | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const r = CALENDAR.result;
  if (raw === 'no_refresh_token') return r.failed;
  return Object.hasOwn(r, raw) ? r[raw as keyof typeof r] : null;
}
