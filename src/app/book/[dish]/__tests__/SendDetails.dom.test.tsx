// T1.7.U4 the guest Send in a flow, with user-event (real event sequences): a personal invite's details arrive
// filled in, Send checks them, posts ONCE with the picks, shows "Sending…", then /sent; a refusal shows the server's
// line under Send and takes focus. fetch is stubbed; the POST itself is the E2E's job (tests/e2e/send).
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { DISHES, ERRORS, FLOW } from '@/content';
import { DETAILS, FLOW_UI } from '@/content/ui/booking';
import { PitchFlow } from '../PitchFlow';
import { DetailsFields, SendFailed, useSend } from '../SendDetails';
import { dishView, NO_GUEST, type GuestView } from '../_lib/flow-view';
import { SEND_AS } from '../_lib/prefill';

const NONE = { away: null, opensOn: null };
const PITCH_ME = dishView(DISHES.find((d) => d.slug === 'pitch-me')!);
const SAM: GuestView = { name: 'Sam Rivera', email: 'sam@example.com', general: false };

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = '';
});

const box = (name: string) =>
  screen.getByRole('textbox', { name: new RegExp(`^${name}`) }) as HTMLInputElement;
const sendButton = () => screen.getByRole('button', { name: /^(Send|Sending…)$/ });

function stubFetch(answer: () => Promise<Response>) {
  const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(answer);
  vi.stubGlobal('fetch', f);
  return f;
}

function Harness({ guest, go }: { guest: GuestView; go: (href: string) => void }) {
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

describe('the guest Send (T1.7.U4)', () => {
  it('a personal invite: name and email filled in and editable', async () => {
    const user = userEvent.setup();
    render(<PitchFlow dish={PITCH_ME} notices={NONE} guest={SAM} />);
    await user.click(screen.getByRole('button', { name: SEND_AS.change })); // T1.7.U2: behind "Sending as"
    expect(box(FLOW.nameLabel).value).toBe('Sam Rivera');
    expect(box(FLOW.emailLabel).value).toBe('sam@example.com');
    await user.clear(box(FLOW.nameLabel));
    await user.type(box(FLOW.nameLabel), 'Sam R.');
    expect(box(FLOW.nameLabel).value).toBe('Sam R.');
    expect(screen.getByRole('textbox', { name: /^Your email/ })).toHaveProperty('type', 'email');
  });

  it('a blank name and a bad email are in the summary; nothing is posted', async () => {
    const f = stubFetch(async () => new Response('{}'));
    const user = userEvent.setup();
    render(<PitchFlow dish={PITCH_ME} notices={NONE} guest={NO_GUEST} />);
    await user.type(box(FLOW.pitchIdeaLabel), 'Sailing');
    await user.type(box(FLOW.pitchWhenLabel), 'May');
    await user.type(box(FLOW.emailLabel), 'sam@');
    await user.click(sendButton());
    const links = [...document.querySelectorAll('.errsum a')].map((a) => a.textContent);
    expect(links).toEqual([DETAILS.nameError, ERRORS.badEmail]);
    expect(f).not.toHaveBeenCalled();
  });

  it('valid: ONE POST with the picks and details, "Sending…" meanwhile, then /sent', async () => {
    let release!: (r: Response) => void;
    const f = stubFetch(() => new Promise<Response>((r) => (release = r)));
    const go = vi.fn();
    const user = userEvent.setup();
    render(<Harness guest={SAM} go={go} />);
    await user.click(sendButton());
    expect(sendButton().textContent).toBe(FLOW_UI.sending);
    await user.click(sendButton()); // a double tap
    await user.keyboard('{Enter}');
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(f.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      dish: 'pitch-me',
      name: 'Sam Rivera',
      email: 'sam@example.com',
      crew: 1,
      pitchIdea: 'Sailing',
      windowText: 'May',
    });
    expect(body.turnstileToken).toBeUndefined();
    release(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/sent'));
  });

  it('a refusal: the server’s line under Send takes focus; the next Send goes again with a fresh key', async () => {
    const f = stubFetch(
      async () =>
        new Response(JSON.stringify({ ok: false, code: 'time_gone', message: ERRORS.timeGone }), {
          status: 409,
        }),
    );
    const go = vi.fn();
    const user = userEvent.setup();
    render(<Harness guest={SAM} go={go} />);
    await user.click(sendButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ERRORS.timeGone);
    expect(document.activeElement).toBe(alert);
    expect(sendButton().textContent).toBe(FLOW.send);
    await user.click(sendButton());
    expect(f).toHaveBeenCalledTimes(2);
    const keys = f.mock.calls.map((c) => (JSON.parse(String(c[1]?.body)) as { clientKey: string }).clientKey);
    expect(keys[0]).not.toBe(keys[1]);
    expect(go).not.toHaveBeenCalled();
  });

  it('no answer at all: the generic line, and the retry replays the same key', async () => {
    const f = stubFetch(async () => Promise.reject(new TypeError('offline')));
    const user = userEvent.setup();
    render(<Harness guest={SAM} go={vi.fn()} />);
    await user.click(sendButton());
    expect((await screen.findByRole('alert')).textContent).toBe(ERRORS.generic);
    await user.click(sendButton());
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    const keys = f.mock.calls.map((c) => (JSON.parse(String(c[1]?.body)) as { clientKey: string }).clientKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('ENG-01: no answer, then the guest fixes the email: the retry is a NEW key (a new request, not a replay)', async () => {
    const f = stubFetch(async () => Promise.reject(new TypeError('offline')));
    const user = userEvent.setup();
    render(<Harness guest={SAM} go={vi.fn()} />);
    await user.click(sendButton());
    expect((await screen.findByRole('alert')).textContent).toBe(ERRORS.generic);
    await user.click(screen.getByRole('button', { name: SEND_AS.change }));
    await user.clear(box(FLOW.emailLabel));
    await user.type(box(FLOW.emailLabel), 'sam.fixed@example.com');
    await user.click(sendButton());
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    const sent = f.mock.calls.map(
      (c) => JSON.parse(String(c[1]?.body)) as { clientKey: string; email: string },
    );
    expect(sent.map((b) => b.email)).toEqual(['sam@example.com', 'sam.fixed@example.com']);
    expect(sent[0]!.clientKey).not.toBe(sent[1]!.clientKey);
  });
});
