// T0.2 AC2, AC3, AC5, AC6 against the migrated test DB.
import { afterAll, describe, expect, it } from 'vitest';
import { pool, q } from '@/lib/db';
import { ARRAY_CASES, PHRASE_CASES } from '../fixtures/our-things-cases';
afterAll(async () => {
  await pool().end();
});
describe('T0.2 schema', () => {
  it('AC2 52 slots on 26 Thu/Fri dates, Apr 1 – Jun 25', async () => {
    const [r] = await q<{ n: number; d: number; lo: string; hi: string }>(
      `select count(*)::int n, count(distinct date)::int d, min(date)::text lo, max(date)::text hi from slot`,
    );
    expect(r).toEqual({ n: 52, d: 26, lo: '2027-04-01', hi: '2027-06-25' });
  });
  it('AC3 14 weeks Mar 29 – Jun 28', async () => {
    const [r] = await q<{ n: number; lo: string; hi: string }>(
      `select count(*)::int n, min(week_start)::text lo, max(week_start)::text hi from week`,
    );
    expect(r).toEqual({ n: 14, lo: '2027-03-29', hi: '2027-06-28' });
  });
  it.each(PHRASE_CASES)(
    'v1.8 our_things_ok(): $label -> ok=$ok (same table as Zod)',
    async ({ phrase, ok }) => {
      const [r] = await q<{ ok: boolean }>(`select our_things_ok(array[$1::text]) ok`, [phrase]);
      expect(r?.ok).toBe(ok);
    },
  );
  it.each(ARRAY_CASES)('v1.8 our_things_ok() arrays: $label -> ok=$ok', async ({ things, ok }) => {
    const [r] = await q<{ ok: boolean }>(`select our_things_ok($1::text[]) ok`, [things]);
    expect(r?.ok).toBe(ok);
  });
  it("v1.8 invite.our_things defaults to '{}', refuses NULL and a comma", async () => {
    const [r] = await q<{ t: string[] }>(
      `insert into invite (kind, token_secret, name_slug) values ('personal', 'aaaaaaa5', 'x') returning our_things t`,
    );
    expect(r?.t).toEqual([]);
    await q(`delete from invite where token_secret = 'aaaaaaa5'`);
    await expect(
      q(
        `insert into invite (kind, token_secret, name_slug, our_things) values ('personal', 'aaaaaaa6', 'x', null)`,
      ),
    ).rejects.toThrow(/null/);
    await expect(
      q(
        `insert into invite (kind, token_secret, name_slug, our_things) values ('personal', 'aaaaaaa7', 'x', array['beers, then tacos'])`,
      ),
    ).rejects.toThrow(/check/);
  });
  it('AC6 audit_log refuses non-whitelisted detail keys', async () => {
    await expect(
      q(`insert into audit_log (actor, action, detail) values ('jon','x','{"note":"x"}')`),
    ).rejects.toThrow(/check/);
  });
  it('audit_log detail allows story_id and request_id (uuids) and fields (column names only), keeps client_key, nothing looser (0303, 0304)', async () => {
    const ok = [
      { story_id: '3f2b8c1e-0a4d-4e5f-9a6b-7c8d9e0f1a2b' },
      { fields: ['personal_open_at', 'before60_enabled'] },
      { from_status: 'requested', to_status: 'locked', template: 'E5' },
      { client_key: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' }, // 0302 (L3) survives the re-created union
      { request_id: '5c1e9a0b-7d2f-4c3e-8a1b-2c3d4e5f6a7b' }, // 0304 (pr47 F4)
      {
        story_id: '3f2b8c1e-0a4d-4e5f-9a6b-7c8d9e0f1a2b',
        request_id: '5c1e9a0b-7d2f-4c3e-8a1b-2c3d4e5f6a7b',
      },
    ];
    const bad: unknown[] = [
      'Jane Doe', // detail is always an object
      42,
      { story_id: 'not-a-uuid' },
      { story_id: 42 },
      { story_id: null }, // ->> gives SQL null, so only the typeof check refuses it
      { story_id: '3F2B8C1E-0A4D-4E5F-9A6B-7C8D9E0F1A2B-x' },
      { story_id: 'x3f2b8c1e-0a4d-4e5f-9a6b-7c8d9e0f1a2bx' },
      { story_id: 'Jane Doe 3f2b8c1e-0a4d-4e5f-9a6b-7c8d9e0f1a2b' }, // the regex is anchored at both ends
      { story_id: '3f2b8c1e-0a4d-4e5f-9a6b-7c8d9e0f1a2b\n' },
      // pr44 M1: lax jsonpath unwrapped arrays, so PII could ride along next to a real uuid
      { story_id: ['3f2b8c1e-0a4d-4e5f-9a6b-7c8d9e0f1a2b', 'Jane Doe jane@example.com'] },
      { story_id: ['3f2b8c1e-0a4d-4e5f-9a6b-7c8d9e0f1a2b'] },
      { story_id: { id: '3f2b8c1e-0a4d-4e5f-9a6b-7c8d9e0f1a2b' } },
      // pr44 L1: nested arrays are not "an array of names"
      { fields: [['a']] },
      { fields: [['personal_open_at'], ['jane@example.com']] },
      { fields: ['personal_open_at\n'] },
      { fields: 'personal_open_at' },
      { fields: [] },
      { fields: ['personal_open_at', 'a value with spaces'] },
      { fields: ['x@example.com'] },
      { fields: [{ personal_open_at: '2027-02-28' }] },
      { fields: [3] },
      { fields: Array.from({ length: 21 }, (_, i) => `c${i}`) },
      { story_id: '3f2b8c1e-0a4d-4e5f-9a6b-7c8d9e0f1a2b', note: 'x' },
      // 0304: request_id is exactly as strict as story_id
      { request_id: 'not-a-uuid' },
      { request_id: 42 },
      { request_id: null },
      { request_id: '5C1E9A0B-7D2F-4C3E-8A1B-2C3D4E5F6A7B' },
      { request_id: 'x5c1e9a0b-7d2f-4c3e-8a1b-2c3d4e5f6a7b' },
      { request_id: '5c1e9a0b-7d2f-4c3e-8a1b-2c3d4e5f6a7bx' },
      { request_id: '5c1e9a0b-7d2f-4c3e-8a1b-2c3d4e5f6a7b\n' },
      { request_id: ['5c1e9a0b-7d2f-4c3e-8a1b-2c3d4e5f6a7b', 'Jane Doe jane@example.com'] },
      { request_id: { id: '5c1e9a0b-7d2f-4c3e-8a1b-2c3d4e5f6a7b' } },
      { request_id: '5c1e9a0b-7d2f-4c3e-8a1b-2c3d4e5f6a7b', note: 'x' },
    ];
    try {
      for (const d of ok) {
        await q(`insert into audit_log (actor, action, detail) values ('jon', 'test_0303', $1)`, [
          JSON.stringify(d),
        ]);
      }
      for (const d of bad) {
        await expect(
          q(`insert into audit_log (actor, action, detail) values ('jon', 'test_0303', $1)`, [
            JSON.stringify(d),
          ]),
        ).rejects.toMatchObject({ code: '23514' });
      }
    } finally {
      await q(`delete from audit_log where action = 'test_0303'`);
    }
  });
});
