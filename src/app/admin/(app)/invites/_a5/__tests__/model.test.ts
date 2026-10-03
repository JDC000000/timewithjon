// T2.6.U1 (TSD T2.6 AC1): the A5 "our things" editor refuses exactly what the server refuses, counts words live,
// drops blank boxes, and previews the S2 hero line verbatim (landingModel, the model the landing page renders).
import { describe, expect, it } from 'vitest';
import { OPEN_LINE, PERSONAL } from '@/content/site';
import { OurThings } from '@/features/invites/our-things';
import { INBOX } from '@/content/ui/admin-requests';
import type { InviteListItem } from '@/features/admin/invites';
import { A5 } from '../copy';
import {
  createBody,
  createErrors,
  inviteMeta,
  keptThings,
  previewModel,
  serverErrors,
  thingProblem,
  wordCount,
} from '../model';

const form = (things: string[], name = 'Dave') => ({ name, things, dish: '', email: '', hopedFor: true });
const DISHES = [{ slug: 'the-flat-white', name: 'The Flat White', section: 'lunch' as never }];

describe('A5 our-things editor', () => {
  it('counts words live (n/4)', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('  the Seymour lap ')).toBe(3);
    expect(A5.words(3)).toBe('3/4 words');
  });

  it('refuses a 5-word phrase, a 41-character phrase and a comma; accepts 4 words / 40 chars', () => {
    expect(thingProblem('one two three four five')).toBe(A5.err.four_words_max);
    expect(thingProblem('a'.repeat(41))).toBe(A5.err.thing_too_long);
    expect(thingProblem('Tofino, again')).toBe(A5.err.no_commas);
    expect(thingProblem('one two three four')).toBeNull();
    expect(thingProblem('a'.repeat(40))).toBeNull();
  });

  it('matches the server rule on every case (a box the UI passes, the server passes)', () => {
    for (const s of ['one two three four five', 'a'.repeat(41), 'x, y', 'ok one', 'tab\there', ' ']) {
      expect(thingProblem(s) === null).toBe(OurThings.safeParse([s]).success);
    }
  });

  it('a 4th phrase is refused by the server schema (the sheet has 3 boxes)', () => {
    const r = OurThings.safeParse(['a', 'b', 'c', 'd']);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('three_max');
  });

  it('drops blank boxes from the body', () => {
    expect(keptThings(['', ' Tofino again ', '   '])).toEqual(['Tofino again']);
    expect(createBody(form(['', 'the Seymour lap', ''])).ourThings).toEqual(['the Seymour lap']);
    expect(createErrors(form(['', '', '']))).toEqual({});
  });

  it('previews the S2 hero line: blank shows the open-link line', () => {
    expect(previewModel(form(['', '', '']), DISHES).heroLine).toBe(OPEN_LINE);
    const m = previewModel(form(['the Seymour lap', '', 'Tofino again']), DISHES);
    expect(m.heroLine).toBe(PERSONAL.ourThingsLine(['the Seymour lap', 'Tofino again']));
    expect(m.name).toBe('Dave');
  });

  it('puts server issues back on the right box (index counts only non-blank boxes)', () => {
    const e = serverErrors([{ path: 'ourThings.0', code: 'no_commas' }], ['', 'x, y', '']);
    expect(e).toEqual({ thing1: A5.err.no_commas });
    expect(serverErrors([{ path: 'pickedDish', code: 'not_bookable' }], ['', '', ''])).toEqual({
      dish: A5.err.not_bookable,
    });
  });
});

describe('inviteMeta (QA L3): the request status and the hoped-for flag in the admin’s own words', () => {
  const item = (over: Partial<InviteListItem>): InviteListItem => ({
    id: 'i',
    kind: 'personal',
    isTest: false,
    name: 'Dave',
    slug: 'dave',
    ourThings: [],
    pickedDish: null,
    dishNotBookable: false,
    prefillEmail: null,
    hopedFor: false,
    revoked: false,
    openCount: 1,
    firstOpenedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    link: 'https://example.com/i/dave',
    text: '',
    requests: { count: 0, latest: null },
    ...over,
  });
  const latest = (status: NonNullable<InviteListItem['requests']['latest']>['status'], count = 1) =>
    item({ requests: { count, latest: { id: 'r', status } } });

  it('each status reads as its inbox filter, never the raw value', () => {
    const cases = [
      ['requested', INBOX.filters.needs],
      ['needs_new_time', INBOX.filters.waiting],
      ['standby', INBOX.filters.standby],
      ['locked', INBOX.filters.locked],
      ['done', INBOX.filters.done],
      ['cancelled', INBOX.filters.cancelled],
    ] as const;
    for (const [status, label] of cases) {
      const meta = inviteMeta(latest(status));
      expect(meta).toEqual([A5.opens(1), A5.requests(1), label]);
      expect(meta.join(' ')).not.toMatch(/_|\blatest\b/);
    }
    expect(inviteMeta(latest('needs_new_time', 2))).toEqual([
      A5.opens(1),
      A5.requests(2),
      INBOX.filters.waiting,
    ]);
  });

  it('the hoped-for flag says what it is', () => {
    expect(inviteMeta(item({ hopedFor: true }))).toEqual([A5.opens(1), A5.noRequest, A5.hopedFor]);
  });
});
