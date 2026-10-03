// src/app/new-date/span.ts — the S18 weather-call grid's dates (QA H2): the season (settings), from today once the
// season has started; null once it is over. The server's out_of_season check (validate.ts) is the same range.
export type Span = { start: string; end: string };

export function newDateSpan(season: Span, today: string): Span | null {
  const start = today > season.start ? today : season.start;
  return start > season.end ? null : { start, end: season.end };
}
