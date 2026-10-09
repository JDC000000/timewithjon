// QA4 L2: the manage picker never offers back the time the guest is already booked on.
import { describe, expect, it } from 'vitest';
import { withoutSlot } from '@/features/availability/openWindows';
import type { EngineOutput } from '@/features/availability/types';

const win = (slotId: string) => ({ slotId }) as EngineOutput['weeks'][number]['windows'][number];
const out: EngineOutput = {
  weeks: [
    { weekStart: '2027-05-10', state: 'open', windows: [win('a'), win('b')] },
    { weekStart: '2027-05-17', state: 'open', windows: [win('c')] },
  ],
  unavailableDates: [],
};

describe('withoutSlot', () => {
  it('drops only the booked window; a week left with none reads spoken for', () => {
    expect(withoutSlot(out, 'a').weeks.map((w) => [w.state, w.windows.map((x) => x.slotId)])).toEqual([
      ['open', ['b']],
      ['open', ['c']],
    ]);
    expect(withoutSlot(out, 'c').weeks[1]).toEqual({
      weekStart: '2027-05-17',
      state: 'spoken_for',
      windows: [],
    });
  });
  it('changes nothing with no booked slot, or one not listed', () => {
    expect(withoutSlot(out, null)).toBe(out);
    expect(withoutSlot(out, 'zzz')).toEqual(out);
  });
});
