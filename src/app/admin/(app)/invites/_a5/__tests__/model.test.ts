// T2.6.U1 (TSD T2.6 AC1): the A5 New link sheet previews the S2 hero line verbatim (landingModel, the model the
// landing page renders). Jon (2026-10-05): that line is the same for everyone, so the sheet has no "our things".
import { describe, expect, it } from 'vitest';
import { OPEN_LINE } from '@/content/site';
import { INBOX } from '@/content/ui/admin-requests';
import type { InviteListItem } from '@/features/admin/invites';
import { A5 } from '../copy';
import { createBody, createErrors, inviteMeta, previewModel, serverErrors } from '../model';

const form = (name = 'Dave') => ({ name, dish: '', email: '', hopedFor: true });
const DISHES = [{ slug: 'the-flat-white', name: 'The Flat White', section: 'lunch' as never }];

describe('A5 New link sheet (no "our things": Jon, 2026-10-05)', () => {
  it('sends no things (the API field defaults to none and still accepts old data)', () => {
    expect(createBody(form())).toEqual({
      name: 'Dave',
      pickedDish: null,
      prefillEmail: null,
      hopedFor: true,
    });
    expect(createErrors(form())).toEqual({});
  });

  it('previews the S2 hero with the one line everyone sees', () => {
    const m = previewModel(form(), DISHES);
    expect(m.heroLine).toBe(OPEN_LINE);
    expect(OPEN_LINE).toBe('We keep saying we should get or do that epic trip.');
    expect(m.name).toBe('Dave');
  });

  it('puts server issues back on their box', () => {
    expect(serverErrors([{ path: 'pickedDish', code: 'not_bookable' }])).toEqual({
      dish: A5.err.not_bookable,
    });
    expect(serverErrors([{ path: 'name', code: 'bad_character' }])).toEqual({ name: A5.err.bad_character });
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
