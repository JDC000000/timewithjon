// The regression register (evals/bugs/): one JSON file per fixed bug, named after its id, so parallel fix PRs each
// add their own file instead of editing one shared list. This test keeps the register well formed: every file parses
// to one entry, its id matches its file name, ids are unique (case-insensitively, for case-insensitive file systems),
// and every test file an entry points at exists.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const DIR = path.join(ROOT, 'evals/bugs');
const ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

type Entry = Record<string, unknown> & { id: string };

const files = readdirSync(DIR).sort();
const entries: { file: string; entry: Entry }[] = files
  .filter((f) => f.endsWith('.json'))
  .map((file) => ({ file, entry: JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as Entry }));

/** The test paths an entry names. Older entries use `test` (one path, sometimes with a "(case)" note), newer `tests`. */
function testPaths(entry: Entry): unknown[] {
  const raw = entry.tests ?? entry.test;
  return (Array.isArray(raw) ? raw : [raw]).map((t) =>
    typeof t === 'string' ? t.replace(/ \(.*\)$/, '') : t,
  );
}

describe('evals/bugs: the regression register', () => {
  it('has one .json file per bug and nothing else', () => {
    expect(files.filter((f) => !f.endsWith('.json'))).toEqual([]);
    expect(entries.length).toBeGreaterThanOrEqual(41);
  });

  it('is no longer a single shared list', () => {
    expect(existsSync(path.join(ROOT, 'evals/bugs.json'))).toBe(false);
  });

  it.each(files.filter((f) => f.endsWith('.json')))('%s is one entry named after its id', (file) => {
    const { entry } = entries.find((e) => e.file === file)!;
    expect(entry).toBeTypeOf('object');
    expect(Array.isArray(entry)).toBe(false);
    expect(entry.id).toMatch(ID);
    expect(file).toBe(`${entry.id}.json`);
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.fix).toBeTypeOf('string');
    expect(entry.summary ?? entry.symptom).toBeTypeOf('string');
  });

  it('has unique ids, ignoring case', () => {
    const ids = entries.map((e) => e.entry.id.toLowerCase());
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('points every entry at test files that exist', () => {
    const missing = entries.flatMap(({ entry }) => {
      const paths = testPaths(entry);
      if (paths.length === 0 || paths.some((p) => typeof p !== 'string' || p === ''))
        return [`${entry.id}: no test`];
      return (paths as string[])
        .filter((p) => !existsSync(path.join(ROOT, p)))
        .map((p) => `${entry.id}: ${p}`);
    });
    expect(missing).toEqual([]);
  });
});
