// src/lib/payload-hash.ts — ENG-01/ENG-14: what a client key was first sent with. A guest's retry after a lost
// answer reuses its key; the key must then replay only the SAME submit. A different body under it is a conflict,
// never a silent replay of the first one. SHA-256 of a canonical JSON (keys sorted, undefined dropped). Server only.
import { createHash } from 'node:crypto';

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  }
  return v;
}

export function payloadHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
