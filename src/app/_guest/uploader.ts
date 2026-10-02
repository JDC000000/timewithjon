// src/app/_guest/uploader.ts — how the photo picker sends one file (T3.6.U1): POST /api/photos/sign, the photo
// resized on the phone (photo-resize.ts), the browser's own PUT to the signed URL, then POST /api/photos/finalise.
// The PUT and the finalise each get UPLOAD_ATTEMPTS tries; sign gets one, because every sign opens one of the
// story's photo places. The prototype stores nothing (§5.5): sign answers { mock: true } and the tile keeps its
// local preview, exactly as before (T1.8.U2).
import { resizeForUpload } from './photo-resize';
import { withRetries } from './photo-state';

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

/** A step that failed in a way worth another try (network, 5xx). Anything else is an UploadRefused: no retry. */
class Flaky extends Error {}

export function photoUploader(target: PhotoTarget): Uploader {
  const post = (route: 'sign' | 'finalise', body: unknown, signal: AbortSignal) =>
    fetch(`/api/photos/${route}${target.query ?? ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...target.headers },
      body: JSON.stringify(body),
      signal,
    });
  const final = (e: unknown) => e instanceof UploadRefused;
  const gate = signGate();

  return async (file, signal) => {
    const res = await gate(() => post('sign', {}, signal));
    const json = (await res.json().catch(() => null)) as {
      mock?: boolean;
      ok?: boolean;
      uploadId?: string;
      signedUrl?: string;
    } | null;
    if (res.ok && json?.mock) return; // prototype: nothing is stored
    if (!res.ok || !json?.ok || !json.uploadId || !json.signedUrl)
      throw new UploadRefused(String(res.status));
    const { uploadId, signedUrl } = json;

    const body = await resizeForUpload(file);
    await withRetries(
      async (attempt) => {
        const put = await fetch(signedUrl, {
          method: 'PUT',
          headers: { 'content-type': body.type || 'application/octet-stream', 'x-upsert': 'false' },
          body,
          signal,
        }).catch((e: unknown) => {
          if (signal.aborted) throw e;
          throw new Flaky('put');
        });
        if (put.ok) return;
        if (put.status >= 500 || put.status === 408 || put.status === 429)
          throw new Flaky(String(put.status));
        // A retry refused as "already there": the earlier try landed but its answer was lost. Finalise checks.
        if (attempt > 1) return;
        throw new UploadRefused(String(put.status));
      },
      { signal, isFinal: final },
    );

    await withRetries(
      async () => {
        const fin = await post('finalise', { photoUploadId: uploadId }, signal).catch((e: unknown) => {
          if (signal.aborted) throw e;
          throw new Flaky('finalise');
        });
        if (fin.ok) return;
        throw fin.status >= 500 ? new Flaky(String(fin.status)) : new UploadRefused(String(fin.status));
      },
      { signal, isFinal: final },
    );
  };
}
