// T4.6: date-fns and date-fns-tz stay out of the guest pages' browser code (~9 KB on /book before). The test walks
// the value imports (`import type` is erased) from every guest 'use client' file and fails if any module it reaches
// imports date-fns. Browser code formats dates with src/lib/civil.ts. The admin is out of scope: it is Jon's alone and
// not on the Lighthouse budget.
import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gms;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null; // a package
  const tries = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  return tries.find((f) => /\.tsx?$/.test(f) && existsSync(f)) ?? null;
}

/** Every chain from `entry` to a module that imports date-fns, as "a -> b -> date-fns-tz". */
function dateFnsChains(entry: string): string[] {
  const seen = new Set<string>();
  const chains: string[] = [];
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    const here = [...chain, path.relative(ROOT, file)];
    for (const m of [...src.matchAll(IMPORT), ...src.matchAll(DYNAMIC)]) {
      const spec = m[1]!;
      if (/^date-fns(-tz)?(\/|$)/.test(spec)) chains.push([...here, spec].join(' -> '));
      const next = resolve(file, spec);
      if (next) walk(next, here);
    }
  };
  walk(path.join(ROOT, entry), []);
  return chains;
}

const clientFiles = globSync('src/**/*.{ts,tsx}', { cwd: ROOT })
  .map((f) => f.split(path.sep).join('/'))
  .filter((f) => !f.includes('__tests__') && !/\.test\.tsx?$/.test(f) && !f.startsWith('src/app/admin/'))
  .filter((f) => /^\s*['"]use client['"]/.test(readFileSync(path.join(ROOT, f), 'utf8')));

describe('no date-fns in guest browser code (T4.6)', () => {
  it('finds the booking flow among the client files', () => {
    expect(clientFiles).toEqual(
      expect.arrayContaining(['src/app/book/[dish]/BookingFlow.tsx', 'src/app/book/[dish]/DatesFlow.tsx']),
    );
    expect(clientFiles.length).toBeGreaterThan(10);
  });

  it('the walker sees date-fns where it is (the admin season editor)', () => {
    expect(dateFnsChains('src/app/admin/_season/WeekEditor.tsx').length).toBeGreaterThan(0);
  });

  it('no guest client file reaches date-fns', () => {
    expect(clientFiles.flatMap(dateFnsChains)).toEqual([]);
  });
});
