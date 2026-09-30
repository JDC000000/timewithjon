// TSD v1.9 §9: "decline" appears in no UI, email, admin copy, enum, column or log line.
// Scans every source file in src/, supabase/ and scripts/ (code, SQL, comments included).
// The only allowlisted files: the Google adapter boundary, and the content test that holds the banned-word list.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const DIRS = ['src', 'supabase', 'scripts'];
const EXTENSIONS = /\.(ts|tsx|mjs|js|sql|sh|json|md|toml)$/;
const ALLOWLIST = new Set(['src/lib/adapters/google/rsvp.ts', 'src/content/__tests__/content.test.ts']);
const PATTERN = new RegExp(['de', 'clin'].join(''), 'i');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(full).isDirectory() ? walk(full) : EXTENSIONS.test(name) ? [full] : [];
  });
}

describe('no "decline" outside the Google adapter (TSD v1.9 §9)', () => {
  it('finds no hits in src/, supabase/ or scripts/', () => {
    const files = DIRS.flatMap((d) => walk(path.join(ROOT, d))).map((f) => path.relative(ROOT, f));
    expect(files.length).toBeGreaterThan(50);
    const hits = files
      .filter((f) => !ALLOWLIST.has(f))
      .flatMap((f) =>
        readFileSync(path.join(ROOT, f), 'utf8')
          .split('\n')
          .flatMap((line, i) => (PATTERN.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});
