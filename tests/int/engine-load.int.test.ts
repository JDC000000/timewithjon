// T0.5 loader: the DB shapes map onto EngineInput.
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '@/lib/db';
import { loadEngineData, engineInput } from '@/features/availability/load';
import { openWindows } from '@/features/availability';
afterAll(async () => {
  await pool().end();
});
describe('loadEngineData', () => {
  it('loads 52 slots, 14 weeks and settings; engine runs on it', async () => {
    const d = await loadEngineData(new Date('2027-03-10T18:00:00Z'));
    expect(d.slots).toHaveLength(52);
    expect(d.weeks).toHaveLength(14);
    expect(d.settings.generalOpenAt.toISOString()).toBe('2027-03-01T16:00:00.000Z');
    const out = openWindows(engineInput(d, [], 'general', ['lunch']));
    expect(out.weeks.length).toBe(13);
  });
});
