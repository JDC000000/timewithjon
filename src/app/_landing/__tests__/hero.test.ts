// T1.2 AC2-AC4 as rendered: S1 open hero, S2 personal hero (pack s01/s02), the gate note in place of Book.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dishBySlug } from '@/content/menu-helpers';
import { landingModel } from '@/features/invites/landing-model';
import type { Invite } from '@/features/invites/repo';
import { PHOTO_SIZES } from '@/ui/photo-sizes';
import { Hero } from '../Hero';
import { PersonalHero, type PersonalModel } from '../PersonalHero';

const inv = (over: Partial<Invite>): Invite => ({
  id: 'i',
  kind: 'personal',
  is_test: true,
  name_slug: 'dave',
  display_name: 'Dave',
  our_things: ['the Seymour lap', 'Tofino again'],
  picked_dish: 'the-shore-ride',
  prefill_name: null,
  prefill_email: null,
  revoked_at: null,
  ...over,
});
const personal = (
  over: Partial<Invite> = {},
  gate: Parameters<typeof PersonalHero>[0]['gate'] = { kind: 'book' },
) => {
  const i = inv(over);
  const model = landingModel({ state: 'valid', invite: i }) as PersonalModel;
  const dish = i.picked_dish ? (dishBySlug(i.picked_dish) ?? null) : null;
  return renderToStaticMarkup(createElement(PersonalHero, { model, dish, gate }));
};
const text = (html: string) => html.replace(/<[^>]+>/g, '');
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map(
    (m) => [m[1] ?? '', text(m[2] ?? '')] as const,
  );

describe('S1 open hero', () => {
  const html = renderToStaticMarkup(
    createElement(Hero, {
      model: landingModel({ state: 'none' }) as Extract<ReturnType<typeof landingModel>, { variant: 'open' }>,
    }),
  );
  it('one h1: the fixed open line, then How about now?', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text(html.match(/<h1.*<\/h1>/)![0])).toBe(
      'We keep saying we should get or do that epic trip.How about now?',
    );
  });
  it('the CTA goes to the activity menu (ROUTES.menu = /menu, the S04 page, decision 37b/c)', () => {
    expect(links(html)).toEqual([['/menu', 'See the activity menu →']]);
  });
  it('the fact line keeps "April 1" whole', () => {
    expect(html).toContain(
      '<p class="lead fact">I turn 50 on <wbr/><span class="nw">April 1</span>. No joke.</p>',
    );
  });
  it('the hero photo stands alone: a real <img> in the slot, nothing else on it (41c), not hidden from AT (pr73 F8)', () => {
    const fig = html.match(/<figure[^>]*>.*?<\/figure>/)![0];
    expect(fig).toMatch(/^<figure class="ph ph--hero" data-slot="hero"><img [^>]*\/><\/figure>$/);
    expect(fig).not.toContain('aria-hidden');
    expect(fig).toContain('alt=""');
    expect(fig).toContain('src="/img/hero-480.webp"');
    expect(fig).toContain(
      'srcSet="/img/hero-480.webp 480w, /img/hero-800.webp 800w, /img/hero-1200.webp 1200w, /img/hero-1600.webp 1600w"',
    );
    expect(fig).toContain(`sizes="${PHOTO_SIZES.hero}"`);
    expect(fig).toContain('loading="eager"');
    expect(fig).toContain('fetchPriority="high"');
    expect(text(html)).not.toMatch(/For Jon|opens with/i);
  });
});

describe('S2 personal hero', () => {
  it('AC2: "Dave." then the one line everyone sees (Jon, 2026-10-05), then How about now?', () => {
    const h1 = text(personal().match(/<h1.*<\/h1>/)![0]);
    expect(h1).toBe('Dave.We keep saying we should get or do that epic trip.How about now?');
  });
  it('AC2: an invite’s things never show, with or without them (and nothing of theirs reaches the page)', () => {
    expect(text(personal({ our_things: [] }))).toContain(
      'Dave.We keep saying we should get or do that epic trip.',
    );
    const html = personal({ our_things: ['<b>x</b> & co'] });
    expect(html).not.toContain('&lt;b&gt;x');
    expect(html).not.toContain('<b>x</b>');
  });
  it('Book {dish} skips the sheet (G0.5 #4); the dish name links to its course; See the whole activity menu', () => {
    expect(links(personal())).toEqual([
      ['/menu#big-days', 'The Shore Ride'],
      ['/book/the-shore-ride', 'Book The Shore Ride'],
      ['/menu', 'See the whole activity menu'],
    ]);
    expect(text(personal())).toContain('I was thinking The Shore Ride, but anything on the menu is yours.');
  });
  it('AC4: a picked dish that is not bookable gets no Book button and one menu link', () => {
    expect(links(personal({ picked_dish: 'the-bluebird' })).filter(([h]) => h.startsWith('/book'))).toEqual(
      [],
    );
    expect(
      links(personal({ picked_dish: 'the-bluebird' })).filter(([, t]) => t === 'See the whole activity menu'),
    ).toHaveLength(1);
  });
  it('no picked dish: the hero body, one menu link', () => {
    const html = personal({ picked_dish: null });
    expect(text(html)).toContain('Pick something off the menu and I');
    expect(links(html)).toEqual([['/menu', 'See the whole activity menu']]);
  });
  it('before release the gate line stands where Book was; the menu link stays', () => {
    const html = personal({}, { kind: 'note', text: 'Booking opens February 25.' });
    expect(links(html).map(([h]) => h)).toEqual(['/menu#big-days', '/menu']);
    expect(text(html)).toContain('Booking opens February 25.');
  });
});
