// src/app/admin/_season/away-model.ts — T2.5.U1: the A4c away form's rules (pack a4c + site.js data-validate). Pure.
// "I’ll confirm by" = Back on + 2 days (orchestrator ruling Q2). Back on is the last day of the range (the pack:
// "Hides every time from Sat Apr 24 to Mon May 3").
import { AWAY } from '@/content/ui/admin-season';
import { FLOW } from '@/content/microcopy';
import { addDays } from '@/lib/time';
import { dateLabel } from './model';

export type AwayField = 'from' | 'to';
export interface AwayError {
  field: AwayField;
  /** Under the field. */
  inline: string;
  /** In "Things to fix". */
  summary: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The form's errors in page order; empty when it can be saved. */
export function awayErrors(from: string, to: string): AwayError[] {
  const errs: AwayError[] = [];
  const f = from.trim();
  const t = to.trim();
  if (!ISO.test(f)) errs.push({ field: 'from', inline: AWAY.errDate, summary: AWAY.sumFrom });
  if (!ISO.test(t)) errs.push({ field: 'to', inline: AWAY.errDate, summary: AWAY.sumTo });
  else if (ISO.test(f) && t <= f) errs.push({ field: 'to', inline: AWAY.errAfter, summary: AWAY.errAfter });
  return errs;
}

export const confirmByFor = (backOn: string) => addDays(backOn, 2);

/** The live summary under the dates, or null while the range isn't valid yet. */
export function awaySummary(from: string, to: string) {
  if (awayErrors(from, to).length > 0) return null;
  const confirmBy = confirmByFor(to);
  return {
    confirmBy,
    notice: FLOW.away(dateLabel(to, 'MMM d'), dateLabel(confirmBy, 'MMM d')),
    hides: AWAY.hides(dateLabel(from, 'EEE MMM d'), dateLabel(to, 'EEE MMM d')),
    requests: AWAY.requests(dateLabel(to, 'MMM d')),
  };
}
