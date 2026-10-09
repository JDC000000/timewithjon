// T3.2.U2 (T3.2 AC1): the HTML part of the 17 templates after E1/E2 (E17: QA r2 M5), on the #107 Layout, with
// the text part's copy (src/content/emails.ts, no new copy). AC3: the text part is unchanged (renderText snapshot
// below).
import { describe, expect, it } from 'vitest';
import { E5B_PARTS, EMAIL_COPY, GUEST_BUTTON, JON_FACING, fill, type TemplateId } from '@/content/emails';
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
    // Jon-facing mail keeps the card and its mark; a guest email is a personal note: no mark, no canvas, no card
    // (r6 fix 3, approved: Jon 2026-10-09).
    const guest = !JON_FACING.includes(id);
    expect(/text-transform:uppercase[^>]*>Time with Jon</.test(html), id).toBe(!guest); // the mark
    expect(html.includes('#e9e6de'), id).toBe(!guest); // the canvas
    expect(html.includes('#f4f2ec'), id).toBe(!guest); // the paper card
    // Every line of the text part is in the html's words, except a link line (drawn as a link or a button).
    const links = LINKS(id);
    const text = words(html);
    // (E4's "Print the tag: <url>" text line is the P.S. link in the HTML.)
    for (const line of r.text
      .split('\n')
      .filter((l) => l.trim() && !links.includes(l) && !l.startsWith('Print the tag: '))) {
      expect(text, line).toContain(line.trim().replace(/^- /, '')); // a digest line's "- " is the list bullet (EML-09)
    }
    // Guest emails sign off "Jon" on its own line; Jon-facing ones don't (as the text part).
    expect(/<p style="[^"]*">Jon<\/p>/.test(html)).toBe(!JON_FACING.includes(id));
    expect(html.includes('P.S.'), id).toBe(id === 'E4'); // E4 carries the no-gifts P.S. (r6 fix 4)
    // The link line: one <a> to it, labelled with src/content copy (EML-03: never the URL itself): a dark button in
    // Jon's card, an underlined text link in a guest's note. (E4's P.S. "Print the tag" link is checked apart.)
    const anchors = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
      .map((m) => [m[1], m[2]])
      .filter(([href]) => href !== `${SITE}/tag`);
    expect(/display:inline-block/.test(html), id).toBe(!guest && links.length > 0);
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
    expect(words(html.replace(/<title>[^<]*<\/title>/, ''))).toMatch(/^These are still open:/);
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

  it('QA4b M3: a host’s E12 names the guests joined to the booking, before the link', async () => {
    const r = await renderEmail(
      'E12',
      { ...VARS.E12, joined: 'Joined to it: Kim, Alex.' },
      { siteUrl: SITE },
    );
    expect(r.text).toBe(
      'Sam cancelled The Long Lunch (Thu Oct 1 · noon–2 pm). Stand-by for that week: Alex, Kim.\nJoined to it: Kim, Alex.\nhttps://timewithjon.com/admin/requests/0f6c1f4e-1111-4222-8333-444455556666\n',
    );
    expect(words(r.html!)).toContain('Joined to it: Kim, Alex.');
    // No joined guests: the line is not there (and old rows without the var render as before).
    expect((await renderEmail('E12', { ...VARS.E12, joined: '' }, { siteUrl: SITE })).text).not.toContain(
      'Joined',
    );
  });

  it('QA4b M2: the hourly digest keeps each request’s own link, and tag-like name text is escaped, not dropped', async () => {
    const lines = [
      '- New request: The Long Lunch from Sam مرحبا <b>x</b>',
      `  ${SITE}/admin/requests/1`,
      '- Updated: The Flat White from Kim',
      `  ${SITE}/admin/requests/2`,
      '- Calendar update',
    ].join('\n');
    const r = await renderEmail(
      'E13',
      { digest: 'hourly', count: 3, lines, adminLink: `${SITE}/admin` },
      { siteUrl: SITE },
    );
    expect(r.text).toContain(
      `- New request: The Long Lunch from Sam مرحبا <b>x</b>\n  ${SITE}/admin/requests/1\n`,
    );
    expect(r.html!.match(/<li>.*?<\/li>/g)).toEqual([
      `<li><a href="${SITE}/admin/requests/1" style="color:#1f1f1f;text-decoration:underline">New request: The Long Lunch from Sam مرحبا &lt;b&gt;x&lt;/b&gt;</a></li>`,
      `<li><a href="${SITE}/admin/requests/2" style="color:#1f1f1f;text-decoration:underline">Updated: The Flat White from Kim</a></li>`,
      '<li>Calendar update</li>',
    ]);
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
      https://timewithjon.com/r/manage/tok_3f9a2b7c

      Jon

      P.S. No gifts. Really. The one thing I’ll take is a bottle of wine with a letter or an old photo tucked in. Write on the tag when I should open it. Bring it when we meet.
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
          "text": "Sam cancelled The Long Lunch (Thu Oct 1 · noon–2 pm). Stand-by for that week: Alex, Kim.
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
      https://timewithjon.com/r/manage/tok_3f9a2b7c#another

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

      P.S. No gifts. Really. The one thing I’ll take is a bottle of wine with a letter or an old photo tucked in. Write on the tag when I should open it. Bring it when we meet.
      Print the tag: https://timewithjon.com/tag
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
      https://timewithjon.com/r/manage/tok_3f9a2b7c
      Or just call me.

      Jon
      ",
        },
        "E6": {
          "fromLocal": "jon",
          "subject": "You’re on stand-by",
          "text": "You’re on stand-by for the week of Oct 5. If something opens up, I’ll email you.
      https://timewithjon.com/r/manage/tok_3f9a2b7c
      Or just call me.

      Jon
      ",
        },
        "E7": {
          "fromLocal": "jon",
          "subject": "Friday just opened up",
          "text": "Fri Oct 2 · noon–2 pm Vancouver time is free now. Want it? It’s yours until Sun Oct 4 · 9 am Vancouver time.
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

describe('Jon’s copy answers 2026-10-09', () => {
  const r = (id: TemplateId, vars: Record<string, string | number>) =>
    renderEmail(id, vars, { siteUrl: SITE });
  // The action link (in a guest's note: an underlined text link, r6 fix 3); the first link in the email.
  const button = (html: string) =>
    /<a href="([^"]+)" style="color:#1f1f1f;text-decoration:underline">([^<]+)<\/a>/.exec(html);

  it('UX-09 / F20: E1 carries the manage link as a "Change or cancel" button; an old row without one still sends', async () => {
    const e1 = await r('E1', VARS.E1);
    expect(button(e1.html!)?.slice(1)).toEqual([VARS.E1.manageLink, 'Change or cancel']);
    expect(e1.text).toContain(`I’ll lock one in within two days.\n${VARS.E1.manageLink}\n`);
    const old = await r('E1', { dish: 'The Long Lunch', times: 'Thu Oct 1 · noon–2 pm Vancouver time' });
    expect(old.text).not.toContain('{manageLink}');
    expect(old.html).not.toContain('Change or cancel');
  });

  it('Q1: E4 drops "You pick the place" for a joined guest or a set place, and only then', async () => {
    expect((await r('E4', VARS.E4)).text).toContain('You pick the place, just tell me where.');
    const set = await r('E4', { ...VARS.E4, placeKnown: 1 });
    expect(set.text).toMatch(
      /^Thu Oct 1 · noon–2 pm Vancouver time\. The calendar invite comes from Time with Jon, so look out for it\./,
    );
    expect(words(set.html!)).not.toContain('You pick the place');
  });

  it('Q3: the guest buttons are "Take it", "Pick a new date" and "Change or cancel"', async () => {
    for (const [id, label] of [
      ['E4', 'Change or cancel'],
      ['E5', 'Take it'],
      ['E5b', 'Take it'],
      ['E7', 'Take it'],
      ['E10', 'Pick a new date'],
      ['E17', 'Pick a new date'],
    ] as const)
      expect(button((await r(id, VARS[id])).html!)?.[2], id).toBe(label);
  });

  it('Q4: E7 says until when the offer is yours; an old row without {until} reads as before', async () => {
    expect((await r('E7', VARS.E7)).text).toMatch(
      /^Fri Oct 2 · noon–2 pm Vancouver time is free now\. Want it\? It’s yours until Sun Oct 4 · 9 am Vancouver time\.\n/,
    );
    const old: Record<string, string | number> = { ...VARS.E7 };
    delete old.until;
    expect((await r('E7', old)).text).toMatch(/Want it\?\nhttps/);
  });

  it('Q6: one item reads in the singular (E1, E5, E5b, E16)', async () => {
    const one = 'Thu Oct 1 · noon–2 pm Vancouver time';
    expect((await r('E1', { ...VARS.E1, times: one })).text).toMatch(/^Got your time:\n/);
    expect((await r('E1', VARS.E1)).text).toMatch(/^Got your times:\n/);
    expect((await r('E5', { ...VARS.E5, times: one })).text).toContain(
      'That one went. This one’s still open:\n',
    );
    const e5b = await r('E5b', { ...VARS.E5b, openTimes: E5B_PARTS.withTimes(one) });
    expect(e5b.text).toContain('This one’s still open:\nThu Oct 1');
    expect(e5b.html!.match(/<li>[^<]*<\/li>/g)).toEqual([`<li>${one}</li>`]); // still drawn as a list
    expect((await r('E16', { ...VARS.E16, count: 1 })).text).toMatch(/^Sam picked a new time for/);
    expect((await r('E16', { ...VARS.E16, count: 2 })).text).toMatch(/^Sam picked new times for/);
  });

  it('Q8: E17 keeps Jon’s words and adds the button to the manage page', async () => {
    const e17 = await r('E17', VARS.E17);
    expect(e17.text).toBe(`${EMAIL_COPY.E17.body.split('\n')[0]}\n${VARS.E17.manageLink}\n\nJon\n`);
    expect((await r('E17', {})).text).not.toContain('{manageLink}'); // a row queued before Q8
  });
});

