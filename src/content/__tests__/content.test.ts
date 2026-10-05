// src/content/__tests__/content.test.ts — T0.3 AC1 + AC2
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as content from '@/content';
import * as inviteText from '@/content/invite-text';
import * as guestAfter from '@/content/ui/guest-after';
import { ADMIN_SIGN_IN_EMAIL, DISHES, HERO_BODY, OPEN_LINE } from '@/content';

// Machine keys (enums, slugs) are data, not copy; everything else is scanned.
const DATA_KEYS = new Set([
  'slug',
  'section',
  'mode',
  'flow',
  'windows',
  'countsToward',
  'datesCountToward',
  'dateRule',
  'id',
  'availableUntil',
  'JON_FACING',
]);
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'function') {
    const fn = v as (...a: unknown[]) => string;
    out.push(String(fn.length === 1 && fn.toString().includes('things') ? fn(['X', 'Y']) : fn('X', 'Y')));
  } else if (v && typeof v === 'object')
    Object.entries(v).forEach(([k, x]) => {
      if (!DATA_KEYS.has(k)) strings(x, out);
    });
  return out;
}
// The Supabase sign-in email template (AD-7, v1.10) is guest-invisible but still Time with Jon copy.
const SIGN_IN_TEMPLATE = readFileSync(
  path.resolve(__dirname, '../../../supabase/templates/admin-sign-in.html'),
  'utf8',
);
const SUPABASE_CONFIG = readFileSync(path.resolve(__dirname, '../../../supabase/config.toml'), 'utf8');
const ALL = [...strings(content), SIGN_IN_TEMPLATE];
// Everything except the invite-text module (by export, not by value: the same sentence elsewhere must fail).
const notInviteText = Object.fromEntries(Object.entries(content).filter(([k]) => k !== 'INVITE_TEXT'));
const ALL_BUT_INVITE_TEXT = [...strings(notInviteText), SIGN_IN_TEMPLATE];
const NON_HERO = ALL.filter(
  (s) =>
    s !== HERO_BODY && s !== OPEN_LINE && !/^We keep saying we should do .+ or that epic trip\.$/.test(s),
);
/** Jon's own sign-off (2026-10-05) keeps his "!": the only exemption, for that exact line only. */
const exempt = (re: RegExp, s: string) => re.source === '!' && s === content.STORY_BLOCK.signOff;
const BANNED = [
  /\bjohn\b/i,
  /—/,
  /\bdeclin/i,
  /!/,
  /\bunlock/i,
  /\belevate/i,
  /\bjourney/i,
  /\bembark/i,
  /\bcurat(e|ed)\b/i,
  /\bunforgettable/i,
  /\bmilestone/i,
  /\bcelebrat/i,
  /\bexperiences\b/i,
  /\bmemories\b/i,
  /\bmoments\b/i,
  /\bcherish/i,
  /\btreasure/i,
  /\bmeaningful/i,
  /\breconnect/i,
  /\badventure/i,
  /\bvibes\b/i,
  /join me/i,
  /make memories/i,
  /show up for/i,
  /hold space/i,
  /\blegacy\b/i,
  /while we still can/i,
  /before it's too late/i,
  /time left/i,
  /weeks left/i,
  /ones who matter most/i,
  /life's short/i,
  /bucket list/i,
  /alright, alright/i,
  /\bslots?\b/i,
  /\bavailability\b/i,
  /\bunavailable\b/i,
  /fully booked/i,
  /sold out/i,
  /\bschedul/i,
  /confirm booking/i,
];
describe('T0.3 content', () => {
  it('AD-7 the sign-in template carries the 6-digit code and the token_hash link (not the PKCE ConfirmationURL)', () => {
    expect(SIGN_IN_TEMPLATE).toContain('<strong>{{ .Token }}</strong>');
    // The link lands on our own callback, which calls verifyOtp({ token_hash, type }) (T2.1.04). It needs no PKCE
    // verifier cookie, so it also works in Gmail's in-app browser (orchestrator decision 2026-09-25).
    expect(SIGN_IN_TEMPLATE).toMatch(
      /href="\{\{ \.SiteURL \}\}\/admin\/auth\/callback\?token_hash=\{\{ \.TokenHash \}\}&type=email"/,
    );
    expect(SIGN_IN_TEMPLATE).not.toContain('ConfirmationURL');
  });
  it('AD-7 the sign-in email names Time with Jon, and config.toml carries its subject, file and 15 minutes', () => {
    expect(SIGN_IN_TEMPLATE.split('\n')[0]).toBe(`<p>${ADMIN_SIGN_IN_EMAIL.heading}</p>`);
    expect(ADMIN_SIGN_IN_EMAIL.heading).toContain('Time with Jon');
    expect(SUPABASE_CONFIG).toContain(`subject = "${ADMIN_SIGN_IN_EMAIL.subject}"`);
    expect(SUPABASE_CONFIG).toMatch(
      /\[auth\.email\.template\.magic_link\]\nsubject = "Your Time with Jon sign-in code"\ncontent_path = "\.\/supabase\/templates\/admin-sign-in\.html"\n/,
    );
    expect(SUPABASE_CONFIG).toMatch(/^otp_expiry = 900$/m);
    expect(SIGN_IN_TEMPLATE).toContain('It works for 15 minutes.');
  });
  it('AC1 no banned words, em-dashes, "decline", "John" or Calendly words', () => {
    const hits = ALL.flatMap((s) =>
      BANNED.filter((re) => re.test(s) && !exempt(re, s)).map((re) => `${re} :: ${s}`),
    );
    expect(hits).toEqual([]);
  });
  it('AC1 the one "!" is Jon’s own sign-off, word for word (approved 2026-10-05), and nothing else has one', () => {
    expect(content.STORY_BLOCK.signOff).toBe('As always, looking forward to whatever is next! - Jon');
    expect(ALL.filter((s) => s.includes('!'))).toEqual([content.STORY_BLOCK.signOff]);
  });
  it('AC1 holds for the guest-after lane copy too (src/content/ui/guest-after.ts: S11, picker, stand-by, stale)', () => {
    const lines = strings(guestAfter);
    expect(lines.length).toBeGreaterThanOrEqual(10);
    const hits = lines.flatMap((s) => BANNED.filter((re) => re.test(s)).map((re) => `${re} :: ${s}`));
    expect(hits).toEqual([]);
  });
  it('AC1 "epic" appears only in the hero lines, and "quality time" nowhere on the page (creative v1.4 §3)', () => {
    expect(NON_HERO.filter((s) => /\bepic\b/i.test(s))).toEqual([]);
    expect(ALL_BUT_INVITE_TEXT.filter((s) => /quality time/i.test(s))).toEqual([]);
    // The one exemption (T2.6.02): the invite text Jon sends, off the page.
    expect(strings(inviteText).filter((s) => /quality time/i.test(s))).toHaveLength(2);
  });
  it('AC2 15 dishes (v2.1: + The Day Trip, Something New; v2.2: + The Double Date, The Family Hang; 2026-10-05: the Bluebird is off the menu), 4 sections, verbatim spot checks', () => {
    expect(DISHES).toHaveLength(15);
    expect(new Set(DISHES.map((d) => d.section)).size).toBe(4);
    expect(DISHES.find((d) => d.slug === 'the-long-lunch')?.line).toBe(
      'You pick the place. I pick up the bill. Order the halibut.',
    );
    expect(DISHES.find((d) => d.slug === 'catch-and-release')?.line).toBe(
      'Standing in a river, maybe catching a fish. Best meeting you’ll have all year.',
    );
    expect(DISHES.map((d) => d.slug as string)).not.toContain('the-bluebird'); // Jon, 2026-10-05
    expect(DISHES.find((d) => d.slug === 'the-grind')?.name).toBe('A hike or nature moment'); // Jon, 2026-10-05
  });
});

