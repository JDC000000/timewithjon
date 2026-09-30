// src/app/_guest/uploader.ts — how the photo picker sends one file. The prototype stores nothing (§5.5):
// POST /api/photos/sign answers { mock: true } and the tile keeps its local preview (T1.8.U2).
// T3.6.U1 swaps in the real upload (resize, signed PUT, finalise, 3 retries) behind the same Uploader type.

/** Where the photo calls go and which capability rides along (a manage token header on S17, ?for=story_page on S19). */
export interface PhotoTarget {
  query?: string;
  headers?: Record<string, string>;
}

export type Uploader = (file: File, signal: AbortSignal) => Promise<void>;

export class UploadRefused extends Error {
  override name = 'UploadRefused';
}

export type SignGate = (sign: () => Promise<Response>) => Promise<Response>;

/**
 * Runs sign calls one at a time until one answers 2xx, then lets every later call straight through. On S19 a sign
 * with the invite but no twj_story yet creates the story and issues twj_story (caller-story.ts); two first-visit signs
 * in flight at once (2 photos picked in one go) would each create one, leaving an empty orphan story. Waiting for the
 * first answer means the later signs carry its twj_story. A failed or aborted sign hands the turn to the next one.
 * Never deduped on the server by invite: a general invite is shared by many guests. Every uploader calls this.
 */
export function signGate(): SignGate {
  let open = false;
  let tail: Promise<void> = Promise.resolve();
  return async (sign) => {
    if (open) return sign();
    const prev = tail;
    let release!: () => void;
    tail = new Promise<void>((r) => (release = r));
    await prev; // never rejects
    if (open) {
      release(); // the first sign landed while this one waited: no need to hold the ones behind it
      return sign();
    }
    try {
      const res = await sign();
      if (res.ok) open = true;
      return res;
    } finally {
      release();
    }
  };
}

export function mockUploader(target: PhotoTarget): Uploader {
  const gate = signGate();
  return async (_file, signal) => {
    const res = await gate(() =>
      fetch(`/api/photos/sign${target.query ?? ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...target.headers },
        body: '{}',
        signal,
      }),
    );
    const json = (await res.json().catch(() => null)) as { mock?: boolean; ok?: boolean } | null;
    if (!res.ok || !json || !(json.mock || json.ok)) throw new UploadRefused(String(res.status));
  };
}
