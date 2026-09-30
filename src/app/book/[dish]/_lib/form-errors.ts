// Send-time checks for the booking form (pack site.js "Forms: validate on Send, error summary first"). Each error
// has an inline line (under its control) and a summary line (a link in the error summary to the control).
// Pure; the flow renders the summary, the inline lines and moves focus to the summary.
import { ERRORS } from '@/content';
import { DATES, DETAILS, PICKER, PITCH, SURPRISE } from '@/content/ui/booking';
import { VALIDATION_MESSAGE } from '@/features/requests/messages';
import { hasTimes, type Selection } from './selection';

export type ErrorKey = 'picks' | 'need' | 'idea' | 'when' | 'name' | 'email';

export interface FormError {
  key: ErrorKey;
  /** The id of the control the summary link lands on. */
  target: string;
  inline: string;
  summary: string;
}

/** The picker fieldset's id: the summary link's target when no month tab is showing (pr76 F4). */
export const PICKER_ID = 'picker';

/**
 * T1.5.U5: Send with no time and no stand-by week. The summary link lands on the month tab showing, else on the
 * picker fieldset (tabIndex -1), so the link never drops focus.
 */
export function pickErrors(sel: Selection, shownTabId: string | null): FormError[] {
  return hasTimes(sel)
    ? []
    : [
        {
          key: 'picks',
          target: shownTabId ?? PICKER_ID,
          inline: ERRORS.noTimes,
          summary: PICKER.noTimesSummary,
        },
      ];
}

/** The textarea / input ids the summary links land on. */
export const FIELD_IDS = {
  need: 'f-need',
  plan: 'f-plan',
  idea: 'f-idea',
  when: 'f-when',
  night: 'f-night',
  name: 'f-name',
  email: 'f-email',
} as const;

/** The same everyday shape the server's zod email check asks for: something@something.tld, no spaces. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** T1.7.U4: the guest's name, then an email that looks like one (the server checks again). */
export function detailsErrors(name: string, email: string): FormError[] {
  const out: FormError[] = [];
  if (!name.trim())
    out.push({ key: 'name', target: FIELD_IDS.name, inline: DETAILS.nameError, summary: DETAILS.nameError });
  if (!EMAIL.test(email.trim()))
    out.push({ key: 'email', target: FIELD_IDS.email, inline: ERRORS.badEmail, summary: ERRORS.badEmail });
  return out;
}

/** T1.6.U1: Send with no date and no rough window (pack s07 data-picks-msg: the same line inline and in the summary). */
export function dateErrors(dates: readonly string[], windowText: string): FormError[] {
  return dates.length || windowText.trim()
    ? []
    : [{ key: 'picks', target: PICKER_ID, inline: DATES.noDates, summary: DATES.noDates }];
}

/** T1.6.U4: What I need to know is required (pack s08 data-err / data-sum). */
export function needErrors(need: string): FormError[] {
  return need.trim()
    ? []
    : [{ key: 'need', target: FIELD_IDS.need, inline: SURPRISE.needError, summary: SURPRISE.needSummary }];
}

/** T1.6.U5: the idea, then when (wireframe 06-C2; an empty when is the server's no_dates line). */
export function pitchErrors(idea: string, when: string): FormError[] {
  const out: FormError[] = [];
  if (!idea.trim())
    out.push({ key: 'idea', target: FIELD_IDS.idea, inline: PITCH.ideaError, summary: PITCH.ideaSummary });
  if (!when.trim()) {
    const line = VALIDATION_MESSAGE.no_dates;
    out.push({ key: 'when', target: FIELD_IDS.when, inline: line, summary: line });
  }
  return out;
}

export const withoutError = (errors: readonly FormError[], key: ErrorKey): FormError[] =>
  errors.some((e) => e.key === key) ? errors.filter((e) => e.key !== key) : (errors as FormError[]);

export const errorFor = (errors: readonly FormError[], key: ErrorKey): FormError | undefined =>
  errors.find((e) => e.key === key);
