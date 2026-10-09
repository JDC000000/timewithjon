// The Storage bucket settings live in ops/bucket-limits.ts (pinned on hosted projects by ops/pin-bucket-limits.ts)
// and in supabase/config.toml (the local stack). This keeps both equal to each other and to the app's own limits,
// and keeps sign-ups off in the local auth config.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUCKET_LIMITS } from '../../ops/bucket-limits';
import { MAX_UPLOAD_BYTES } from '../../src/features/photos/limits';
import { EXPORTS_BUCKET } from '../../src/lib/adapters/supabase-exports';
import { PHOTOS_BUCKET } from '../../src/lib/adapters/supabase-storage';

const ROOT = path.resolve(__dirname, '../..');
const config = readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
const MiB = 1024 * 1024;

/** The `key = value` lines of one [section] of config.toml (no TOML library in the repo; the file is flat). */
function section(name: string): Record<string, string> {
  const start = config.indexOf(`\n[${name}]\n`);
  if (start < 0) throw new Error(`no [${name}] in config.toml`);
  const body = config.slice(start + name.length + 4).split(/\n\[/)[0]!;
  return Object.fromEntries(
    body
      .split('\n')
      .map((l) => /^([a-z_]+)\s*=\s*(.+)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1]!, m[2]!]),
  );
}
const mib = (v: string) => Number(/^"(\d+)MiB"$/.exec(v)?.[1]) * MiB;
const list = (v: string) => JSON.parse(v) as string[];

describe('Storage bucket limits', () => {
  it('names the buckets the app uses', () => {
    expect(Object.keys(BUCKET_LIMITS).sort()).toEqual([EXPORTS_BUCKET, PHOTOS_BUCKET].sort());
  });

  it('photos: the upload cap is the one finalise checks (20 MiB)', () => {
    expect(BUCKET_LIMITS.photos.fileSizeLimit).toBe(MAX_UPLOAD_BYTES);
    expect(MAX_UPLOAD_BYTES).toBe(20 * MiB);
  });

  it('photos: takes what the uploaders send (the picked type, a resized JPEG, or no type at all)', () => {
    const types: readonly string[] = BUCKET_LIMITS.photos.allowedMimeTypes;
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'])
      expect(types).toContain(t);
    for (const f of ['src/app/_guest/uploader.ts', 'src/app/admin/(app)/stories/_a6/api.ts'])
      expect(readFileSync(path.join(ROOT, f), 'utf8')).toContain("|| 'application/octet-stream'");
    expect(types).toContain('application/octet-stream');
    expect(types).not.toContain('image/svg+xml');
    expect(types.some((t) => t.includes('*'))).toBe(false);
  });

  it('exports: 50 MiB of zip, the type the export upload sends', () => {
    expect(BUCKET_LIMITS.exports).toEqual({
      public: false,
      fileSizeLimit: 50 * MiB,
      allowedMimeTypes: ['application/zip'],
    });
    expect(readFileSync(path.join(ROOT, 'src/lib/adapters/supabase-exports.ts'), 'utf8')).toContain(
      "contentType: 'application/zip'",
    );
  });

  it.each(Object.entries(BUCKET_LIMITS))(
    'config.toml declares %s exactly as ops/bucket-limits.ts',
    (name, want) => {
      const local = section(`storage.buckets.${name}`);
      expect(local.public).toBe(String(want.public));
      expect(mib(local.file_size_limit!)).toBe(want.fileSizeLimit);
      expect(list(local.allowed_mime_types!)).toEqual([...want.allowedMimeTypes]);
      expect(mib(section('storage').file_size_limit!)).toBeGreaterThanOrEqual(want.fileSizeLimit); // the global cap
    },
  );
});

describe('local auth config', () => {
  it.each(['auth', 'auth.email', 'auth.sms'])('[%s] has sign-ups off', (name) => {
    expect(section(name).enable_signup).toBe('false');
  });
});
