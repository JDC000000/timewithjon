// Decision 31 (2026-09-26): Jon approved the whole copy list, so no line in src/ is pending copy approval any more.
// This test fails if the old pending-copy marker comes back anywhere under src/ (code, content, docs): new copy
// goes to Jon for approval before it lands, not in behind a marker.
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const MARKER = /COPY[\s_-]?TBC/i; // pr70-review F2: also "COPY TBC", "COPY_TBC", "COPYTBC"

describe('no pending-copy marker in src/ (decision 31)', () => {
  const files = globSync('src/**/*', { cwd: ROOT, withFileTypes: false }).filter((f) => {
    const abs = path.join(ROOT, f);
    try {
      readFileSync(abs, 'utf8');
      return true;
    } catch {
      return false; // a directory
    }
  });

  it('scans the content and code files', () => {
    const rel = files.map((f) => f.split(path.sep).join('/'));
    expect(rel).toEqual(expect.arrayContaining(['src/content/emails.ts', 'src/content/microcopy.ts']));
    expect(rel.length).toBeGreaterThan(50);
  });

  it('finds the marker nowhere', () => {
    const hits = files.flatMap((f) =>
      readFileSync(path.join(ROOT, f), 'utf8')
        .split('\n')
        .flatMap((line, i) => (MARKER.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
