// ops/check-photo-bucket.ts — T3.6.08 (T3.6 AC3, AC5 + the MIME list): proves the REAL `photos` bucket's own
// guards on staging or production. Operator/agent only; the app never runs it. Uploads only under
// incoming/check-*, and removes everything it wrote.
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… (from your secret store) \
//     pnpm -s tsx ops/check-photo-bucket.ts
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from('photos');
const MB = 1024 * 1024;
const written: string[] = [];

async function signedUpload(label: string, bytes: number, contentType: string) {
  const path = `incoming/check-${randomUUID()}-${label}`;
  const signed = await bucket.createSignedUploadUrl(path);
  if (signed.error) throw new Error(`sign failed: ${signed.error.name}`);
  written.push(path);
  const { error } = await bucket.uploadToSignedUrl(path, signed.data.token, Buffer.alloc(bytes, 0xff), {
    contentType,
  });
  return error ? `refused (${(error as { statusCode?: string }).statusCode ?? error.name})` : 'stored';
}

async function unsignedUpload(): Promise<string> {
  const path = `incoming/check-${randomUUID()}-unsigned`;
  written.push(path);
  const res = await fetch(`${url}/storage/v1/object/upload/sign/photos/${path}?token=not-a-token`, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: new Uint8Array(1024).fill(0xff),
  });
  return res.ok ? 'stored' : `refused (${res.status})`;
}

const checks: [string, () => Promise<string>, 'stored' | 'refused'][] = [
  ['15 MB JPEG via a signed URL (AC5)', () => signedUpload('15mb', 15 * MB, 'image/jpeg'), 'stored'],
  ['25 MB JPEG via a signed URL (AC5)', () => signedUpload('25mb', 25 * MB, 'image/jpeg'), 'refused'],
  ['HEIC MIME type', () => signedUpload('heic', 1024, 'image/heic'), 'stored'],
  ['text/plain (not an image MIME)', () => signedUpload('txt', 1024, 'text/plain'), 'refused'],
  ['a forged upload token (AC3)', unsignedUpload, 'refused'],
];

let failed = 0;
try {
  for (const [name, run, want] of checks) {
    const got = await run();
    const ok = got.startsWith(want);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${got} (want ${want})`);
  }
} finally {
  const { error } = await bucket.remove(written);
  console.log(error ? `cleanup FAILED (${error.name}): remove incoming/check-* by hand` : 'cleanup ok');
}
process.exitCode = failed ? 1 : 0;
