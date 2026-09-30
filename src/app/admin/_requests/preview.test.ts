// Sheet previews use the real email copy; link lines stay out; E5 times as the email writes them.
import { describe, expect, it } from 'vitest';
import { EMAIL_COPY } from '@/content';
import { vancouverInstant } from '@/lib/time';
import { emailPreview, emailTime } from './preview';

describe('emailPreview', () => {
  it('E5: the subject and the body filled, without the take-link line', () => {
    const p = emailPreview('E5', {
      dish: 'The Flat White',
      lead: '',
      times: 'Fri May 21, 12:00 Vancouver time\nThu May 27, 12:00 Vancouver time',
    });
    expect(p.subject).toBe('Another time for The Flat White?');
    expect(p.lines.join('\n')).not.toMatch(/\{\w+\}/);
    expect(p.lines.join('\n')).toContain('Fri May 21, 12:00 Vancouver time');
    expect(p.lines.some((l) => l.includes('Link'))).toBe(false);
    expect(p.signOff).toBe('Jon');
  });
  it('E8 names the length in Jon’s words; E9 and E10 drop their link lines', () => {
    expect(emailPreview('E8', { length: 'three nights long' }).lines[0]).toContain('three nights long');
    expect(emailPreview('E9', {}).lines).toHaveLength(EMAIL_COPY.E9.body.split('\n').length - 1);
    expect(emailPreview('E10', {}).lines).toEqual([EMAIL_COPY.E10.body.split('\n')[0]]);
  });
});

describe('emailTime', () => {
  it('"Fri May 21, 12:00 Vancouver time"', () => {
    expect(emailTime(vancouverInstant('2027-05-21', '12:00'))).toBe('Fri May 21, 12:00 Vancouver time');
  });
});
