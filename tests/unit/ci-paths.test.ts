// CI runs the E2E smoke and Lighthouse only when a PR touches what they drive (.github/workflows/ci.yml `e2e`
// filter, lighthouse.yml `paths`). The production build also runs the photo scripts (package.json "build") and
// serves public/, so a change there must trigger both. This test follows the build's own script imports, so a new
// or renamed build script can't slip past the filters.
import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

/** The `- 'glob'` items of the YAML list that follows `key:` (the first one after `from`, if given). */
function listAfter(file: string, key: string, from = ''): string[] {
  const text = read(file);
  const start = text.indexOf(`${key}:\n`, from ? text.indexOf(from) : 0);
  if (start < 0) throw new Error(`no ${key}: in ${file}`);
  const items: string[] = [];
  for (const line of text.slice(start + key.length + 2).split('\n')) {
    const m = /^\s*- '([^']+)'\s*$/.exec(line);
    if (!m) break;
    items.push(m[1]!);
  }
  return items;
}

/** GitHub / picomatch globs as used here: `**` crosses folders, `*` stays inside one, `!` excludes. */
const toRegExp = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')}$`,
  );
const triggers = (globs: string[], file: string) => globs.some((g) => toRegExp(g).test(file));

/** Every scripts/ file `pnpm build` runs: the ones the build script names, and their relative imports. */
function buildScripts(): string[] {
  const build = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts.build!;
  const queue = [...build.matchAll(/scripts\/[\w.-]+/g)].map((m) => m[0]);
  const seen = new Set<string>();
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of read(f).matchAll(/from\s+'(\.\/[^']+)'/g)) {
      const dep = path.posix.join(path.posix.dirname(f), m[1]!);
      queue.push(dep);
      const types = dep.replace(/\.mjs$/, '.d.mts');
      if (existsSync(path.join(ROOT, types))) seen.add(types);
    }
  }
  return [...seen].sort();
}

const E2E = listAfter('.github/workflows/ci.yml', 'e2e', 'id: e2e-filter');
const LIGHTHOUSE_PR = listAfter('.github/workflows/lighthouse.yml', 'paths', 'pull_request:');
const LIGHTHOUSE_MAIN = listAfter('.github/workflows/lighthouse.yml', 'paths', 'push:');
const PUBLIC_FILE = globSync('public/**/*.*', { cwd: ROOT })[0]!.split(path.sep).join('/');

describe('CI path filters cover what the production build reads', () => {
  it('finds the filters and the build scripts', () => {
    expect(E2E).toContain('src/**');
    expect(LIGHTHOUSE_PR).toContain('src/**');
    expect(LIGHTHOUSE_MAIN).toEqual(LIGHTHOUSE_PR);
    expect(buildScripts()).toEqual(
      expect.arrayContaining(['scripts/fetch-real-photos.mjs', 'scripts/build-real-photos.mjs']),
    );
    expect(PUBLIC_FILE).toMatch(/^public\//);
  });

  it.each([
    ['the E2E smoke', E2E],
    ['Lighthouse (PRs)', LIGHTHOUSE_PR],
    ['Lighthouse (main)', LIGHTHOUSE_MAIN],
  ])('%s runs for every build script and every public file', (_name, globs) => {
    const missed = [...buildScripts(), PUBLIC_FILE, 'public/img/new-photo-800.webp'].filter(
      (f) => !triggers(globs, f),
    );
    expect(missed).toEqual([]);
  });

  it('the glob reader matches the way the filters do', () => {
    expect(triggers(['scripts/*photos*'], 'scripts/build-real-photos.d.mts')).toBe(true);
    expect(triggers(['scripts/*photos*'], 'scripts/sub/photos.mjs')).toBe(false);
    expect(triggers(['public/**'], 'public/img/a/b.webp')).toBe(true);
    expect(triggers(['src/**'], 'docs/STACK.md')).toBe(false);
  });
});