describe('QA r2 L2: the booking screens write lunch as the menu does', () => {
  it('no dish detail says "12–2"; the lunch dishes say "noon–2 pm"', async () => {
    const { DISHES } = await import('../menu');
    for (const d of DISHES) expect(d.detail, d.slug).not.toMatch(/\b12–2\b/);
    const lunch = DISHES.filter((d) => ['the-flat-white', 'the-long-lunch'].includes(d.slug));
    expect(lunch.map((d) => d.detail.includes('Thu/Fri, noon–2 pm'))).toEqual([true, true]);
  });
});

describe('the hike inside a sentence (Jon, 2026-10-05)', () => {
  it('its title keeps the capital; in a sentence it is lowercase; after a possessive it drops its article', async () => {
    const { dishBySlug, dishAfterPossessive, dishInSentence, inSentence } = await import('../menu-helpers');
    const { PERSONAL } = await import('../site');
    const hike = dishBySlug('the-grind')!;
    expect(hike.name).toBe('A hike or nature moment');
    expect(inSentence(hike)).toBe('a hike or nature moment');
    expect(PERSONAL.pickedLine(inSentence(hike))).toBe(
      'I was thinking a hike or nature moment, but anything on the menu is yours.',
    );
    expect(PERSONAL.book(inSentence(hike))).toBe('Book a hike or nature moment');
    expect(dishInSentence('the-grind')).toBe('a hike or nature moment');
    expect(dishInSentence('the-long-lunch')).toBe('The Long Lunch'); // the others are names in a sentence too
    expect(dishAfterPossessive('the-grind')).toBe('hike or nature moment');
    expect(dishAfterPossessive('the-long-lunch')).toBe('Long Lunch');
  });
});
