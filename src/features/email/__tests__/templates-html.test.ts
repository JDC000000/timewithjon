// T3.2.U2 (T3.2 AC1): the HTML part of the 17 templates after E1/E2 (E17: QA r2 M5), on the #107 Layout, with
// the text part's copy (src/content/emails.ts, no new copy). AC3: the text part is unchanged (renderText snapshot
// below).
import { describe, expect, it } from 'vitest';
import { EMAIL_COPY, GUEST_BUTTON, JON_FACING, fill, type TemplateId } from '@/content/emails';
import { ADMIN_SHELL } from '@/content/ui/foundation';
import { renderEmail, renderText } from '@/features/email/registry';
import { E2_BUTTON } from '@/features/email/templates/E2';
import { LINKS, SITE, VARS, words } from '../../../../tests/unit/email/fixtures';

const REST = (Object.keys(EMAIL_COPY) as TemplateId[]).filter((id) => id !== 'E1' && id !== 'E2');
const BUTTON: Partial<Record<TemplateId, string>> = {
  E3: E2_BUTTON,
  E12: E2_BUTTON,
  E16: E2_BUTTON,
  E14: ADMIN_SHELL.settings,
  E13: ADMIN_SHELL.nav.stories,
  ...GUEST_BUTTON, // EML-03: E4, E5, E5b, E7, E8, E9, E10
};
const LIST: Partial<Record<TemplateId, string>> = { E5: 'times', E13: 'lines' };

