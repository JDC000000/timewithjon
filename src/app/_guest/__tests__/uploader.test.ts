// T3.12.U1-F3: the sign gate. On S19 the first sign with no twj_story creates the story, so 2 photos picked in one
// go must not sign at once (the second would create an orphan story). Later signs wait for the first answer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { photoUploader, signGate, UploadRefused } from '../uploader';

interface Pending {
  url: string;
  resolve: (res: Response) => void;
  reject: (e: unknown) => void;
}

/** A fetch whose answers the test hands out one by one. */
function manualFetch() {
  const calls: Pending[] = [];
  const fetchMock = vi.fn(
    (url: string) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({ url, resolve, reject });
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const ok = () => new Response(JSON.stringify({ mock: true }), { status: 200 });
const refused = () => new Response('{}', { status: 403 });
const tick = () => new Promise((r) => setTimeout(r, 0));
const file = () => new File(['x'], 'a.png', { type: 'image/png' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('photoUploader on ?for=story_page (T3.12.U1-F3)', () => {
  it('2 files picked at once: the 2nd sign starts only after the 1st resolves, then later signs run in parallel', async () => {
    const calls = manualFetch();
    const upload = photoUploader({ query: '?for=story_page' });
    const signal = new AbortController().signal;

    const first = upload(file(), signal);
    const second = upload(file(), signal);
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/photos/sign?for=story_page');

    calls[0]!.resolve(ok());
    await first;
    await tick();
    expect(calls).toHaveLength(2);
    calls[1]!.resolve(ok());
    await second;

    // Open now: the next 2 go out together.
    const third = upload(file(), signal);
    const fourth = upload(file(), signal);
    await tick();
    expect(calls).toHaveLength(4);
    calls[2]!.resolve(ok());
    calls[3]!.resolve(ok());
    await Promise.all([third, fourth]);
  });

  it('a refused first sign hands the turn to the next; the gate opens on the first 2xx', async () => {
    const calls = manualFetch();
    const upload = photoUploader({ query: '?for=story_page' });
    const signal = new AbortController().signal;

    const a = upload(file(), signal);
    const b = upload(file(), signal);
    const c = upload(file(), signal);
    await tick();
    expect(calls).toHaveLength(1);

    calls[0]!.resolve(refused());
    await expect(a).rejects.toBeInstanceOf(UploadRefused);
    await tick();
    expect(calls).toHaveLength(2); // b goes, c still waits

    calls[1]!.resolve(ok());
    await b;
    await tick();
    expect(calls).toHaveLength(3);
    calls[2]!.resolve(ok());
    await c;
  });

  it('a failed (network) first sign does not wedge the gate', async () => {
    const calls = manualFetch();
    const upload = photoUploader({});
    const signal = new AbortController().signal;

    const a = upload(file(), signal);
    const b = upload(file(), signal);
    await tick();
    calls[0]!.reject(new TypeError('network'));
    await expect(a).rejects.toThrow('network');
    await tick();
    expect(calls).toHaveLength(2);
    calls[1]!.resolve(ok());
    await b;
  });
});

describe('signGate', () => {
  it('each gate is its own: a second uploader is not held by the first', async () => {
    const g1 = signGate();
    const g2 = signGate();
    let started = 0;
    const never = () => {
      started++;
      return new Promise<Response>(() => {});
    };
    void g1(never);
    void g2(never);
    await tick();
    expect(started).toBe(2);
  });
});
