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

/** Each named test file with its "(case)" note, if any: "tests/int/manage.int.test.ts (B001)" -> B001. */
function namedTests(entry: Entry): { file: string; tag: string | null }[] {
  const raw = entry.tests ?? entry.test;
  return (Array.isArray(raw) ? raw : [raw])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => {
      const m = /^(.*?)(?: \((.*)\))?$/.exec(t)!;
      return { file: m[1]!, tag: m[2] ?? null };
    });
}

/** The named files that never mention the entry (its id, or its "(case)" note): a test that doesn't say what it guards. */
function unmentioned(
  entry: Entry,
  read: (file: string) => string = (f) => readFileSync(path.join(ROOT, f), 'utf8'),
  exists: (file: string) => boolean = (f) => existsSync(path.join(ROOT, f)),
): string[] {
  return namedTests(entry)
    .filter(({ file }) => exists(file))
    .filter(({ file, tag }) => {
      const text = read(file);
      return !text.includes(entry.id) && !(tag && text.includes(tag));
    })
    .map(({ file }) => file);
}

/**
 * Entries dated before this day predate the rule that each named test file mentions its bug, and are let off it
 * (many name a whole file without saying which case guards them). Every entry from this day on must follow it.
 */
const RULE_FROM = '2026-10-10';
const followsRule = (entry: Entry) => String(entry.date) >= RULE_FROM;

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

  it(`every entry from ${RULE_FROM} on is named in each of its test files (its id, or its "(case)" note)`, () => {
    const silent = entries
      .filter(({ entry }) => followsRule(entry))
      .flatMap(({ entry }) => unmentioned(entry).map((f) => `${entry.id}: ${f}`));
    expect(silent).toEqual([]);
  });

  it('the rule applies by date: from its first day on, not before', () => {
    expect(followsRule({ id: 'a', date: '2026-10-10' } as unknown as Entry)).toBe(true);
    expect(followsRule({ id: 'b', date: '2026-11-02' } as unknown as Entry)).toBe(true);
    expect(followsRule({ id: 'c', date: '2026-10-09' } as unknown as Entry)).toBe(false);
  });

  it('self-test: a file that names the entry, or its case note, passes; one that names neither fails', () => {
    const entry = { id: 'x-bug', tests: ['a.ts', 'b.ts (case 7)'] } as unknown as Entry;
    const files: Record<string, string> = { 'a.ts': '// guards x-bug', 'b.ts': "it('case 7', ...)" };
    const read = (f: string) => files[f] ?? '';
    const named = (e: Entry) => unmentioned(e, read, (f) => f in files);
    expect(named(entry)).toEqual([]);
    files['a.ts'] = '// says nothing';
    expect(named(entry)).toEqual(['a.ts']);
  });
});
