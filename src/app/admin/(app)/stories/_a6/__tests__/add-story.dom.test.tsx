// T3.7.U1: A6 "Add emailed story" under user-event (wireframe 09 A6). A send with problems lands on "Things to fix";
// a good one saves (T3.7.02), uploads each photo (sign -> PUT -> finalise, T3.7.03) and moves to the new story with
// how many photos failed; the prototype's { mock: true } sign skips a photo without calling it a failure.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERRORS } from '@/content';
import { installFocusGuard } from '@/ui/focus';
import { mockFetch } from '@/app/admin/_season/__tests__/fetch-mock';
import { AddStory } from '../AddStory';

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const ID = '0b5f0d8e-3c1e-4d7e-9a53-0e8f2b1c4d5a';
const SIGNED = 'https://proj.supabase.co/storage/v1/object/upload/sign/photos/x?token=t';
const photo = (n: string) => new File(['img'], n, { type: 'image/jpeg' });

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  router.push.mockClear();
  // jsdom has no <dialog> methods: the Sheet opens with showModal
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.unstubAllGlobals();
});

async function openSheet() {
  const user = userEvent.setup();
  render(<AddStory />);
  await user.click(screen.getByRole('button', { name: 'Add emailed story' }));
  return { user, sheet: screen.getByRole('dialog') };
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('From (name)'), 'Dana');
  await user.type(screen.getByLabelText('Their email'), 'dana@example.com');
  await user.type(screen.getByLabelText('The story'), 'The van with no reverse gear.');
}

