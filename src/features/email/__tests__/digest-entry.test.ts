// QA4b M2: each parked email becomes one digest entry with its own admin link under it (E2, E3, E12, E16).
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { digestEntry } from '@/features/email/digest';

describe('digestEntry', () => {
  it('the subject, then its request page on its own indented line', () => {
    const vars = {
      dish: 'The Long Lunch',
      name: 'Sam <b>x</b>',
      summary: 'Crew 1.',
      adminLink: 'https://t/admin/requests/1',
    };
    expect(digestEntry('E2', vars)).toBe(
      '- New request: The Long Lunch from Sam <b>x</b>\n  https://t/admin/requests/1',
    );
  });
  it('a template with no admin link is the subject alone', () => {
    expect(digestEntry('E14', { adminLink: '' })).toBe('- Google connection problem');
  });
});
