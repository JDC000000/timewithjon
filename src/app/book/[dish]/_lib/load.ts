// The C3 output for one dish and one invite, computed exactly as GET /api/availability computes it (same engine
// calls, same fail-open free/busy), so the page renders server-side with no loading state and a stable DOM for
// Back and reload (FOC-02). Only the C3 output shape reaches the page: no cap, no counts.
import 'server-only';
import type { Dish } from '@/content';
import { getBusy } from '@/features/availability/busy';
import { engineInput, loadEngineData } from '@/features/availability/load';
import { openWindows } from '@/features/availability/openWindows';
import type { EngineOutput, InviteKind } from '@/features/availability/types';

export interface DishAvailability {
  engine: EngineOutput;
  /** The season's civil dates: the month grid's range (S7). */
  season: { start: string; end: string };
}

export async function loadDishAvailability(dish: Dish, kind: InviteKind): Promise<DishAvailability> {
  const loaded = await loadEngineData();
  const season = { start: loaded.settings.seasonStart, end: loaded.settings.seasonEnd };
  const busy = await getBusy(season);
  return { engine: openWindows(engineInput(loaded, busy, kind, dish.windows)), season };
}
