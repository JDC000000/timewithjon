// src/lib/engine/__tests__/freebusy.test.ts — T0.5 AC10
import { describe, expect, it } from 'vitest';
import { resolveBusy } from '@/features/availability';
const now = new Date('2027-05-01T12:00:00Z');
describe('C3 rule 7 free/busy fails open', () => {
  it('AC10 failure with no cache -> no filter + warning', () => {
    const r = resolveBusy({ now, cache: null, fetchResult: { ok: false, error: 'ETIMEDOUT' } });
    expect(r.busy).toBeNull();
    expect(r.warning).toMatch(/no_filter/);
  });
  it('failure with a cache under 24 h uses the cache', () => {
    const cache = { fetchedAt: new Date(now.getTime() - 3600_000), busy: [] };
    expect(resolveBusy({ now, cache, fetchResult: { ok: false, error: 'x' } }).busy).toEqual([]);
  });
  it('fresh cache (<10 min) needs no refetch', () => {
    const cache = { fetchedAt: new Date(now.getTime() - 60_000), busy: [] };
    expect(resolveBusy({ now, cache }).refetch).toBe(false);
  });
});
