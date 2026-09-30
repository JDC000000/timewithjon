// AGENTS.md rule 4 (pr77-review F1): every signed-in admin page (src/app/admin/(app)/**/page.tsx) calls
// requireAdmin() itself, BEFORE any read: the AdminShell layout renders in parallel with the page, so it can't stop
// the page's own reads. The database throws here, so a read before the guard fails the test. Grows by itself.
import '../fixtures/unit-env';
import { globSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { q } from '@/lib/db';

const auth = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/features/admin/auth', () => ({
  requireAdmin: auth.requireAdmin,
  adminFeatureOff: vi.fn(() => null),
  isAdminEmail: vi.fn(() => false),
}));
vi.mock('@/lib/db', () => {
  const noDb = () => {
    throw new Error('READ BEFORE THE GUARD: no database in this test');
  };
  return { q: vi.fn(noDb), withTx: vi.fn(noDb), pool: vi.fn(noDb) };
});

const ROOT = path.resolve(__dirname, '../..');
const pages = globSync('src/app/admin/(app)/**/page.tsx', { cwd: ROOT }).sort();
const props = {
  params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
  searchParams: Promise.resolve({ check: '1' }),
};

type Entry = (p: typeof props) => Promise<unknown>;
async function entries(file: string): Promise<[string, Entry][]> {
  const mod = (await import(path.join(ROOT, file))) as Record<string, unknown>;
  return (['default', 'generateMetadata'] as const)
    .filter((k) => typeof mod[k] === 'function')
    .map((k) => [k, mod[k] as Entry]);
}
/** What a page threw: Next's redirect / not-found signals carry a digest. */
async function thrown(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'rendered';
  } catch (e) {
    return String((e as { digest?: string }).digest ?? (e as Error).message);
  }
}

beforeEach(() => {
  auth.requireAdmin.mockReset();
  vi.mocked(q).mockClear();
});
/** generateMetadata may skip the guard only if it reads nothing (A2's title comes from the query alone). */
const metadataWithoutReads = (name: string, got: string) =>
  name === 'generateMetadata' && got === 'rendered' && vi.mocked(q).mock.calls.length === 0;

describe('every src/app/admin/(app) page guards itself (AGENTS.md rule 4)', { timeout: 30_000 }, () => {
  it('finds the pages (A2 inbox, A3 request at least)', () => {
    expect(pages).toEqual(
      expect.arrayContaining(['src/app/admin/(app)/page.tsx', 'src/app/admin/(app)/requests/[id]/page.tsx']),
    );
  });

  it.each(pages)('%s: not signed in -> redirect to /admin/sign-in, before any read', async (file) => {
    for (const [name, fn] of await entries(file)) {
      auth.requireAdmin.mockResolvedValue(new Response(null, { status: 401 }));
      const got = await thrown(() => fn(props));
      if (metadataWithoutReads(name, got)) continue;
      expect(got, `${file} ${name}`).toMatch(/^NEXT_REDIRECT;[a-z]+;\/admin\/sign-in;/);
      expect(auth.requireAdmin, `${file} ${name}`).toHaveBeenCalled();
    }
  });

  it.each(pages)('%s: flag off (404) -> not found, before any read', async (file) => {
    for (const [name, fn] of await entries(file)) {
      auth.requireAdmin.mockResolvedValue(new Response(null, { status: 404 }));
      const got = await thrown(() => fn(props));
      if (metadataWithoutReads(name, got)) continue;
      expect(got, `${file} ${name}`).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    }
  });
});
