// T3.2.10 (TSD T3.2 AC3, AC4), text part. The HTML part (T3.2.U2, after G1) must be added to this test.
// AC3: no email carries a GET action: links are {...Link} placeholders to pages whose GET is side-effect free,
//      and no link builder points an email at /api/ or at an action query.
// AC4: no template can show the note, the sealed plan, a story or a phone. Exceptions: E2 may show the note
//      (inside {summary}), E13 shows the first line of each story ({lines}).
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMAIL_COPY, type TemplateId } from '@/content/emails';

const ROOT = path.resolve(__dirname, '../..');
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
const ALLOWED: Record<TemplateId, string[]> = {
  E1: ['dish', 'times', 'manageLink'],
  E2: ['dish', 'name', 'summary', 'adminLink'],
  E3: ['name', 'dish', 'adminLink'],
  E4: ['dish', 'day', 'when', 'manageLink'],
  E4c: ['dish', 'lead'],
  E5: ['dish', 'lead', 'times', 'takeLink'],
  E5b: ['dish', 'openTimes', 'takeLink'],
  E5j: ['dish', 'manageLink', 'callLine'],
  E6: ['week', 'manageLink', 'callLine'],
  E7: ['weekday', 'when', 'until', 'takeLink'],
  E8: ['length', 'manageLink'],
  E9: ['menuLink'],
  E10: ['pickLink'],
  E11: [],
  E12: ['dish', 'when', 'name', 'standby', 'adminLink'],
  E13: ['count', 'lines', 'adminLink'],
  E14: ['adminLink'],
  E16: ['dish', 'name', 'adminLink'],
  E17: ['manageLink'],
};
const BANNED = /note|plan|seal|surprise|phone|story|stories|before60/i;

describe('email templates (text)', () => {
  const ids = Object.keys(EMAIL_COPY) as TemplateId[];
  it.each(ids)('%s uses only its known placeholders', (id) => {
    const used = new Set([...placeholders(EMAIL_COPY[id].subject), ...placeholders(EMAIL_COPY[id].body)]);
    expect([...used].sort()).toEqual([...ALLOWED[id]].sort());
  });
  it.each(ids)('%s: no placeholder can carry a note, a plan, a story or a phone (AC4)', (id) => {
    const used = [...placeholders(EMAIL_COPY[id].subject), ...placeholders(EMAIL_COPY[id].body)];
    expect(used.filter((v) => BANNED.test(v))).toEqual([]);
    expect(EMAIL_COPY[id].body).not.toMatch(/\+?\d[\d ().-]{8,}\d/); // no literal phone number
  });
  it.each(ids)('%s: no literal URL, and every link is a {...Link} placeholder (AC3)', (id) => {
    const { subject, body } = EMAIL_COPY[id];
    expect(`${subject}\n${body}`).not.toMatch(/https?:\/\/|www\.|\/api\//i);
    for (const v of placeholders(body).filter((p) => /link|url/i.test(p))) expect(v).toMatch(/^[a-z]+Link$/);
  });
  it('no email link builder in src points at /api/ or carries an action in its query (AC3)', () => {
    const files = globSync('src/**/*.ts', { cwd: ROOT }).filter((f) => !f.includes('__tests__'));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of src.matchAll(/\b(\w+Link)\s*:\s*`([^`]*)`/g)) {
        if (/\/api\/|[?&](action|do|op|confirm|cancel)=/i.test(m[2]!)) offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
