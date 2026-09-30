// pr28 review M2: an email never goes out with a literal {placeholder} in it; rendering fails closed.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMAIL_COPY, JON_FACING, POSTSCRIPT, type TemplateId } from '@/content/emails';
import { renderEmail, renderText, UnfilledPlaceholderError } from '@/features/email/registry';

const E4_VARS = { dish: 'The Long Lunch', day: 'Thu May 13', when: 'Thu May 13, 12:00 Vancouver time' };

describe('renderText', () => {
  it('renders when every placeholder is filled', () => {
    const r = renderText('E4', { ...E4_VARS, manageLink: 'https://timewithjon.com/m/abc' });
    expect(r.subject).toBe('Locked in: The Long Lunch, Thu May 13');
    expect(r.text).toContain('https://timewithjon.com/m/abc');
    expect(r.text).not.toMatch(/\{\w+\}/);
  });
  it('throws on an unfilled placeholder in the body (E4 without {manageLink}) or the subject', () => {
    expect(() => renderText('E4', E4_VARS)).toThrow(UnfilledPlaceholderError);
    const noDish = { day: E4_VARS.day, when: E4_VARS.when, manageLink: 'x' };
    expect(() => renderText('E4', noDish)).toThrow(UnfilledPlaceholderError); // {dish} in the subject
  });
  it('a guest-typed brace in a value still sends and keeps the literal (pr28-verify M3)', () => {
    const r = renderText('E2', {
      dish: 'The Long Lunch',
      name: 'Sam {Jr}',
      summary: '{x}',
      adminLink: 'https://a/b',
    });
    expect(r.subject).toBe('New request: The Long Lunch from Sam {Jr}');
    expect(r.text).toContain('Sam {Jr} wants The Long Lunch. {x}');
  });
  it('the error names the template only, never a var value', () => {
    try {
      renderText('E4', { ...E4_VARS, when: 'dave@example.com' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe('E4');
      expect((e as Error).name).toBe('UnfilledPlaceholderError');
    }
  });
});

// Jon decisions 45 + 47a (lane U13): the no-gifts P.S. sits under the signature of E1 "Got it", text and HTML, and
// links to the printable tag (S12b) on the site origin. Words: v22-copy.md "v2.2b (dec 44-45)".
const PS =
  'No gifts. Really. The one thing I’ll take is a bottle of wine with a letter or an old photo tucked in. ' +
  'Write on the tag when I should open it. Bring it when we meet.';
const SITE = 'https://timewithjon.com';

describe('E1 "Got it" carries the no-gifts P.S. (decision 45)', () => {
  const vars = { dish: 'The Long Lunch', times: 'Thu Oct 1, 12:00 pm\nSat Oct 3, 6:00 pm' };
  const r = renderText('E1', vars, { siteUrl: SITE });
  let html = '';
  beforeAll(async () => {
    const full = await renderEmail('E1', vars, { siteUrl: SITE });
    expect(full.text).toBe(r.text); // the text part is unchanged by the HTML
    html = full.html!;
  });
  it('text: the body, the signature, then the P.S. and the tag link, word for word', () => {
    expect(r.text).toBe(
      `Got your times:\nThu Oct 1, 12:00 pm\nSat Oct 3, 6:00 pm\nI’ll lock one in within two days.\n\nJon\n\nP.S. ${PS}\nPrint the tag: ${SITE}/tag\n`,
    );
    expect(r.subject).toBe('Got it: The Long Lunch');
    expect(r.fromLocal).toBe('jon');
  });
  it('html: the same words, the P.S. after the signature, "Print the tag" linking to the tag page', () => {
    expect(html).toMatch(/^<!doctype html/i);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain(
      'Got your times: Thu Oct 1, 12:00 pm Sat Oct 3, 6:00 pm I’ll lock one in within two days.',
    );
    expect(text).toContain(`P.S. ${PS} Print the tag`);
    expect(html.indexOf('>Jon</p>')).toBeGreaterThan(html.indexOf('Got your times'));
    expect(html.indexOf('P.S.')).toBeGreaterThan(html.indexOf('>Jon</p>'));
    expect(html).toContain(
      `<a href="${SITE}/tag" style="color:#1f1f1f;text-decoration:underline">Print the tag</a>`,
    );
    expect(html).toContain('<title>Got it: The Long Lunch</title>');
  });
  it('an E1 queued without times (before option A) keeps the old body instead of failing', () => {
    expect(renderText('E1', { dish: 'x' }, { siteUrl: SITE }).text).toMatch(
      /^Got your times\. I’ll lock one in within two days\.\n\nJon\n/,
    );
  });
  it('html escapes a guest-supplied value (the dish name in the title) and every colour is a token value', async () => {
    const h = (await renderEmail('E1', { dish: '<b>&"x"', times: 'Thu Oct 1, 12:00 pm' }, { siteUrl: SITE }))
      .html!;
    expect(h).toContain('<title>Got it: &lt;b&gt;&amp;&quot;x&quot;</title>');
    expect(h).not.toContain('<b>');
    const tokenHexes = new Set(['#1f1f1f', '#34312c', '#595449', '#e9e6de', '#f4f2ec']);
    for (const hex of html.match(/#[0-9a-f]{6}\b/gi)!) expect(tokenHexes, hex).toContain(hex.toLowerCase());
  });
  it('only E1 has a P.S.; every other template renders as before (text only, no P.S.)', () => {
    expect(Object.keys(POSTSCRIPT)).toEqual(['E1']);
    for (const id of Object.keys(EMAIL_COPY) as TemplateId[]) {
      if (id === 'E1') continue;
      const vars = Object.fromEntries(
        [...`${EMAIL_COPY[id].subject}${EMAIL_COPY[id].body}`.matchAll(/\{(\w+)\}/g)].map((m) => [
          m[1]!,
          'v',
        ]),
      );
      const out = renderText(id, vars, { siteUrl: SITE });
      expect(out.html, id).toBeUndefined(); // renderText is the text part only; renderEmail adds the HTML
      expect(out.text, id).not.toContain('P.S.');
      expect(out.fromLocal, id).toBe(JON_FACING.includes(id) ? 'admin' : 'jon');
    }
  });
});

// pr88-review F1: the production caller (send.ts) passes NO opts, so the tag link comes from getEnv(); the site URL
// default itself is under test (a hard-coded localhost or a missing env read would fail here).
describe('E1 P.S. tag link without opts (production path)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it('uses NEXT_PUBLIC_SITE_URL from the env in both the text and the html', async () => {
    // the minimum valid prototype env (placeholders, as scripts/ci-placeholder-env.sh), then the value under test
    const base = {
      APP_MODE: 'prototype',
      ADMIN_EMAILS: 'jon@example.com',
      SESSION_SIGNING_SECRET: 'test-placeholder-session-secret-000000000000',
      SUPABASE_URL: 'https://placeholder.supabase.co',
      SUPABASE_ANON_KEY: 'test-placeholder',
      SUPABASE_SERVICE_ROLE_KEY: 'test-placeholder',
      DATABASE_URL: 'postgres://postgres:test@127.0.0.1:55432/postgres',
      CRON_SECRET: 'test-placeholder-cron-secret-00000000000000',
      DATABASE_SSL: 'disable',
      DEV_PASSPHRASE: 'test-placeholder-passphrase',
    };
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.example');
    vi.resetModules(); // a fresh env module: getEnv() caches its first parse
    const { renderEmail: render } = await import('@/features/email/registry');
    const r = await render('E1', { dish: 'x', times: 'Thu Oct 1, 12:00 pm' });
    for (const part of [r.text, r.html!]) {
      expect(part).toContain('https://staging.example/tag');
      expect(part).not.toContain('localhost');
    }
  });
});
