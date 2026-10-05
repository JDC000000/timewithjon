// QA M3: the booking draft's storage rules (sessionStorage, one key per dish, parsed on the way in and out).
import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { clearDraft, draftKey, parseDraft, readDraft, writeDraft } from '../draft';

/** the Zod schema draft.ts used to parse with (kept here only, as the reference the hand check must match) */
const text = (max: number) => z.string().max(max).optional();
const ZodDraft = z.object({
  picks: z.array(z.string().max(100)).max(50).optional(),
  standbyWeek: z.string().max(10).nullable().optional(),
  need: text(1000),
  plan: text(2000),
  dates: z.array(z.string().max(10)).max(2).optional(),
  rough: text(200),
  roughOpen: z.boolean().optional(),
  overnight: z.boolean().optional(),
  zone: z.string().max(100).nullable().optional(),
  idea: text(2000),
  when: text(200),
  night: text(200),
  name: text(80),
  email: text(254),
});

function memoryStore(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('booking draft (QA M3)', () => {
  it('round-trips per dish', () => {
    const s = memoryStore();
    writeDraft(s, 'the-long-lunch', { picks: ['a', 'b'], email: 'sam@example.com' });
    expect(readDraft(s, 'the-long-lunch')).toEqual({ picks: ['a', 'b'], email: 'sam@example.com' });
    expect(readDraft(s, 'the-flat-white')).toBeNull();
    expect(s.getItem(draftKey('the-long-lunch'))).not.toBeNull();
  });

  it('never keeps the honeypot or a Turnstile token', () => {
    const s = memoryStore();
    writeDraft(s, 'x', { name: 'Sam', hp: 'spam', website: 'spam', turnstileToken: 't' } as never);
    expect(JSON.parse(s.getItem(draftKey('x'))!)).toEqual({ name: 'Sam' });
  });

  it('drops a draft that is not JSON or not the right shape', () => {
    const s = memoryStore();
    s.setItem(draftKey('x'), '{not json');
    expect(readDraft(s, 'x')).toBeNull();
    s.setItem(draftKey('x'), JSON.stringify({ picks: 'a' }));
    expect(readDraft(s, 'x')).toBeNull();
    s.setItem(draftKey('x'), JSON.stringify({ name: 'x'.repeat(81) }));
    expect(readDraft(s, 'x')).toBeNull();
  });

  it('clears; no storage at all is a no-op', () => {
    const s = memoryStore();
    writeDraft(s, 'x', { idea: 'Sailing' });
    clearDraft(s, 'x');
    expect(readDraft(s, 'x')).toBeNull();
    expect(() => writeDraft(null, 'x', {})).not.toThrow();
    expect(readDraft(null, 'x')).toBeNull();
  });

  it('a storage that throws (blocked, full) never breaks the form', () => {
    const s = memoryStore();
    s.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    s.getItem = () => {
      throw new Error('SecurityError');
    };
    expect(() => writeDraft(s, 'x', { idea: 'a' })).not.toThrow();
    expect(readDraft(s, 'x')).toBeNull();
  });
});

describe('parseDraft matches the Zod schema it replaced (perf: no Zod in the browser on /book)', () => {
  const cases: unknown[] = [
    {},
    { picks: [], dates: [] },
    { picks: ['a', 'b'], email: 'sam@example.com', extra: 1, hp: 'x' },
    { picks: Array(50).fill('x'.repeat(100)) },
    { picks: Array(51).fill('x') },
    { picks: ['x'.repeat(101)] },
    { picks: 'a' },
    { picks: [1] },
    { standbyWeek: null, zone: null },
    { standbyWeek: '2027-W14', zone: 'Europe/London' },
    { standbyWeek: 'x'.repeat(11) },
    { name: null },
    { need: 'x'.repeat(1000), plan: 'y'.repeat(2000) },
    { need: 'x'.repeat(1001) },
    { dates: ['2027-04-02', '2027-04-03'] },
    { dates: ['2027-04-02', '2027-04-03', '2027-04-04'] },
    { dates: ['2027-04-02T00:00'] },
    { roughOpen: true, overnight: false },
    { roughOpen: 'true' },
    { overnight: null },
    { rough: 'evenings', idea: 'Sailing', when: 'May', night: 'Fri' },
    { when: 'x'.repeat(201) },
    { name: 'x'.repeat(80), email: 'x'.repeat(254) },
    { name: 'x'.repeat(81) },
    { email: 'x'.repeat(255) },
    { name: 'Sam', picks: undefined },
    null,
    [],
    ['a'],
    'draft',
    3,
    true,
  ];
  it.each(cases.map((c) => [JSON.stringify(c)?.slice(0, 60) ?? String(c), c]))('%s', (_, c) => {
    const ref = ZodDraft.safeParse(c);
    expect(parseDraft(c)).toEqual(ref.success ? ref.data : null);
  });

  it('keeps no reference to the input arrays', () => {
    const picks = ['a'];
    const out = parseDraft({ picks })!;
    picks.push('b');
    expect(out.picks).toEqual(['a']);
  });

  it('no browser code imports Zod: no client component, and not the draft', () => {
    const files = globSync('src/**/*.{ts,tsx}').filter((f) => !f.includes('__tests__'));
    const client = files.filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')));
    expect(client.length).toBeGreaterThan(10);
    for (const f of [...client, 'src/app/book/[dish]/_lib/draft.ts'])
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/from ['"]zod/);
  });
});
