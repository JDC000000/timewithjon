// T3.6.U1: the S11 picker on the real upload path — sign, the resized photo PUT to the signed URL, finalise; PUT
// failures retried (3 tries, then the existing failed tile); the prototype's { mock: true } path unchanged.
// Tile copy and states: Jon decision 49 (unchanged). Selectors: role + accessible name only.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AFTER_SEND } from '@/content';
import { PHOTO_PICKER } from '@/content/ui/guest-after';
import { PhotoPicker, usePhotos } from '../photo-picker';
import { photoUploader, type PhotoTarget } from '../uploader';

const RESIZED = new Blob(['small'], { type: 'image/jpeg' });
const resize = vi.hoisted(() => vi.fn());
vi.mock('../photo-resize', () => ({ resizeForUpload: resize }));

const SIGNED = 'https://store.example/upload/sign/incoming/u1?token=t';
const calls: Array<{ url: string; init: RequestInit }> = [];
let signReply: unknown;
let putFailures: number;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls.length = 0;
  signReply = { ok: true, uploadId: '11111111-1111-4111-8111-111111111111', signedUrl: SIGNED, token: 't' };
  putFailures = 0;
  resize.mockReset().mockResolvedValue(RESIZED);
  const live = document.createElement('p');
  live.id = 'live';
  document.body.append(live);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith('/api/photos/sign')) return json(signReply);
    if (url === SIGNED) {
      if (calls.filter((c) => c.url === SIGNED).length <= putFailures) return json({ error: 'boom' }, 503);
      return json({ Key: 'incoming/u1' });
    }
    if (url.startsWith('/api/photos/finalise')) return json({ ok: true, photoId: 'p1' });
    return json({}, 404);
  });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  document.getElementById('live')?.remove();
  vi.unstubAllGlobals();
});

const TARGET: PhotoTarget = { query: '?for=story_page', headers: { 'x-twj-manage': 'tok' } };
const uploader = photoUploader(TARGET);
function Harness() {
  return <PhotoPicker photos={usePhotos(2, uploader)} />;
}

async function pick() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.upload(
    screen.getByLabelText(AFTER_SEND.photoButton),
    new File(['big'], 'a.jpg', { type: 'image/jpeg' }),
  );
  return screen.getByRole('group', { name: PHOTO_PICKER.photoName(1) });
}
const urls = () => calls.map((c) => c.url);
const puts = () => calls.filter((c) => c.url === SIGNED);

describe('PhotoPicker real upload (T3.6.U1)', () => {
  it('AC1+AC3: sign, then the RESIZED photo is PUT to the signed URL, then finalise with the upload id', async () => {
    const tile = await pick();
    await waitFor(() => expect(tile.textContent).toContain(PHOTO_PICKER.added));
    expect(urls()).toEqual([
      '/api/photos/sign?for=story_page',
      SIGNED,
      '/api/photos/finalise?for=story_page',
    ]);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(puts()[0]!.init.method).toBe('PUT');
    expect(puts()[0]!.init.body).toBe(RESIZED);
    const fin = calls[2]!.init;
    expect(JSON.parse(String(fin.body))).toEqual({ photoUploadId: '11111111-1111-4111-8111-111111111111' });
    expect((fin.headers as Record<string, string>)['x-twj-manage']).toBe('tok');
  });

  it('AC2: a PUT that fails twice succeeds on the 3rd try (one sign, 3 PUTs, one finalise) → Added', async () => {
    putFailures = 2;
    const tile = await pick();
    await waitFor(() => expect(tile.textContent).toContain(PHOTO_PICKER.added), { timeout: 5000 });
    expect(puts()).toHaveLength(3);
    expect(urls().filter((u) => u.startsWith('/api/photos/sign'))).toHaveLength(1);
    expect(urls().filter((u) => u.startsWith('/api/photos/finalise'))).toHaveLength(1);
  });

  it('AC2: a PUT that fails 3 times shows the existing failed tile with Try again; no finalise', async () => {
    putFailures = 3;
    const tile = await pick();
    await waitFor(() => expect(tile.textContent).toContain(PHOTO_PICKER.failed), { timeout: 5000 });
    expect(puts()).toHaveLength(3);
    expect(urls().some((u) => u.startsWith('/api/photos/finalise'))).toBe(false);
    expect(screen.getByRole('button', { name: PHOTO_PICKER.tryAgain })).toBeTruthy();
  });

  it('AC3: prototype (sign answers { mock: true }): no resize, no PUT, no finalise; the tile is Added', async () => {
    signReply = { mock: true };
    const tile = await pick();
    await waitFor(() => expect(tile.textContent).toContain(PHOTO_PICKER.added));
    expect(urls()).toEqual(['/api/photos/sign?for=story_page']);
    expect(resize).not.toHaveBeenCalled();
  });

  it('a refused sign is not retried (each sign opens a photo place): failed tile at once', async () => {
    signReply = { code: 'too_many_photos' };
    const tile = await pick();
    await waitFor(() => expect(tile.textContent).toContain(PHOTO_PICKER.failed));
    expect(urls()).toEqual(['/api/photos/sign?for=story_page']);
  });
});
