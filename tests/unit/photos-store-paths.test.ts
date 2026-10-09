// The private photo store's manifest paths (scripts/photos-store-paths.mjs): a real path in the folder is fetched; a path
// that would leave the folder (encoded dots, a backslash, another origin) is refused before any request.
import { describe, expect, it } from 'vitest';
import { safeRel, storeUrl } from '../../scripts/photos-store-paths.mjs';

const base = new URL('https://store.example/twj/photos/');

describe('safeRel + storeUrl', () => {
  it.each(['hero.jpg', 'menu/the-long-lunch.jpg', 'a/b/c-480.webp'])('%s stays in the folder', (rel) => {
    const url = storeUrl(safeRel(rel, '/'), base);
    expect(url.href).toBe(`https://store.example/twj/photos/${rel}`);
  });

  it.each([
    '../secret',
    'a/../../secret',
    '/etc/passwd',
    'https://other.example/x',
    '%2e%2e/secret',
    'a/%2E%2E/%2e%2e/x',
    'a\\..\\..\\x',
    '',
  ])('%j is refused', (rel) => {
    expect(() => storeUrl(safeRel(rel, '/'), base)).toThrow(/unsafe path|leaves the store/);
  });

  it('storeUrl refuses a resolved URL on another origin or outside the folder', () => {
    expect(() => storeUrl('//other.example/twj/photos/x', base)).toThrow(/leaves the store/);
    expect(() => storeUrl('/twj/other/x', base)).toThrow(/leaves the store/);
  });
});
