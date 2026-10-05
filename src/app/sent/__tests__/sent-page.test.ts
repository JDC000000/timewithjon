// T1.8.U1 S11: the server-rendered HTML. AC3 (no or expired capability → the stale line), AC4 (before-60 off →
// its field is absent from the DOM), the receipt lines and "Sent to {email}", and the stand-by variant.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AFTER_SEND, GUEST_LABEL, NO_GIFTS_PS } from '@/content';
import { ROUTES } from '@/ui/routes';
import { AFTER_SEND_STANDBY, SENT_UI, STALE } from '@/content/ui/guest-after';
import type { SentModel } from '../model';

const model = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/invites/capability', () => ({ readRequestCapability: async () => 'req-1' }));
vi.mock('../model', () => ({ loadSentModel: async () => model.current }));

/** The text of the markup, tags removed. */
const plain = (h: string) => h.replace(/<[^>]+>/g, '');
/** React escapes apostrophes in text. */
const esc = (s: string) => s.replaceAll("'", '&#x27;');

const sent = (over: Partial<Extract<SentModel, { kind: 'sent' }>> = {}): SentModel => ({
  kind: 'sent',
  dishName: 'The Long Lunch',
  lines: ['Fri May 14 · noon–2 pm', 'Thu May 20 · noon–2 pm'],
  standby: null,
  sentTo: 'priya@example.com',
  fromAddress: 'jon@timewithjon.com',
  before60: false,
  ...over,
});

async function html(m: SentModel): Promise<string> {
  model.current = m;
  const { default: SentPage } = await import('../page');
  return renderToStaticMarkup(await SentPage());
}

describe('S11 /sent', () => {
  beforeEach(() => vi.resetModules());

  it('shows Sent., the promise, the receipt and the sent-to line', async () => {
    const h = await html(sent());
    expect(h).toContain('>Sent.<');
    expect(h).toContain(esc(AFTER_SEND.promise('jon@timewithjon.com')));
    expect(h).toContain('The Long Lunch');
    // the receipt keeps each date and time whole (KeepWhole: span.nw + wbr, the pack's markup)
    expect(h).toContain(
      '<li><span class="nw">Fri <span class="nw">May 14</span></span> · <wbr/><span class="nw">noon–2 pm</span></li>',
    );
    expect(plain(h)).toContain('Thu May 20 · noon–2 pm');
    expect(h).toContain(AFTER_SEND.sentTo('priya@example.com'));
    expect(h).toContain(esc(AFTER_SEND.question));
    expect(h).toContain(AFTER_SEND.skip);
  });

  it('AC4: with before-60 off its field is not in the DOM; on, it is', async () => {
    expect(await html(sent())).not.toContain(AFTER_SEND.before60.slice(0, 20));
    expect(await html(sent({ before60: true }))).toContain(AFTER_SEND.before60.slice(0, 20));
  });

  it('AC3: no capability → the friendly stale line, and no form', async () => {
    const h = await html({ kind: 'stale' });
    expect(h).toContain(`<p class="status-pill">${STALE.pill}</p>`);
    expect(h).toContain(esc(STALE.title));
    expect(h).not.toContain('<form');
  });

  it('a stand-by request shows the approved stand-by label, the week, and the stand-by days line (decision 49)', async () => {
    const h = await html(sent({ lines: [], standby: { week: 'Apr 12', days: 'Apr 15–16' } }));
    expect(h).toContain(`<span class="swipe">${GUEST_LABEL.standby}</span>`);
    expect(h).toContain(esc(AFTER_SEND_STANDBY.promise('Apr 12')));
    // pr90 F2: model.standby.days now feeds the receipt's one line.
    const receipt = /class="receipt">((?:(?!<\/div>).)*)/s.exec(h)![1]!;
    expect(receipt.match(/<li>/g)).toHaveLength(1);
    expect(plain(receipt)).toContain(AFTER_SEND_STANDBY.receiptLine('Apr 15–16'));
    expect(h).not.toContain('>Sent.<');
  });

  it('decision 45: the no-gifts P.S. sits at the foot, after the form, from the one NO_GIFTS_PS source, linking the tag', async () => {
    for (const m of [sent(), sent({ lines: [], standby: { week: 'Apr 12', days: 'Apr 15–16' } })]) {
      const h = await html(m);
      const ps = `<aside class="ps" aria-label="${NO_GIFTS_PS.mark}"><p><span class="ps-mark">${NO_GIFTS_PS.mark}</span> ${NO_GIFTS_PS.text} <a href="${ROUTES.tag}">${NO_GIFTS_PS.printTag}</a></p></aside>`;
      expect(h).toContain(ps);
      expect(h.indexOf(ps)).toBeGreaterThan(h.indexOf('</form>'));
      expect(h.indexOf('</form>')).toBeGreaterThan(0);
      expect(h).toContain(`${ps}</div></main>`);
    }
    expect(await html({ kind: 'stale' })).not.toContain(NO_GIFTS_PS.text);
  });

  it('v2.2 pack: the hero photo (sent ratio, pack sizes, eager + high) between the stamp and the receipt, Jon’s own (dec 48)', async () => {
    const h = await html(sent());
    const at = h.indexOf('<figure class="ph ph--sent" data-slot="hero">');
    expect(at).toBeGreaterThan(h.indexOf('class="flow-top"'));
    expect(at).toBeLessThan(h.indexOf('class="receipt"'));
    const img = h.slice(at).match(/<img [^>]*>/)![0];
    expect(img).toContain('src="/img/hero-480.webp"');
    expect(img).toContain('sizes="(min-width: 768px) 736px, 100vw"');
    expect(img).toContain('alt=""');
    expect(img).toContain('loading="eager"');
    expect(img).toMatch(/fetchPriority="high"/i);
    expect(h.match(/<img /g)).toHaveLength(1);
    expect(h.match(/<link rel="preload" as="image"[^>]*>/g)).toHaveLength(1);
    expect(h).not.toContain('class="credits"'); // Jon’s menu polish: no photo credits line on any page
  });

  it('the stale page shows no photo and no credits line', async () => {
    const h = await html({ kind: 'stale' } as const);
    expect(h).not.toContain('<img');
    expect(h).not.toContain('class="credits"');
    expect(h).not.toContain('rel="preload"');
  });

  it('the pack chrome: the ‹ Home back link above, and no footer (Jon, 2026-10-05), on the stale page too', async () => {
    for (const m of [sent(), { kind: 'stale' } as const]) {
      const h = await html(m);
      expect(h).toMatch(
        new RegExp(
          `^(?:<link rel="preload"[^>]*>)?<header class="site-h">.*<a class="back" href="${ROUTES.home}">.*${SENT_UI.backHome}</a>`,
        ),
      );
      expect(h).not.toMatch(/<footer/);
    }
  });
});
