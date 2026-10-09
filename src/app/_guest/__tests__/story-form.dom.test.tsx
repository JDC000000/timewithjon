// T1.8.U1 + T1.8.U2 component behaviour (jsdom + user-event): the story form's Send (held when empty, waits for an
// upload, one POST on submit, focus to the thanks line or the error) and the photo picker's tiles (Uploading → Added,
// failed → Try again, Stop/Remove → focus back on the add control). Tile copy: Jon decision 49 (2026-09-28).
// Selectors: role + accessible name only.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AFTER_SEND, ERRORS } from '@/content';
import { PHOTO_PICKER, STORY_FORM } from '@/content/ui/guest-after';
import { StoryForm } from '../story-form';

type Reply = { status: number; json: unknown };
interface Deferred {
  resolve: (r: Reply) => void;
}

const calls: Array<{ url: string; init: RequestInit }> = [];
let signs: Deferred[] = [];
let storyReply: Reply = { status: 200, json: { ok: true } };

function respond(r: Reply): Response {
  return new Response(JSON.stringify(r.json), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  calls.length = 0;
  signs = [];
  storyReply = { status: 200, json: { ok: true } };
  // the page's one live region (FocusRoot renders it in the real layout)
  const live = document.createElement('p');
  live.id = 'live';
  document.body.append(live);
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith('/api/photos/sign'))
      return new Promise<Response>((res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        signs.push({ resolve: (r) => res(respond(r)) });
      });
    return Promise.resolve(respond(storyReply));
  });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  document.getElementById('live')?.remove();
  vi.unstubAllGlobals();
});

const photo = (name = 'a.jpg') => new File(['x'], name, { type: 'image/jpeg' });

function setup(over: Partial<Parameters<typeof StoryForm>[0]> = {}) {
  const user = userEvent.setup();
  const { unmount } = render(
    <StoryForm
      endpoint="/api/stories"
      target={{ headers: { 'x-twj-manage': 'tok' } }}
      maxPhotos={2}
      before60={false}
      skipHref="/"
      {...over}
    />,
  );
  return { user, unmount, send: () => screen.getByRole('button', { name: STORY_FORM.send }) };
}

const story = () => screen.getByRole('textbox', { name: AFTER_SEND.question });
const addControl = () => screen.getByLabelText(AFTER_SEND.photoButton);
const storyPosts = () => calls.filter((c) => c.url === '/api/stories');
/** Answers every sign in turn: the sign gate (uploader.ts) sends the next only after the first is answered. */
async function answerSigns(r: Reply) {
  for (let i = 0; i < signs.length; i++)
    await act(async () => {
      signs[i]!.resolve(r);
      await new Promise((done) => setTimeout(done, 0));
    });
}

