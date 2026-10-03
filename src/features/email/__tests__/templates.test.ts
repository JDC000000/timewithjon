// T1.10.U1: the React Email layout and the E1/E2 HTML parts (renderEmail). The text part is registry.test.ts's.
import { describe, expect, it } from 'vitest';
import { EMAIL_COPY, type TemplateId } from '@/content/emails';
import { renderEmail } from '@/features/email/registry';
import { HTML_TEMPLATES } from '@/features/email/templates';
import { E2_BUTTON } from '@/features/email/templates/E2';

const SITE = 'https://timewithjon.com';
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const TOKENS = new Set(['#1f1f1f', '#34312c', '#595449', '#e9e6de', '#f4f2ec']);
const E2_VARS = {
  name: 'Sam',
  dish: 'The Long Lunch',
  summary: 'Crew 2. Thu Oct 1, 12:00 pm.',
  adminLink: `${SITE}/admin/requests/0f6c1f4e-1111-4222-8333-444455556666`,
};

describe('E2 "New request" html (Jon-facing)', () => {
  it('the same words as the text part, and the admin link is a button that opens the request page (N2)', async () => {
    const r = await renderEmail('E2', E2_VARS, { siteUrl: SITE });
    const html = r.html!;
    expect(r.fromLocal).toBe('admin');
    expect(r.text).toBe(`Sam wants The Long Lunch. Crew 2. Thu Oct 1, 12:00 pm.\n${E2_VARS.adminLink}\n`);
    expect(words(html)).toContain('Sam wants The Long Lunch. Crew 2. Thu Oct 1, 12:00 pm.');
    const a = html.match(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/)!;
    expect([a[1], a[2]]).toEqual([E2_VARS.adminLink, E2_BUTTON]);
    expect(html).not.toMatch(/<form|method="post"/i); // a link to a page, never an action in the email
    expect(html).toContain('<title>New request: The Long Lunch from Sam</title>');
  });
  it('no "Jon" sign-off and no P.S. (as the text part)', async () => {
    const html = (await renderEmail('E2', E2_VARS, { siteUrl: SITE })).html!;
    expect(html).not.toContain('>Jon</p>');
    expect(html).not.toContain('P.S.');
  });
  it('escapes guest-typed values; colours are token values only', async () => {
    const html = (
      await renderEmail('E2', { ...E2_VARS, name: '<img src=x onerror=alert(1)>' }, { siteUrl: SITE })
    ).html!;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; wants');
    for (const hex of html.match(/#[0-9a-f]{6}\b/gi)!) expect(TOKENS, hex).toContain(hex.toLowerCase());
  });
});

describe('E1 "Got it" html', () => {
  it('lists the requested times, one item each, then "Jon" on its own line', async () => {
    const html = (
      await renderEmail(
        'E1',
        { dish: 'x', times: 'Thu Oct 1, 12:00 pm\nSat Oct 3, 6:00 pm' },
        { siteUrl: SITE },
      )
    ).html!;
    expect(html.match(/<li>[^<]*<\/li>/g)).toEqual([
      '<li>Thu Oct 1, 12:00 pm</li>',
      '<li>Sat Oct 3, 6:00 pm</li>',
    ]);
    expect(html).toMatch(/<p style="[^"]*">Jon<\/p>/);
  });
  it('without times (a legacy row) keeps the old body and draws no list', async () => {
    const html = (await renderEmail('E1', { dish: 'x' }, { siteUrl: SITE })).html!;
    expect(words(html)).toContain('Got your times. I’ll lock one in within two days. Jon');
    expect(html).not.toContain('<ul');
  });
});

describe('renderEmail', () => {
  it('every template carries html (T3.2.U2)', async () => {
    expect([...HTML_TEMPLATES].sort()).toEqual(Object.keys(EMAIL_COPY).sort());
    for (const id of Object.keys(EMAIL_COPY) as TemplateId[]) {
      const vars = Object.fromEntries(
        [...`${EMAIL_COPY[id].subject}${EMAIL_COPY[id].body}`.matchAll(/\{(\w+)\}/g)].map((m) => [
          m[1]!,
          'v',
        ]),
      );
      const r = await renderEmail(id, vars, { siteUrl: SITE });
      expect(Boolean(r.html), id).toBe(true);
    }
  });
  it('fails closed on an unfilled placeholder before drawing any html', async () => {
    await expect(
      renderEmail('E2', { name: 'Sam', dish: 'x', summary: 's' }, { siteUrl: SITE }),
    ).rejects.toThrow('E2');
  });
});
