// src/lib/adapters/tus.ts — T3.10: a minimal TUS 1.0 client for Supabase Storage's resumable endpoint
// (/storage/v1/upload/resumable). The file is read from disk one 6 MB chunk at a time (Supabase requires 6 MB
// chunks), so a 400 MB export never sits in memory. A failed chunk is retried after asking the server (HEAD)
// where it got to; that's the point of a resumable upload.
import 'server-only';
import { open } from 'node:fs/promises';
import { StorageError } from './supabase-storage';

export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
const CHUNK_TRIES = 3;
/** pr50 F5: one stalled request must not eat the 300 s budget; an aborted PATCH is retried from the HEAD offset. */
export const TUS_REQUEST_TIMEOUT_MS = 60_000;

export interface TusUpload {
  endpoint: string;
  apiKey: string;
  bucket: string;
  objectName: string;
  contentType: string;
  file: string;
  bytes: number;
  fetchImpl?: typeof fetch;
  /** Per request (tests shorten it). */
  timeoutMs?: number;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

export async function tusUpload(u: TusUpload): Promise<void> {
  const f = u.fetchImpl ?? fetch;
  const signal = () => AbortSignal.timeout(u.timeoutMs ?? TUS_REQUEST_TIMEOUT_MS);
  const auth = { authorization: `Bearer ${u.apiKey}`, apikey: u.apiKey, 'tus-resumable': '1.0.0' };
  const created = await f(u.endpoint, {
    method: 'POST',
    signal: signal(),
    headers: {
      ...auth,
      'upload-length': String(u.bytes),
      'x-upsert': 'false',
      'upload-metadata': [
        `bucketName ${b64(u.bucket)}`,
        `objectName ${b64(u.objectName)}`,
        `contentType ${b64(u.contentType)}`,
        `cacheControl ${b64('3600')}`,
      ].join(','),
    },
  });
  const location = created.headers.get('location');
  if (created.status !== 201 || !location) throw new StorageError('tus_create', created.status);
  const url = new URL(location, u.endpoint).toString();

  const fh = await open(u.file, 'r');
  try {
    const chunk = Buffer.alloc(Math.min(TUS_CHUNK_BYTES, Math.max(u.bytes, 1)));
    let offset = 0;
    let failures = 0;
    while (offset < u.bytes) {
      const { bytesRead } = await fh.read(chunk, 0, Math.min(chunk.length, u.bytes - offset), offset);
      const res = await f(url, {
        method: 'PATCH',
        signal: signal(),
        headers: {
          ...auth,
          'upload-offset': String(offset),
          'content-type': 'application/offset+octet-stream',
        },
        body: new Uint8Array(chunk.buffer, chunk.byteOffset, bytesRead),
      }).catch(() => null);
      if (res?.status === 204 && Number(res.headers.get('upload-offset')) === offset + bytesRead) {
        offset += bytesRead;
        failures = 0;
        continue;
      }
      if (++failures >= CHUNK_TRIES) throw new StorageError('tus_patch', res?.status);
      const head = await f(url, { method: 'HEAD', headers: auth, signal: signal() }).catch(() => null);
      const at = Number(head?.headers.get('upload-offset'));
      if (!head || head.status !== 200 || !Number.isInteger(at) || at < 0 || at > u.bytes) {
        throw new StorageError('tus_head', head?.status);
      }
      offset = at;
    }
  } finally {
    await fh.close();
  }
}
