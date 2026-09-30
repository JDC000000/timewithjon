// tests/unit/ui/admin-pages-static.test.ts (U1, pr73-review F4). The App Router renders a layout and its page in
// parallel, so the AdminShell's check alone doesn't stop a page's own queries: EVERY page under
// src/app/admin/(app)/ calls requireAdmin() itself, before any @/features data call, and stops on a Response.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../src/app/admin/(app)/', import.meta.url).pathname;

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return pages(p);
    return /^page(\.dev)?\.tsx?$/.test(n) ? [p] : [];
  });
}

/** A '@/…' module that reads on the server: `import 'server-only'` (e.g. src/app/admin/_season/data.ts). */
export function serverOnly(spec: string): boolean {
  const base = join(new URL('../../../src/', import.meta.url).pathname, spec.slice(2));
  for (const f of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (/^import\s+'server-only';/m.test(readFileSync(f, 'utf8'))) return true;
    } catch {
      /* not this one */
    }
  }
  return false;
}

/** The problems with one page's source ([] = it guards itself). `isData` = a '@/…' module that reads data. */
export function guardProblems(src: string, isData: (spec: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const guard = src.indexOf('requireAdmin(');
  if (guard < 0) return ['never calls requireAdmin()'];
  // the names it imports from @/features (other than the auth module itself), from an admin _*/data module
  // (pr78-review F3), or from any other '@/…' module that reads on the server
  const names = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(@\/[^']+)'/g)]
    .filter(
      ([, , spec]) =>
        spec !== '@/features/admin/auth' &&
        (/^@\/features\//.test(spec!) || /^@\/app\/admin\/_[^/]+\/data$/.test(spec!) || isData(spec!)),
    )
    .flatMap((m) =>
      m[1]!
        .split(',')
        .map((x) =>
          x
            .replace(/\btype\b/, '')
            .trim()
            .split(/\s+as\s+/)
            .pop()!,
        )
        .filter(Boolean),
    );
  const body = src.slice(src.search(/export default/));
  const guardInBody = body.indexOf('requireAdmin(');
  for (const n of names) {
    const call = body.search(new RegExp(`\\b${n}\\(`));
    if (call >= 0 && (guardInBody < 0 || call < guardInBody)) out.push(`calls ${n}() before requireAdmin()`);
  }
  if (!/instanceof\s+(Next)?Response/.test(src))
    out.push('never checks for the Response requireAdmin() returns');
  return out;
}

describe('the checker', () => {
  it('passes a guarded page', () => {
    const ok = `import { requireAdmin } from '@/features/admin/auth';
import { listRequests } from '@/features/admin/inbox';
export default async function P() {
  const admin = await requireAdmin();
  if (admin instanceof Response) redirect('/admin/sign-in');
  const { cards } = await listRequests('needs_reply');
}`;
    expect(guardProblems(ok)).toEqual([]);
  });
  it('fails a page without the guard, with a query first, or without the Response check', () => {
    expect(guardProblems('export default function P() { return null; }')).toEqual([
      'never calls requireAdmin()',
    ]);
    const early = `import { listRequests } from '@/features/admin/inbox';
export default async function P() {
  const { cards } = await listRequests('needs_reply');
  const admin = await requireAdmin();
  if (admin instanceof Response) redirect('/x');
}`;
    expect(guardProblems(early)).toEqual(['calls listRequests() before requireAdmin()']);
    const noCheck = `export default async function P() { await requireAdmin(); }`;
    expect(guardProblems(noCheck)).toEqual(['never checks for the Response requireAdmin() returns']);
  });
  it('pr78 F3: a read through an admin _*/data module (or any server-only module) before the guard fails', () => {
    const late = (from: string) => `import { requireAdmin } from '@/features/admin/auth';
import { seasonPage } from '${from}';
import { ListLanding } from '@/app/admin/_season/ListLanding';
export default async function P() {
  const page = await seasonPage();
  const admin = await requireAdmin();
  if (admin instanceof Response) redirect('/x');
  return ListLanding({ page });
}`;
    expect(guardProblems(late('@/app/admin/_season/data'))).toEqual([
      'calls seasonPage() before requireAdmin()',
    ]);
    expect(guardProblems(late('@/app/admin/_stories/data'))).toEqual([
      'calls seasonPage() before requireAdmin()',
    ]);
    expect(guardProblems(late('@/app/admin/_x/reads'), (s) => s === '@/app/admin/_x/reads')).toEqual([
      'calls seasonPage() before requireAdmin()',
    ]);
    expect(guardProblems(late('@/app/admin/_x/reads'))).toEqual([]);
    expect(serverOnly('@/app/admin/_season/data')).toBe(true);
    expect(serverOnly('@/app/admin/_season/model')).toBe(false);
  });
});

describe('src/app/admin/(app) pages', () => {
  const found = pages(ROOT);
  it.each(found.length ? found : ['(no pages yet)'])('%s guards itself', (p) => {
    if (p === '(no pages yet)') return;
    expect(guardProblems(readFileSync(p, 'utf8'), serverOnly)).toEqual([]);
  });
});