describe('StoryForm Send', () => {
  it('an empty Send is held: the line shows, the box is marked invalid and gets focus, nothing is posted', async () => {
    const { user, send } = setup();
    await user.click(send());
    expect(screen.getByText(STORY_FORM.empty).hidden).toBe(false);
    expect(story().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(story());
    expect(calls).toHaveLength(0);
    await user.type(story(), 'x');
    expect(story().getAttribute('aria-invalid')).toBeNull();
  });

  it('sends ONE POST on submit with the trimmed fields and the capability header, then focuses the thanks line', async () => {
    const { user, send } = setup();
    await user.type(story(), '  The canoe, 1998. ');
    await user.click(screen.getByRole('checkbox', { name: AFTER_SEND.consent }));
    await user.click(send());
    const thanks = await screen.findByText(AFTER_SEND.thanks);
    expect(document.activeElement).toBe(thanks);
    expect(storyPosts()).toHaveLength(1);
    const [post] = storyPosts();
    expect(post!.init.method).toBe('POST');
    expect(post!.init.headers).toMatchObject({ 'x-twj-manage': 'tok' });
    expect(JSON.parse(String(post!.init.body))).toEqual({ body: 'The canoe, 1998.', consent: true });
    expect(screen.queryByRole('button', { name: STORY_FORM.send })).toBeNull();
  });

  it('a refused Send shows the server line as an alert with focus, and keeps what was typed', async () => {
    storyReply = { status: 429, json: { ok: false, message: 'Slow down a little.' } };
    const { user, send } = setup();
    await user.type(story(), 'hi');
    await user.click(send());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Slow down a little.');
    expect(document.activeElement).toBe(alert);
    expect(story() as HTMLTextAreaElement).toHaveProperty('value', 'hi');
    expect(screen.getByRole('button', { name: STORY_FORM.send }).getAttribute('aria-disabled')).toBeNull();
  });

  it('a network failure shows the generic error', async () => {
    const { user, send } = setup();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    await user.type(story(), 'hi');
    await user.click(send());
    expect((await screen.findByRole('alert')).textContent).toContain(ERRORS.generic);
  });

  it('the before-60 field exists only when it is on, and its answer is sent', async () => {
    setup();
    expect(screen.queryByRole('textbox', { name: AFTER_SEND.before60 })).toBeNull();
    cleanup();
    const { user, send } = setup({ before60: true });
    await user.type(story(), 'Hi');
    await user.type(screen.getByRole('textbox', { name: AFTER_SEND.before60 }), 'Sail to Desolation');
    await user.click(send());
    await screen.findByText(AFTER_SEND.thanks);
    expect(JSON.parse(String(storyPosts()[0]!.init.body))).toEqual({
      body: 'Hi',
      consent: false,
      before60Answer: 'Sail to Desolation',
    });
  });
});

describe('PhotoPicker (per-photo tiles, copy approved by Jon decision 49)', () => {
  it('a photo shows Uploading, then Added (announced once); Send while uploading waits, then sends by itself', async () => {
    const { user, send } = setup();
    await user.upload(addControl(), photo());
    const tile = screen.getByRole('group', { name: PHOTO_PICKER.photoName(1) });
    expect(tile.textContent).toContain(PHOTO_PICKER.uploading);
    await user.click(send());
    expect(screen.getByRole('button', { name: STORY_FORM.waiting }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(storyPosts()).toHaveLength(0);
    await act(async () => signs[0]!.resolve({ status: 200, json: { mock: true } }));
    expect(document.activeElement).toBe(await screen.findByText(AFTER_SEND.thanks));
    expect(storyPosts()).toHaveLength(1);
    expect(document.getElementById('live')?.textContent).toContain(PHOTO_PICKER.addedSay);
    // pr94 F2: the page's one live region is the only one; the tile's line is not a second status region.
    expect(document.querySelectorAll('[role=status],[aria-live]')).toHaveLength(0);
  });

  it('a failed upload says so with Try again; Try again uploads the same file again', async () => {
    const { user } = setup();
    await user.upload(addControl(), photo());
    await act(async () => signs[0]!.resolve({ status: 500, json: {} }));
    const tile = screen.getByRole('group', { name: PHOTO_PICKER.photoName(1) });
    expect(tile.textContent).toContain(PHOTO_PICKER.failed);
    expect(document.getElementById('live')?.textContent).toContain(PHOTO_PICKER.failed);
    await user.click(screen.getByRole('button', { name: PHOTO_PICKER.tryAgain }));
    expect(tile.textContent).toContain(PHOTO_PICKER.uploading);
    expect(signs).toHaveLength(2);
    await act(async () => signs[1]!.resolve({ status: 200, json: { mock: true } }));
    expect(tile.textContent).toContain(PHOTO_PICKER.added);
  });

  it('an empty Send with only a failed photo is held after the wait', async () => {
    const { user, send } = setup();
    await user.upload(addControl(), photo());
    await user.click(send());
    await act(async () => signs[0]!.resolve({ status: 500, json: {} }));
    expect(screen.getByText(STORY_FORM.empty).hidden).toBe(false);
    expect(storyPosts()).toHaveLength(0);
  });

  it('two photos fill it: the add control goes; Remove brings it back with focus on it', async () => {
    const { user } = setup();
    await user.upload(addControl(), [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]);
    expect(screen.getAllByRole('group', { name: /^photo \d$/ })).toHaveLength(2);
    expect(screen.queryByLabelText(AFTER_SEND.photoButton)).toBeNull();
    expect(screen.getByText(PHOTO_PICKER.full(2, 2)).hidden).toBe(false);
    // T3.12.U1-F3: 2 picked at once, but only 1 sign in flight until it is answered (no orphan S19 story).
    expect(signs).toHaveLength(1);
    await answerSigns({ status: 200, json: { mock: true } });
    expect(signs).toHaveLength(2);
    const first = screen.getByRole('group', { name: PHOTO_PICKER.photoName(1) });
    await user.click(first.querySelector('button')!);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(screen.getAllByRole('group', { name: /^photo \d$/ })).toHaveLength(1);
    expect(document.activeElement).toBe(addControl());
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('Stop aborts an upload in flight and removes its tile', async () => {
    const { user } = setup();
    await user.upload(addControl(), photo());
    await user.click(screen.getByRole('button', { name: PHOTO_PICKER.stop }));
    expect(screen.queryByRole('group', { name: PHOTO_PICKER.photoName(1) })).toBeNull();
    expect(calls[0]!.init.signal?.aborted).toBe(true);
  });

  it('pr94 F3: a photo that fails while Send waits holds the story; a second Send sends it without the photo', async () => {
    const { user, send } = setup();
    await user.type(story(), 'Hi');
    await user.upload(addControl(), photo());
    await user.click(send());
    await act(async () => signs[0]!.resolve({ status: 500, json: {} }));
    expect(storyPosts()).toHaveLength(0);
    expect(screen.getByRole('button', { name: PHOTO_PICKER.tryAgain })).toBeTruthy();
    await user.click(send());
    await screen.findByText(AFTER_SEND.thanks);
    expect(storyPosts()).toHaveLength(1);
  });

  it('pr94 F1: two failed photos can each be removed; the add control comes back with focus', async () => {
    const { user } = setup();
    await user.upload(addControl(), [photo('a.jpg'), photo('b.jpg')]);
    await answerSigns({ status: 500, json: {} });
    expect(signs).toHaveLength(2);
    expect(screen.queryByLabelText(AFTER_SEND.photoButton)).toBeNull();
    expect(screen.getAllByRole('button', { name: PHOTO_PICKER.remove })).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: PHOTO_PICKER.remove })[0]!);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(screen.getAllByRole('group', { name: /^photo \d$/ })).toHaveLength(1);
    expect(document.activeElement).toBe(addControl());
  });

  it('pr90 F7: a failed upload revokes its preview at once; Try again makes a fresh one', async () => {
    const { user } = setup();
    await user.upload(addControl(), photo());
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => signs[0]!.resolve({ status: 500, json: {} }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    await user.click(screen.getByRole('button', { name: PHOTO_PICKER.tryAgain }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('leaving the page aborts an upload in flight', async () => {
    const { user, unmount } = setup();
    await user.upload(addControl(), photo());
    unmount();
    expect(calls[0]!.init.signal?.aborted).toBe(true);
  });

  it('QA4 L10: the "add a line or a photo" line goes once a photo is added', async () => {
    const { user, send } = setup();
    await user.click(send());
    expect(screen.getByText(STORY_FORM.empty).hidden).toBe(false);
    await user.upload(addControl(), photo());
    expect(screen.getByText(STORY_FORM.empty).hidden).toBe(true);
    expect(story().hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('StoryForm name box (QA4 L9)', () => {
  it('drops bidi controls as typed (an override would flip the name in admin); emoji joiners stay', async () => {
    const { user } = setup({ endpoint: '/api/story-page', storyPage: { askName: true } });
    const name = screen.getByRole('textbox', { name: STORY_FORM.nameLabel });
    await user.type(name, 'Sam \u202eRTL\u2066 \u{1F468}\u200D\u{1F469}');
    expect((name as HTMLInputElement).value).toBe('Sam RTL \u{1F468}\u200D\u{1F469}');
  });
});
