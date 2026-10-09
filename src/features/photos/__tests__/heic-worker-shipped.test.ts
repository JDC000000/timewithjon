// src/features/photos/__tests__/heic-worker-shipped.test.ts: the worker loads heic-decode by a path computed at run
// time, which a build trace can't follow. heic-worker.ts keeps a resolve the bundler reads, so every route that uses
// it ships heic-decode and libheif-js. The full check runs on a real build in CI: scripts/check-heic-shipped.mjs
// copies each such route's traced files alone and decodes a HEIC from them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('heic-worker: heic-decode ships with the routes that use it', () => {
  const src = readFileSync('src/features/photos/heic-worker.ts', 'utf8');

  it('keeps a resolve the bundler reads (createRequire(import.meta.url))', () => {
    expect(src).toContain("createRequire(import.meta.url).resolve('heic-decode')");
  });

  it('loads it at run time from the app root, not from the bundler’s module id', () => {
    expect(src).toMatch(
      /return createRequire\(path\.join\(process\.cwd\(\), 'package\.json'\)\)\.resolve\('heic-decode'\)/,
    );
  });
});
