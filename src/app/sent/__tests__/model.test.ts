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
