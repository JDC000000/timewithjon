// T3.12.U1 S19: the server-rendered HTML. AC2 (no invite or a stale one → the S16 stale page, never the form); a
// valid invite → the S11 story form, whose Send posts to /api/story-page (source 'story_page', AC1) and whose
// photos ask /api/photos/sign?for=story_page. The before-60 field follows the setting (T1.8 AC4).
import '../../../../tests/fixtures/unit-env';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AFTER_SEND, FLOW, SEND_A_STORY } from '@/content';
import { STALE, STORY_FORM } from '@/content/ui/guest-after';

const m = vi.hoisted(() => ({ session: { state: 'none' } as unknown, before60: false }));
vi.mock('@/features/invites/session', () => ({ getInviteSession: async () => m.session }));
vi.mock('@/lib/settings', () => ({ loadSettings: async () => ({ before60_enabled: m.before60 }) }));

const esc = (s: string) => s.replaceAll("'", '&#x27;');

async function html(session: unknown, before60 = false): Promise<string> {
  m.session = session;
  m.before60 = before60;
  const { default: StoryPage } = await import('../page');
  return renderToStaticMarkup(await StoryPage());
}

const VALID = { state: 'valid', invite: { id: 'inv-1', kind: 'personal' } };
const GENERAL = { state: 'valid', invite: { id: 'inv-g', kind: 'general' } };

describe('S19 /story', () => {
  beforeEach(() => vi.resetModules());

  it('AC1: a valid invite shows the story form, its photo picker and Send', async () => {
    const h = await html(VALID);
    expect(h).toContain(esc(SEND_A_STORY.title));
    expect(h).toContain(esc(AFTER_SEND.question));
    expect(h).toContain(AFTER_SEND.photoButton);
    expect(h).toContain(STORY_FORM.send);
    expect(h).toContain(AFTER_SEND.skip);
    expect(h).not.toContain(STALE.pill);
  });

  it.each([{ state: 'none' }, { state: 'stale' }])(
    'AC2: invite $state → the stale page, and no form',
    async (session) => {
      const h = await html(session);
      expect(h).toContain(STALE.pill);
      expect(h).toContain(esc(STALE.title));
      expect(h).not.toContain('<form');
      expect(h).not.toContain(esc(AFTER_SEND.question));
    },
  );

  it('the before-60 field is in the DOM only when the setting is on', async () => {
    expect(await html(VALID)).not.toContain(AFTER_SEND.before60.slice(0, 20));
    expect(await html(VALID, true)).toContain(AFTER_SEND.before60.slice(0, 20));
  });

  it('QA r2 M4: the general link asks for a name (optional, 80 at most); a personal link does not', async () => {
    const g = await html(GENERAL);
    expect(g).toContain('>Your name (optional)<'); // Jon, 2026-10-05: the story page's own label
    expect(g).toContain(`>${STORY_FORM.nameLabel}<`);
    expect(g).not.toContain(`>${FLOW.nameLabel}<`); // the booking form keeps "Your name"
    expect(g).toMatch(/<input[^>]*name="name"[^>]*maxLength="80"|<input[^>]*maxLength="80"[^>]*name="name"/i);
    expect(g).not.toMatch(/<input[^>]*name="name"[^>]*required/);
    expect(await html(VALID)).not.toContain(`>${STORY_FORM.nameLabel}<`);
  });
});
