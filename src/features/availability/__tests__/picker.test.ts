// T1.5 AC5 + AC6 (non-UI parts)
import { describe, expect, it } from 'vitest';
import { collapseSpokenFor } from '@/features/availability/collapse';
import { accessibleWindowName } from '@/features/availability/a11y';
import type { WeekOut } from '@/features/availability/types';
const w = (weekStart: string, state: WeekOut['state']): WeekOut => ({ weekStart, state, windows: [] });
describe('picker helpers', () => {
  it('AC6 three consecutive spoken-for weeks collapse into one item; a single one does not', () => {
    const items = collapseSpokenFor([
      w('a', 'open'),
      w('b', 'spoken_for'),
      w('c', 'spoken_for'),
      w('d', 'spoken_for'),
      w('e', 'open'),
      w('f', 'spoken_for'),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['week', 'spoken_run', 'week', 'week']);
    expect(items[1]).toMatchObject({
      kind: 'spoken_run',
      weeks: [{ weekStart: 'b' }, { weekStart: 'c' }, { weekStart: 'd' }],
    });
  });
  it('AC5 accessible name = the pack v1.12 tile name (VD6-09); selection is aria-pressed, not the name', () => {
    expect(accessibleWindowName({ date: '2027-05-13', window: 'lunch' })).toBe('Thu noon–2 pm, May 13');
    expect(accessibleWindowName({ date: '2027-05-14', window: 'evening' })).toBe('Fri 7 pm, May 14');
    expect(accessibleWindowName({ date: '2027-12-31', window: 'lunch' })).toBe('Fri noon–2 pm, Dec 31');
  });
});
