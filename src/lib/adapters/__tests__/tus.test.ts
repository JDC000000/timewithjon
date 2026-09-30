// T3.10: the TUS client sends the file in 6 MB chunks, resumes from the server's offset after a failed chunk and
// fails closed with a StorageError (no key or path in the message).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TUS_CHUNK_BYTES, tusUpload } from '../tus';
import { StorageError } from '../supabase-storage';

const dir = mkdtempSync(path.join(tmpdir(), 'twj-tus-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function fileOf(bytes: number) {
  const f = path.join(dir, `f-${bytes}`);
  const b = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) b[i] = i % 251;
  writeFileSync(f, b);
  return { f, b };
}

/** A fake TUS server; `failAt` = PATCH calls (1-based) that answer 500 after storing half the chunk. */
function server(
  opts: { failAt?: number[]; shortAt?: number[]; stallAt?: number[]; createStatus?: number } = {},
) {
  const received: Buffer[] = [];
  let stored = Buffer.alloc(0);
  const calls: { method: string; headers: Record<string, string>; signal: boolean }[] = [];
  let patches = 0;
  let mismatches = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ method: init?.method ?? 'GET', headers, signal: init?.signal instanceof AbortSignal });
    if (init?.method === 'POST')
      return new Response(null, {
        status: opts.createStatus ?? 201,
        headers: { location: '/storage/v1/upload/resumable/abc' },
      });
    if (init?.method === 'HEAD')
      return new Response(null, { status: 200, headers: { 'upload-offset': String(stored.length) } });
    patches++;
    if (opts.stallAt?.includes(patches))
      // a stalled connection: nothing comes back until the caller's signal gives up
      return new Promise<Response>((_, reject) =>
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason as Error)),
      );
    const body = Buffer.from(init!.body as Uint8Array);
    if (Number(headers['upload-offset']) !== stored.length) {
      mismatches++; // a real TUS server answers 409 Conflict
      return new Response(null, { status: 409 });
    }
    if (opts.failAt?.includes(patches)) {
      stored = Buffer.concat([stored, body.subarray(0, body.length >> 1)]);
      return new Response(null, { status: 500 });
    }
    if (opts.shortAt?.includes(patches)) {
      stored = Buffer.concat([stored, body.subarray(0, body.length >> 1)]); // took only half, and says so
      return new Response(null, { status: 204, headers: { 'upload-offset': String(stored.length) } });
    }
    received.push(body);
    stored = Buffer.concat([stored, body]);
    return new Response(null, { status: 204, headers: { 'upload-offset': String(stored.length) } });
  }) as typeof fetch;
  return { fetchImpl, calls, received, stored: () => stored, mismatches: () => mismatches };
}
const base = {
  endpoint: 'https://x.supabase.co/storage/v1/upload/resumable',
  apiKey: 'sk',
  bucket: 'exports',
};

describe('tusUpload', () => {
  it('creates the upload with base64 metadata, then sends 6 MB chunks in order', async () => {
    const { f, b } = fileOf(TUS_CHUNK_BYTES * 2 + 1234);
    const s = server();
    await tusUpload({
      ...base,
      objectName: 'zips/j.zip',
      contentType: 'application/zip',
      file: f,
      bytes: b.length,
      fetchImpl: s.fetchImpl,
    });
    const create = s.calls[0]!;
    expect(create.headers['upload-length']).toBe(String(b.length));
    expect(create.headers['x-upsert']).toBe('false');
    expect(create.headers['upload-metadata']).toContain(
      `objectName ${Buffer.from('zips/j.zip').toString('base64')}`,
    );
    expect(create.headers['upload-metadata']).toContain(
      `bucketName ${Buffer.from('exports').toString('base64')}`,
    );
    expect(s.received.map((c) => c.length)).toEqual([TUS_CHUNK_BYTES, TUS_CHUNK_BYTES, 1234]);
    expect(s.mismatches()).toBe(0);
    expect(s.stored().equals(b)).toBe(true);
  });

  it('resumes from the offset the server reports after a failed chunk', async () => {
    const { f, b } = fileOf(TUS_CHUNK_BYTES + 10);
    const s = server({ failAt: [1] });
    await tusUpload({
      ...base,
      objectName: 'o',
      contentType: 'application/zip',
      file: f,
      bytes: b.length,
      fetchImpl: s.fetchImpl,
    });
    expect(s.calls.some((c) => c.method === 'HEAD')).toBe(true);
    expect(s.stored().equals(b)).toBe(true);
  });

  it('a 204 that stored only part of the chunk resumes from the offset the server reports', async () => {
    const { f, b } = fileOf(TUS_CHUNK_BYTES + 10);
    const s = server({ shortAt: [1] });
    await tusUpload({
      ...base,
      objectName: 'o',
      contentType: 'application/zip',
      file: f,
      bytes: b.length,
      fetchImpl: s.fetchImpl,
    });
    expect(s.stored().equals(b)).toBe(true);
    expect(s.mismatches()).toBe(0); // it believed the server's offset, never its own arithmetic
  });

  it('gives up after 3 failed tries of one chunk', async () => {
    const { f, b } = fileOf(100);
    const s = server({ failAt: [1, 2, 3] });
    await expect(
      tusUpload({
        ...base,
        objectName: 'o',
        contentType: 'application/zip',
        file: f,
        bytes: b.length,
        fetchImpl: s.fetchImpl,
      }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it('a refused create is a StorageError that names neither the key nor the path', async () => {
    const { f, b } = fileOf(10);
    const s = server({ createStatus: 403 });
    const err = await tusUpload({
      ...base,
      objectName: 'zips/secret-path.zip',
      contentType: 'x',
      file: f,
      bytes: b.length,
      fetchImpl: s.fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(String((err as Error).message)).not.toMatch(/sk|secret-path/);
  });
});

describe('pr50 F5: every TUS request has a timeout', () => {
  it('a PATCH that never answers is aborted, then the upload resumes from the HEAD offset', async () => {
    const { f, b } = fileOf(TUS_CHUNK_BYTES + 10);
    const srv = server({ stallAt: [1] });
    await tusUpload({
      ...base,
      objectName: 'zips/stall.zip',
      contentType: 'application/zip',
      file: f,
      bytes: b.length,
      fetchImpl: srv.fetchImpl,
      timeoutMs: 50,
    });
    expect(srv.stored().equals(b)).toBe(true);
    expect(srv.calls.map((c) => c.method)).toEqual(['POST', 'PATCH', 'HEAD', 'PATCH', 'PATCH']);
    expect(srv.calls.every((c) => c.signal)).toBe(true);
  });
});
