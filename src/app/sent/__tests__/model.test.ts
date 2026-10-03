// src/app/sent/__tests__/model.test.ts — pr90 F6: the null-capability guard in loadSentModel. No twj_req cookie
// means the stale page, and the database is never asked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const q = vi.fn();
vi.mock('@/lib/db', () => ({ q: (...a: unknown[]) => q(...a) }));
vi.mock('@/lib/settings', () => ({ loadSettings: vi.fn() }));

beforeEach(() => q.mockReset());

describe('loadSentModel', () => {
  it('null capability → { kind: "stale" }, and no query runs', async () => {
    const { loadSentModel } = await import('../model');
    await expect(loadSentModel(null)).resolves.toEqual({ kind: 'stale' });
    expect(q).not.toHaveBeenCalled();
  });
  it('an unknown request id → stale too (the guard is not the only way there)', async () => {
    q.mockResolvedValue([]);
    const { loadSentModel } = await import('../model');
    await expect(loadSentModel('req-x')).resolves.toEqual({ kind: 'stale' });
    expect(q).toHaveBeenCalledOnce();
  });
});

describe('loadRequestLines (QA L7: S17 shows what was sent while nothing is locked)', () => {
  const slot = (iso: string, kind: 'lunch' | 'evening', hours: number) => ({
    starts_at: new Date(iso),
    ends_at: new Date(Date.parse(iso) + hours * 3_600_000),
    window_kind: kind,
  });
  it('the times, then the dates and the rough window, as /sent writes them', async () => {
    q.mockResolvedValueOnce([
      {
        status: 'requested',
        date_prefs: { dates: ['2027-05-08'], window_text: 'late May' },
        standby_week: null,
      },
    ]).mockResolvedValueOnce([
      slot('2027-05-14T19:00:00Z', 'lunch', 2),
      slot('2027-05-21T02:00:00Z', 'evening', 3),
    ]);
    const { loadRequestLines } = await import('../model');
    await expect(loadRequestLines('req-1')).resolves.toEqual([
      'Fri May 14 · noon–2 pm',
      'Thu May 20 · 7 pm',
      'Sat May 8',
      'late May',
    ]);
  });
  it('a stand-by: its receipt line', async () => {
    q.mockResolvedValueOnce([
      { status: 'standby', date_prefs: null, standby_week: '2027-04-12' },
    ]).mockResolvedValueOnce([]);
    const { loadRequestLines } = await import('../model');
    await expect(loadRequestLines('req-2')).resolves.toEqual(['stand-by, Apr 15–16']);
  });
  it('no such request: no lines', async () => {
    q.mockResolvedValueOnce([]);
    const { loadRequestLines } = await import('../model');
    await expect(loadRequestLines('req-x')).resolves.toEqual([]);
  });
});
