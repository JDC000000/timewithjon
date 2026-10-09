// The /manage re-request date grid's range (T2.7): today in Vancouver (or the first open week) to the last week the
// engine returned, else about 4 months. Runs in the browser, so "today" comes from civilDateIn (Intl's numeric
// parts), never from a locale's date wording, and in the site's zone whatever the phone's.
import type { EngineOutput } from '@/features/availability/types';
import { addCivilDays, civilDateIn } from '@/lib/civil';
import { TZ } from '@/lib/tz';

export function seasonOf(
  engine: Pick<EngineOutput, 'weeks' | 'unavailableDates'>,
  now = new Date(),
): { start: string; end: string } {
  const today = civilDateIn(now, TZ);
  const starts = engine.weeks.map((w) => w.weekStart).sort();
  const last = starts.at(-1);
  const end = last ? addCivilDays(last, 6) : addCivilDays(today, 120);
  return { start: today, end: [...engine.unavailableDates, end].sort().at(-1)! };
}
