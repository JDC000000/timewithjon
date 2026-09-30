// src/lib/picker/collapse.ts — T1.5: 2+ consecutive spoken-for weeks collapse into one line (§14.4 nudge).
import type { WeekOut } from '@/features/availability/types';

export type PickerItem = { kind: 'week'; week: WeekOut } | { kind: 'spoken_run'; weeks: WeekOut[] };
export function collapseSpokenFor(weeks: WeekOut[]): PickerItem[] {
  const out: PickerItem[] = [];
  let run: WeekOut[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ kind: 'spoken_run', weeks: run });
    else run.forEach((w) => out.push({ kind: 'week', week: w }));
    run = [];
  };
  for (const w of weeks) {
    if (w.state === 'spoken_for') run.push(w);
    else {
      flush();
      out.push({ kind: 'week', week: w });
    }
  }
  flush();
  return out;
}
