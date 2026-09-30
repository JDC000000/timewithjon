// T1.7.U2 pre-fill model: the masked email (AC4) and the starting values / summary line (AC1, AC3).
import { describe, expect, it } from 'vitest';
import { NO_GUEST, type GuestView } from '../_lib/flow-view';
import { maskEmail, prefill } from '../_lib/prefill';

const DAVE: GuestView = { name: 'Dave', email: 'dave@example.com', general: false };

describe('maskEmail (AC4)', () => {
  it('keeps the part before the @ and ends "@…"', () => {
    expect(maskEmail('dave@example.com')).toBe('dave@…');
    expect(maskEmail('  d.k+twj@mail.co.uk ')).toBe('d.k+twj@…');
  });
  it('no @: the text then "…"', () => expect(maskEmail('dave')).toBe('dave…'));
});

describe('prefill', () => {
  it('a personal invite: the fields start filled and the summary line shows name and masked email (AC1)', () => {
    expect(prefill(DAVE)).toEqual({
      name: 'Dave',
      email: 'dave@example.com',
      summary: { name: 'Dave', email: 'dave@…' },
    });
  });
  it('a general link: blank fields and no summary line (AC3)', () => {
    expect(prefill({ name: '', email: '', general: true, siteKey: 'k' })).toEqual({
      name: '',
      email: '',
      summary: null,
    });
    expect(prefill(NO_GUEST).summary).toBeNull();
  });
  it('a personal invite missing its name or email opens on the fields', () => {
    expect(prefill({ ...DAVE, name: ' ' }).summary).toBeNull();
    expect(prefill({ ...DAVE, email: '' }).summary).toBeNull();
    expect(prefill({ ...DAVE, email: '' }).name).toBe('Dave');
  });
});
