// T3.2.10 (TSD T3.2 AC3, AC4) on the HTML part (T3.2.U2), the text part's guard is tests/unit/email-templates.test.ts.
// AC3: no GET action: no form, no script, no input; every <a> is a {...Link} var of the template (or E1's P.S.
//      tag page), never /api/ or an action query. AC4: no note, plan, secret, story or phone: a var the template
//      doesn't use never reaches the HTML, and the HTML's words are the text part's plus the Layout chrome.
import { describe, expect, it } from 'vitest';
import { EMAIL_COPY, type TemplateId } from '@/content/emails';
import { renderEmail } from '@/features/email/registry';
import { ADMIN_SHELL, MARK } from '@/content/ui/foundation';
import { HTML_TEMPLATES } from '@/features/email/templates';
import { E2_BUTTON } from '@/features/email/templates/E2';
import { LINKS, SITE, VARS, words } from './fixtures';

const ids = Object.keys(EMAIL_COPY) as TemplateId[];
const LEAKS = {
  note: 'LEAK-NOTE-secret surprise',
  plan: 'LEAK-PLAN-sealed',
  sealedPlan: 'LEAK-SEALED',
  secret: 'LEAK-SECRET',
  story: 'LEAK-STORY',
  phone: '+1 604 555 0199',
  before60: 'LEAK-BEFORE60',
};
// The Layout mark and the two button labels (both already in src/content: E2_BUTTON, ADMIN_SHELL.settings).
const CHROME = `${MARK} ${E2_BUTTON} ${ADMIN_SHELL.settings}`;

describe('email templates (html): T3.2.10 guard', () => {
  it('every template has an html part under this guard', () =>
    expect([...HTML_TEMPLATES].sort()).toEqual([...ids].sort()));

  it.each(ids)('%s: no form, script or input; links only to its own {...Link} pages (AC3)', async (id) => {
    const html = (await renderEmail(id, VARS[id], { siteUrl: SITE })).html!;
    expect(html).not.toMatch(/<form|<input|<button|<script|method=|action=|javascript:|onclick/i);
    const allowed = new Set([...LINKS(id), `${SITE}/tag`].map((u) => u.replace(/&/g, '&amp;')));
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
    for (const h of hrefs) {
      expect(allowed, `${id} ${h}`).toContain(h);
      expect(h).not.toMatch(/\/api\/|[?&](action|do|op|confirm|cancel)=/i);
    }
  });

  it.each(ids)(
    '%s: a note, plan, secret, story or phone passed in never reaches the html (AC4)',
    async (id) => {
      const html = (await renderEmail(id, { ...LEAKS, ...VARS[id] }, { siteUrl: SITE })).html!;
      for (const v of Object.values(LEAKS)) expect(html).not.toContain(v);
      expect(html).not.toMatch(/display:\s*none|mso-hide|hidden/i); // no hidden preheader carrying anything else
    },
  );

  it.each(ids)(
    '%s: every word of the html is a word of the text part or of the Layout chrome (AC4)',
    async (id) => {
      const r = await renderEmail(id, VARS[id], { siteUrl: SITE });
      const known = new Set(words(`${r.text} ${CHROME}`).split(' '));
      const html = words(r.html!.replace(/<title>[^<]*<\/title>/, ''));
      expect(html.split(' ').filter((w) => !known.has(w))).toEqual([]);
    },
  );
});
