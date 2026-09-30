// src/lib/requests/messages.ts — maps validation codes to Jon's-voice copy.
import { ERRORS } from '@/content';
import type { ValidationCode } from './validate';

export const VALIDATION_MESSAGE: Record<ValidationCode, string> = {
  not_bookable: ERRORS.generic,
  no_times: ERRORS.noTimes,
  time_gone: ERRORS.timeGone,
  standby_not_allowed: ERRORS.timeGone,
  need_to_know_required: 'Tell me when, roughly where and what to wear, and I’ll do the rest.',
  idea_required: 'What’s the idea? One line is plenty.',
  no_dates: 'Pick a date or two, or tell me roughly when.',
  out_of_season: ERRORS.outOfSeason,
  date_unavailable: ERRORS.timeGone,
  date_not_allowed: 'That one needs a weekend, or a Thursday or Friday.',
  overnight_not_allowed: ERRORS.generic,
  night_without_overnight: ERRORS.generic,
  bad_time_zone: ERRORS.generic,
};
