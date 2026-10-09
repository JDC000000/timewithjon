// The /manage re-request date grid's range (T2.7): from today in Vancouver to the last week the engine returned
// (else about 4 months out), clamped to the season the server checks (settings, validate.ts out_of_season), so
// the grid opens on the season's first month and never offers a date the server refuses. null once the season is
// over. Runs in the browser, so "today" comes from civilDateIn (Intl's numeric parts), never from a locale's date
// wording, and in the site's zone whatever the phone's.
import type { EngineOutput } from '@/features/availability/types';
import { addCivilDays, civilDateIn } from '@/lib/civil';
import { TZ } from '@/lib/tz';

export type Season = { start: string; end: string };

export function seasonOf(
  engine: Pick<EngineOutput, 'weeks' | 'unavailableDates'>,
  season: Season,
  now = new Date(),
): Season | null {
  const today = civilDateIn(now, TZ);
  const starts = engine.weeks.map((w) => w.weekStart).sort();
  const last = starts.at(-1);
  const engineEnd = last ? addCivilDays(last, 6) : addCivilDays(today, 120);
  const latest = [...engine.unavailableDates, engineEnd].sort().at(-1)!;
  const start = today > season.start ? today : season.start;
  const end = latest < season.end ? latest : season.end;
  return start > end ? null : { start, end };
}