describe('Jon’s answers r6 (2026-10-09)', () => {
  const r = (id: TemplateId, vars: Record<string, string | number>) =>
    renderEmail(id, vars, { siteUrl: SITE });
  const one = 'Thu Oct 1 · noon–2 pm Vancouver time';

  it('Q1: Jon set the place: "Where: {place}." takes the spot of "You pick the place"', async () => {
    const e4 = await r('E4', { ...VARS.E4, placeKnown: 1, where: 'Tomahawk, North Van' });
    expect(e4.text).toMatch(
      /^Thu Oct 1 · noon–2 pm Vancouver time\. Where: Tomahawk, North Van\. The calendar invite comes from Time with Jon/,
    );
    expect(words(e4.html!)).toContain('Where: Tomahawk, North Van.');
    expect(e4.text).not.toContain('You pick the place');
  });

  it('Q2: a call (placeKnown, no place): no place line at all', async () => {
    const e4 = await r('E4', { ...VARS.E4, placeKnown: 1 });
    expect(e4.text).toMatch(/^Thu Oct 1 · noon–2 pm Vancouver time\. The calendar invite comes from/);
    expect(e4.text).not.toMatch(/You pick the place|Where:/);
  });

  it('Q3a: one offered time reads "This one’s still open:" … "Tap it and it’s yours." (E5, E5b); several keep "Tap one"', async () => {
    const e5 = await r('E5', { ...VARS.E5, times: one });
    expect(e5.text).toContain(`This one’s still open:\n${one}\nTap it and it’s yours.\n`);
    expect((await r('E5', VARS.E5)).text).toContain('Tap one and it’s yours.');
    const e5b = await r('E5b', { ...VARS.E5b, openTimes: E5B_PARTS.withTimes(one) });
    expect(e5b.text).toContain('Tap it and it’s yours.');
    expect(e5b.html!.match(/<li>[^<]*<\/li>/g)).toEqual([`<li>${one}</li>`]); // still the list frame
    expect(E5B_PARTS.withTimes(`${one}\n${one}`)).toContain('Tap one and it’s yours.');
  });

  it('Q3b: a shorter pitch with only a rough window (no times or dates) reads "picked a new time"', async () => {
    expect((await r('E16', { ...VARS.E16, count: 0 })).text).toMatch(/^Sam picked a new time for/);
    expect((await r('E16', VARS.E16)).text).toMatch(/^Sam picked new times for/); // a row queued without a count
  });

  it('Q3c: E1 for a pitch with only a rough window: "Email me your idea, or let’s talk." (that case only)', async () => {
    const e1 = await r('E1', {
      dish: 'Pitch Me',
      times: '',
      manageLink: VARS.E1.manageLink!,
      pitchWindowOnly: 1,
    });
    expect(e1.text).toMatch(/^Email me your idea, or let’s talk\.\nhttps:/);
    expect(e1.html).toContain('Change or cancel');
    const other = await r('E1', { dish: 'Pitch Me', times: '', manageLink: VARS.E1.manageLink! });
    expect(other.text).toMatch(/^Got your times\. I’ll lock one in within two days\./);
  });

  it('Q3d: E12 ends its stand-by sentence with a full stop', async () => {
    expect((await r('E12', { ...VARS.E12, standby: 'nobody' })).text).toContain(
      'Stand-by for that week: nobody.\n',
    );
  });

  it('Q4: E6 and E5j get "Change or cancel" with "Or just call me." under it; a row queued before has neither', async () => {
    for (const id of ['E6', 'E5j'] as const) {
      const m = await r(id, VARS[id]);
      expect(m.text, id).toContain(`\n${VARS[id].manageLink}\nOr just call me.\n\nJon\n`);
      const html = m.html!;
      expect(html, id).toMatch(/>Change or cancel<\/a>/);
      expect(html.indexOf('Or just call me.'), id).toBeGreaterThan(html.indexOf('Change or cancel'));
      const old: Record<string, string | number> = { ...VARS[id] };
      delete old.manageLink;
      const before = await r(id, old);
      expect(before.text, id).not.toMatch(/Or just call me|\{/);
      expect(before.html, id).not.toContain('<a ');
    }
  });
});
