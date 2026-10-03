// T1.7.U3 the guest form's Turnstile (AD-9, L11), with user-event: general invite only, `interaction-only` +
// `refresh-expired: auto`, a reserved box from first paint, the token posted, and a reset after ANY refusal.
// window.turnstile is a stub standing in for Cloudflare's script; fetch is stubbed (the POST is the E2E's job).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { ERRORS, FLOW } from '@/content';
import { FLOW_UI } from '@/content/ui/booking';
import { GUEST_TURNSTILE_OPTS } from '@/features/requests/GuestTurnstile';
import { DetailsFields, SendFailed, useSend } from '../SendDetails';
import type { GuestView } from '../_lib/flow-view';

const KEY = '1x00000000000000000000AA'; // Cloudflare's always-pass test site key
const GENERAL: GuestView = { name: 'Sam Rivera', email: 'sam@example.com', general: true, siteKey: KEY };
const PERSONAL: GuestView = { name: 'Sam Rivera', email: 'sam@example.com', general: false, siteKey: KEY };

/** A stand-in for Cloudflare: each render/reset issues the next token through the widget's callback. */
function stubTurnstile() {
  let n = 0;
  let opts: Record<string, unknown> = {};
  const issue = () => (opts.callback as (t: string) => void)(`tok-${++n}`);
  const api = {
    render: vi.fn((_el: HTMLElement, o: Record<string, unknown>) => {
      opts = o;
      issue();
      return 'w1';
    }),
    reset: vi.fn(() => issue()),
    remove: vi.fn(),
  };
  window.turnstile = api;
  return api;
}

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  delete window.turnstile;
  cleanup();
  document.body.innerHTML = '';
});

function stubFetch(answer: () => Promise<Response>) {
  const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(answer);
  vi.stubGlobal('fetch', f);
  return f;
}
const refusal = (status: number, code: string, message: string) => async () =>
  new Response(JSON.stringify({ ok: false, code, message }), { status });
const tokens = (f: ReturnType<typeof stubFetch>) =>
  f.mock.calls.map((c) => (JSON.parse(String(c[1]?.body)) as { turnstileToken?: string }).turnstileToken);
const sendButton = () => screen.getByRole('button', { name: /^(Send|Sending…)$/ });

function Harness({ guest, go = () => {} }: { guest: GuestView; go?: (href: string) => void }) {
  const s = useSend('pitch-me', guest, go);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void s.submit({ pitchIdea: 'Sailing', windowText: 'May' });
      }}
    >
      <DetailsFields s={s} errors={[]} onFixed={() => {}} />
      <button type="submit" aria-disabled={s.sending || undefined}>
        {s.sending ? FLOW_UI.sending : FLOW.send}
      </button>
      <SendFailed s={s} />
    </form>
  );
}

describe('the guest Turnstile (T1.7.U3)', () => {
  it('a general invite: one widget, interaction-only, refresh-expired auto, in the reserved box', async () => {
    const api = stubTurnstile();
    render(<Harness guest={GENERAL} />);
    const slot = screen.getByTestId('turnstile-slot');
    expect(slot.className).toBe('ts-slot');
    await vi.waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    const [el, opts] = api.render.mock.calls[0]!;
    expect(el).toBe(slot);
    expect(opts).toMatchObject({ sitekey: KEY, appearance: 'interaction-only', 'refresh-expired': 'auto' });
    expect(GUEST_TURNSTILE_OPTS).toEqual({ appearance: 'interaction-only', 'refresh-expired': 'auto' });
  });

  it('a personal invite: no box, no widget, no script, no token posted', async () => {
    const api = stubTurnstile();
    const f = stubFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const go = vi.fn();
    const user = userEvent.setup();
    render(<Harness guest={PERSONAL} go={go} />);
    expect(screen.queryByTestId('turnstile-slot')).toBeNull();
    await user.click(sendButton());
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/sent'));
    expect(api.render).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
    expect(tokens(f)).toEqual([undefined]);
  });

  it('a general invite with no site key configured: no box', () => {
    render(<Harness guest={{ ...GENERAL, siteKey: undefined }} />);
    expect(screen.queryByTestId('turnstile-slot')).toBeNull();
  });

  it.each([
    ['a validation refusal', refusal(409, 'time_gone', ERRORS.timeGone), ERRORS.timeGone],
    ['a bot-check refusal', refusal(400, 'bot_check', ERRORS.botCheck), ERRORS.botCheck],
    ['no answer at all', () => Promise.reject(new TypeError('offline')), ERRORS.generic],
  ])('L11: %s resets the widget; the next Send posts a fresh token', async (_, answer, line) => {
    const api = stubTurnstile();
    const f = stubFetch(answer);
    const user = userEvent.setup();
    render(<Harness guest={GENERAL} />);
    await vi.waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    await user.click(sendButton());
    expect((await screen.findByRole('alert')).textContent).toBe(line);
    expect(api.reset).toHaveBeenCalledTimes(1);
    expect(api.reset).toHaveBeenCalledWith('w1');
    await user.click(sendButton());
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(tokens(f)).toEqual(['tok-1', 'tok-2']);
  });

  it('a saved request posts the token and does not reset (the page is leaving)', async () => {
    const api = stubTurnstile();
    const f = stubFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const go = vi.fn();
    const user = userEvent.setup();
    render(<Harness guest={GENERAL} go={go} />);
    await vi.waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    await user.click(sendButton());
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/sent'));
    expect(tokens(f)).toEqual(['tok-1']);
    expect(api.reset).not.toHaveBeenCalled();
  });

  it('the box reserves the widget’s full height from first paint (Send never shifts)', () => {
    const css = readFileSync(join(process.cwd(), 'src/ui/site.css'), 'utf8');
    const rule = /\.ts-slot\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/min-height:\s*var\(--turnstile-h\)/);
    expect(rule).toMatch(/width:\s*var\(--turnstile-w\)/);
  });
});