describe('T3.2.U2 html: each template renders on the Layout with its copy', () => {
  it('covers the 17 templates after E1/E2', () => expect(REST).toHaveLength(17));

  it.each(REST)('%s', async (id) => {
    const vars = VARS[id];
    const r = await renderEmail(id, vars, { siteUrl: SITE });
    const html = r.html!;
    expect(html).toContain(`<title>${fill(EMAIL_COPY[id].subject, vars)}</title>`);
    expect(html).toContain('Time with Jon'); // the Layout's mark
    // Every line of the text part is in the html's words, except a link line (drawn as a link or a button).
    const links = LINKS(id);
    const text = words(html);
    for (const line of r.text.split('\n').filter((l) => l.trim() && !links.includes(l))) {
      expect(text, line).toContain(line.trim().replace(/^- /, '')); // a digest line's "- " is the list bullet (EML-09)
    }
    // Guest emails sign off "Jon" on its own line; Jon-facing ones don't (as the text part).
    expect(/<p style="[^"]*">Jon<\/p>/.test(html)).toBe(!JON_FACING.includes(id));
    expect(html).not.toContain('P.S.');
    // The link line: one <a> to it, a button labelled with src/content copy (EML-03: never the URL itself).
    const anchors = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(anchors).toEqual(links.map((l) => [l.replace(/&/g, '&amp;'), BUTTON[id]]));
    for (const [, label] of anchors) expect(label).not.toMatch(/https?:|\/\//);
    // Multi-line vars are lists, one item each.
    const listVar = LIST[id];
    if (listVar) {
      expect(html.match(/<li>[^<]*<\/li>/g)).toEqual(
        String(vars[listVar])
          .split('\n')
          .map((t) => `<li>${t.replace(/^- /, '')}</li>`), // EML-09: the list draws the bullet, not "- "
      );
    }
  });

  it('E5b with times draws the E5B_PARTS frame with the times as a list; without, no list and no link', async () => {
    const withTimes = (await renderEmail('E5b', VARS.E5b, { siteUrl: SITE })).html!;
    expect(withTimes.match(/<li>[^<]*<\/li>/g)).toEqual([
      '<li>Fri Oct 2 · noon–2 pm Vancouver time</li>',
      '<li>Sun Oct 4 · 11 am–1 pm Vancouver time</li>',
    ]);
    expect(words(withTimes)).toContain('Something came up that week, and it’s on me. These are still open:');
    expect(words(withTimes)).toContain('Tap one and it’s yours.');
    const none = await renderEmail(
      'E5b',
      { dish: 'x', openTimes: 'I’ll send you some new times soon.', takeLink: '' },
      { siteUrl: SITE },
    );
    expect(none.html).not.toContain('<ul');
    expect(none.html).not.toContain('<a ');
    expect(words(none.html!)).toContain(
      'Something came up that week, and it’s on me. I’ll send you some new times soon. Jon',
    );
  });

  it('E5 without a lead starts at "These are still open:"', async () => {
    const html = (await renderEmail('E5', { ...VARS.E5, lead: '' }, { siteUrl: SITE })).html!;
    expect(words(html.replace(/<title>[^<]*<\/title>/, ''))).toMatch(/^Time with Jon These are still open:/);
  });
});

describe('email audit 2026-10-08 (EML)', () => {
  const ALL = Object.keys(EMAIL_COPY) as TemplateId[];

  it('EML-03: no link anywhere shows a URL as its text; the text part keeps each URL on its own line', async () => {
    for (const id of ALL) {
      const r = await renderEmail(id, VARS[id], { siteUrl: SITE });
      for (const m of r.html!.matchAll(/<a [^>]*>([^<]*)<\/a>/g))
        expect(m[1], id).not.toMatch(/https?:|\/\//);
      for (const link of LINKS(id)) if (link) expect(r.text.split('\n'), id).toContain(link);
    }
  });

  it('EML-03: a link line with no button label never renders a bare URL (it throws)', async () => {
    const { Mail, MissingButtonLabelError } = await import('@/features/email/templates/Mail');
    const { renderToStaticMarkup } = await import('react-dom/server');
    expect(() => renderToStaticMarkup(Mail({ id: 'E4', vars: VARS.E4 }))).toThrow(MissingButtonLabelError);
  });

  it('EML-09: the digest draws one bullet per line (no literal "- "), and its link is a button', async () => {
    const html = (await renderEmail('E13', VARS.E13, { siteUrl: SITE })).html!;
    expect(html).not.toMatch(/<li>-/);
    expect(html).toContain('<li>Sam, The Long Lunch: A night on the ridge</li>');
    expect(html).toMatch(new RegExp(`>${ADMIN_SHELL.nav.stories}</a>`));
  });

  it('EML-10: the hourly digest says "What’s new", not "New stories"; its button opens the requests', async () => {
    const vars = { ...VARS.E13, digest: 'hourly', lines: '- New request: The Long Lunch from Sam' };
    const r = await renderEmail('E13', vars, { siteUrl: SITE });
    expect(r.subject).toBe('What’s new: 2');
    expect(r.html).toContain('<title>What’s new: 2</title>');
    expect(r.html).toMatch(new RegExp(`>${ADMIN_SHELL.nav.requests}</a>`));
    expect((await renderEmail('E13', VARS.E13, { siteUrl: SITE })).subject).toBe('New stories: 2');
  });

  it('EML-15: E12 with no locked time has no stand-by sentence (and keeps "nobody" when the week exists)', async () => {
    const none = await renderEmail(
      'E12',
      { ...VARS.E12, when: 'no time locked yet', standby: '' },
      { siteUrl: SITE },
    );
    expect(none.text).toBe(
      'Sam cancelled The Long Lunch (no time locked yet).\nhttps://timewithjon.com/admin/requests/0f6c1f4e-1111-4222-8333-444455556666\n',
    );
    expect(words(none.html!)).not.toContain('Stand-by');
    const nobody = await renderEmail('E12', { ...VARS.E12, standby: 'nobody' }, { siteUrl: SITE });
    expect(nobody.text).toContain('Stand-by for that week: nobody');
  });

  it('EML-17: the card wraps a long unbroken name instead of widening past 320 px', async () => {
    const html = (await renderEmail('E2', { ...VARS.E2, name: 'X'.repeat(80) }, { siteUrl: SITE })).html!;
    expect(html).toMatch(/overflow-wrap:anywhere;word-break:break-word/);
  });

  it('EML-04: E9 with an empty menu link (revoked invite) still renders, with no link or blank line', async () => {
    const r = await renderEmail('E9', { menuLink: '' }, { siteUrl: SITE });
    expect(r.text).toBe(`${EMAIL_COPY.E9.body.split('\n')[0]}\n\nJon\n`);
    expect(r.html).not.toContain('<a ');
  });
});

describe('T3.2.U2 AC3: the text part of every email is unchanged', () => {
  it('renderText snapshot', () => {
    const all = Object.fromEntries(
      (Object.keys(EMAIL_COPY) as TemplateId[]).map((id) => [
        id,
        renderText(id, VARS[id], { siteUrl: SITE }),
      ]),
    );
    expect(all).toMatchInlineSnapshot(`
      {
        "E1": {
          "fromLocal": "jon",
          "subject": "Got it: The Long Lunch",
          "text": "Got your times:
      Thu Oct 1 · noon–2 pm Vancouver time
      Sat Oct 3 · 7 pm Vancouver time
      I’ll lock one in within two days.

      Jon

      P.S. No gifts. Really. The one thing I’ll take is a bottle of wine with a letter or an old photo tucked in. Write on the tag when I should open it. Bring it when we meet.
      Print the tag: https://timewithjon.com/tag
      ",
        },
        "E10": {
          "fromLocal": "jon",
          "subject": "Weather call",
          "text": "It’s pouring. Let’s move it.
      https://timewithjon.com/r/pick/tok_3f9a2b7c

      Jon
      ",
        },
        "E11": {
          "fromLocal": "jon",
          "subject": "Cancelled, no guilt",
          "text": "Done. No guilt. The menu’s still there when you’re ready.

      Jon
      ",
        },
        "E12": {
          "fromLocal": "admin",
          "subject": "Cancelled: The Long Lunch, Thu Oct 1 · noon–2 pm",
          "text": "Sam cancelled The Long Lunch (Thu Oct 1 · noon–2 pm). Stand-by for that week: Alex, Kim
      https://timewithjon.com/admin/requests/0f6c1f4e-1111-4222-8333-444455556666
      ",
        },
        "E13": {
          "fromLocal": "admin",
          "subject": "New stories: 2",
          "text": "- Sam, The Long Lunch: A night on the ridge
      - Kim: The lunch that ran long
      https://timewithjon.com/admin/stories
      ",
        },
        "E14": {
          "fromLocal": "admin",
          "subject": "Google connection problem",
          "text": "The “Time with Jon” calendar connection stopped working. Connect it again in Settings.
      https://timewithjon.com/admin/settings
      ",
        },
        "E16": {
          "fromLocal": "admin",
          "subject": "Updated: The Long Lunch from Sam",
          "text": "Sam picked new times for The Long Lunch.
      https://timewithjon.com/admin/requests/0f6c1f4e-1111-4222-8333-444455556666
      ",
        },
        "E17": {
          "fromLocal": "jon",
          "subject": "I’m booked on that day. Can we try another day?",
          "text": "Hey, can you suggest one or two other times that work in your calendar? Sorry, my calendar is a little more full than I expected. I’ll be in touch.

      Jon
      ",
        },
        "E2": {
          "fromLocal": "admin",
          "subject": "New request: The Long Lunch from Sam",
          "text": "Sam wants The Long Lunch. Crew 2. 2 times.
      https://timewithjon.com/admin/requests/0f6c1f4e-1111-4222-8333-444455556666
      ",
        },
        "E3": {
          "fromLocal": "admin",
          "subject": "Still waiting: Sam, The Long Lunch",
          "text": "Sam has been waiting a day for The Long Lunch.
      https://timewithjon.com/admin/requests/0f6c1f4e-1111-4222-8333-444455556666
      ",
        },
        "E4": {
          "fromLocal": "jon",
          "subject": "Locked in: The Long Lunch, Thu Oct 1",
          "text": "Thu Oct 1 · noon–2 pm Vancouver time. You pick the place, just tell me where. The calendar invite comes from Time with Jon, so look out for it. If plans change, use the link below and we’ll find another day.
      https://timewithjon.com/r/manage/tok_3f9a2b7c

      Jon
      ",
        },
        "E4c": {
          "fromLocal": "jon",
          "subject": "Calendar update: The Long Lunch",
          "text": "Here’s the calendar invite for The Long Lunch, Thu Oct 1 · noon–2 pm Vancouver time. It’s attached: open it to add it to your calendar.

      Jon
      ",
        },
        "E5": {
          "fromLocal": "jon",
          "subject": "Another time for The Long Lunch?",
          "text": "That one went. These are still open:
      Fri Oct 2 · noon–2 pm Vancouver time
      Sun Oct 4 · 11 am–1 pm Vancouver time
      Tap one and it’s yours.
      https://timewithjon.com/r/take/tok_3f9a2b7c

      Jon
      ",
        },
        "E5b": {
          "fromLocal": "jon",
          "subject": "Another time for The Long Lunch?",
          "text": "Something came up that week, and it’s on me. These are still open:
      Fri Oct 2 · noon–2 pm Vancouver time
      Sun Oct 4 · 11 am–1 pm Vancouver time
      Tap one and it’s yours.
      https://timewithjon.com/r/take/tok_3f9a2b7c

      Jon
      ",
        },
        "E5j": {
          "fromLocal": "jon",
          "subject": "About The Long Lunch",
          "text": "That plan fell through, so your spot on it is off. I’ll send you a new time soon.

      Jon
      ",
        },
        "E6": {
          "fromLocal": "jon",
          "subject": "You’re on stand-by",
          "text": "You’re on stand-by for the week of Oct 5. If something opens up, I’ll email you.

      Jon
      ",
        },
        "E7": {
          "fromLocal": "jon",
          "subject": "Friday just opened up",
          "text": "Fri Oct 2 · noon–2 pm Vancouver time is free now. Want it?
      https://timewithjon.com/r/take/tok_3f9a2b7c

      Jon
      ",
        },
        "E8": {
          "fromLocal": "jon",
          "subject": "About your pitch",
          "text": "I love this. It’s also three nights, and I promised one night away, max. Pitch me the shorter version?
      https://timewithjon.com/r/manage/tok_3f9a2b7c

      Jon
      ",
        },
        "E9": {
          "fromLocal": "jon",
          "subject": "About your pitch",
          "text": "I can’t make this one happen, and I’d rather say so than leave it hanging. Pick anything else and it’s yours.
      https://timewithjon.com/r/menu/tok_3f9a2b7c

      Jon
      ",
        },
      }
    `);
  });
});