describe('AddStory', () => {
  it('an empty send lists three things to fix, lands on the box, and a line takes Jon to its field', async () => {
    const calls = mockFetch({});
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole('button', { name: 'Add to the book pile' }));
    const box = screen.getByRole('heading', { name: 'Three things to fix' }).parentElement!;
    expect(document.activeElement).toBe(box);
    expect(screen.getByLabelText('From (name)').getAttribute('aria-invalid')).toBe('true');
    await user.click(screen.getByRole('link', { name: ERRORS.badEmail }));
    expect(document.activeElement).toBe(screen.getByLabelText('Their email'));
    await user.type(screen.getByLabelText('Their email'), 'x');
    expect(screen.getByLabelText('Their email').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Two things to fix' })).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('saves with consent, uploads each photo, and opens the new story (added=0)', async () => {
    const calls = mockFetch({
      'POST /api/admin/stories/email-in': { status: 201, json: { ok: true, storyId: ID } },
      [`POST /api/admin/stories/${ID}/photos/sign`]: {
        json: { ok: true, uploadId: 'u1', signedUrl: SIGNED },
      },
      [`PUT ${SIGNED}`]: { json: {} },
      [`POST /api/admin/stories/${ID}/photos/finalise`]: { status: 202, json: { ok: true, queued: true } },
    });
    const { user, sheet } = await openSheet();
    await fill(user);
    const input = sheet.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, [photo('a.jpg'), photo('b.jpg')]);
    expect(within(sheet).getByText('2 photos picked')).toBeTruthy();
    await user.click(within(sheet).getByRole('checkbox', { name: 'They said yes in email' }));
    await user.click(within(sheet).getByRole('button', { name: 'Add to the book pile' }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(`/admin/stories/${ID}?added=0`));
    expect(calls[0]).toEqual({
      method: 'POST',
      url: '/api/admin/stories/email-in',
      body: {
        fromName: 'Dana',
        fromEmail: 'dana@example.com',
        body: 'The van with no reverse gear.',
        consent: true,
      },
    });
    expect(calls.filter((c) => c.method === 'PUT').map((c) => (c.body as File).name)).toEqual([
      'a.jpg',
      'b.jpg',
    ]);
    expect(calls.filter((c) => c.url.endsWith('/finalise')).map((c) => c.body)).toEqual([
      { photoUploadId: 'u1' },
      { photoUploadId: 'u1' },
    ]);
  });

  it('counts the photos that failed; a prototype skip is not a failure', async () => {
    let n = 0;
    mockFetch({
      'POST /api/admin/stories/email-in': { status: 201, json: { ok: true, storyId: ID } },
      [`POST /api/admin/stories/${ID}/photos/sign`]: () =>
        ++n === 1 ? { json: { mock: true } } : { json: { ok: true, uploadId: `u${n}`, signedUrl: SIGNED } },
      [`PUT ${SIGNED}`]: { status: 403, json: {} },
    });
    const { user, sheet } = await openSheet();
    await fill(user);
    await user.upload(sheet.querySelector<HTMLInputElement>('input[type="file"]')!, [
      photo('a.jpg'),
      photo('b.jpg'),
      photo('c.jpg'),
    ]);
    await user.click(within(sheet).getByRole('button', { name: 'Add to the book pile' }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(`/admin/stories/${ID}?added=2`));
  });

  it('six photos is one thing to fix; nothing is sent', async () => {
    const calls = mockFetch({});
    const { user, sheet } = await openSheet();
    await fill(user);
    await user.upload(
      sheet.querySelector<HTMLInputElement>('input[type="file"]')!,
      ['1', '2', '3', '4', '5', '6'].map((x) => photo(`${x}.jpg`)),
    );
    await user.click(within(sheet).getByRole('button', { name: 'Add to the book pile' }));
    expect(screen.getByRole('heading', { name: 'One thing to fix' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Up to 5 photos.' }));
    expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: 'Add photos' }));
    expect(calls).toEqual([]);
  });

  const emailInKeys = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith('/email-in'))
      .map(([, init]) => new Headers(init?.headers).get('idempotency-key'));
  const UUID = /^[0-9a-f-]{36}$/;

  it('pr82 F5: a retry of the same story reuses its Idempotency-Key; the next story gets a new one', async () => {
    let saves = 0;
    mockFetch({
      'POST /api/admin/stories/email-in': () =>
        ++saves === 1
          ? { status: 500, json: { ok: false } }
          : { status: 201, json: { ok: true, storyId: ID } },
    });
    const { user, sheet } = await openSheet();
    await fill(user);
    const send = () => user.click(within(sheet).getByRole('button', { name: 'Add to the book pile' }));
    await send();
    await screen.findByRole('heading', { name: 'One thing to fix' });
    await send();
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Add emailed story' }));
    await fill(user);
    await send();
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledTimes(2));
    const [first, retry, next] = emailInKeys();
    expect(first).toMatch(UUID);
    expect(retry).toBe(first);
    expect(next).toMatch(UUID);
    expect(next).not.toBe(first);
  });

  it('pr83 M1: a new key when the story is edited, after a 409, and after the sheet closes', async () => {
    const replies = [500, 409, 500, 500];
    mockFetch({
      'POST /api/admin/stories/email-in': () => ({ status: replies.shift() ?? 500, json: { ok: false } }),
    });
    const { user, sheet } = await openSheet();
    await fill(user);
    const send = async (n: number) => {
      await user.click(within(sheet).getByRole('button', { name: 'Add to the book pile' }));
      await vi.waitFor(() => expect(emailInKeys()).toHaveLength(n));
      await screen.findByRole('heading', { name: 'One thing to fix' });
    };
    await send(1); // 500: the key is kept
    await user.type(screen.getByLabelText('The story'), ' Twice.');
    await send(2); // edited payload: a new key; 409 drops it
    await send(3); // the same payload after the 409: a new key again; 500 keeps it
    await user.click(within(sheet).getByRole('button', { name: 'Close Add emailed story' }));
    await user.click(screen.getByRole('button', { name: 'Add emailed story' }));
    await send(4); // same fields, but the sheet was closed: a new key
    const keys = emailInKeys();
    keys.forEach((k) => expect(k).toMatch(UUID));
    expect(new Set(keys).size).toBe(4);
  });

  it('a refused save says so in the box and stays open', async () => {
    mockFetch({ 'POST /api/admin/stories/email-in': { status: 400, json: { ok: false, code: 'invalid' } } });
    const { user, sheet } = await openSheet();
    await fill(user);
    await user.click(within(sheet).getByRole('button', { name: 'Add to the book pile' }));
    const box = (await screen.findByRole('heading', { name: 'One thing to fix' })).parentElement!;
    expect(box.textContent).toContain(ERRORS.generic);
    expect(document.activeElement).toBe(box);
    expect(router.push).not.toHaveBeenCalled();
  });
});
