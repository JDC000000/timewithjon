// scripts/photos-store-paths.mjs — where a private manifest's path may point (scripts/fetch-real-photos.mjs): inside the
// store's folder only. Pure, so tests/unit/photos-store-paths.test.ts drives it without a store.
import { normalize, sep as SEP } from 'node:path';

/**
 * A manifest path stays inside the private folder: no absolute paths, no '..', no scheme, and no '%' (an encoded
 * "%2e%2e" would only be decoded by `new URL`, after this check) and no backslash.
 */
export function safeRel(rel, sep = SEP) {
  const raw = String(rel);
  if (raw.includes('%') || raw.includes('\\')) throw new Error(`fetch-real-photos: unsafe path "${rel}"`);
  const n = normalize(raw);
  if (
    !n ||
    n === '.' ||
    n.startsWith('..') ||
    n.startsWith(sep) ||
    /^[a-z]+:/i.test(n) ||
    n.split(sep).includes('..')
  )
    throw new Error(`fetch-real-photos: unsafe path "${rel}"`);
  return n;
}

/** The URL a manifest path is fetched from, asserted to stay on the store's origin and under its folder. */
export function storeUrl(rel, base) {
  const url = new URL(rel, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
    throw new Error(`fetch-real-photos: "${rel}" leaves the store folder`);
  return url;
}
