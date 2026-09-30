// T2.1.02: requireAdmin() with a stubbed Auth client.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN, SITE } from '../../../../tests/fixtures/unit-env';
import { currentAuthEmail } from '../supabase';
import { isAdminEmail, requireAdmin } from '../auth';

vi.mock('../supabase', () => ({ currentAuthEmail: vi.fn() }));
const signedInAs = vi.mocked(currentAuthEmail);

const req = (method: string, origin?: string) =>
  new NextRequest(`${SITE}/api/admin/x`, { method, headers: origin ? { origin } : {} });

beforeEach(() => signedInAs.mockReset());

describe('requireAdmin', () => {
  it('401 with no session', async () => {
    signedInAs.mockResolvedValue(null);
    const res = await requireAdmin(req('GET'));
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(401);
  });

  it('401 for a signed-in email that is not on the allowlist', async () => {
    signedInAs.mockResolvedValue('someone@example.com');
    expect(((await requireAdmin(req('POST', SITE))) as NextResponse).status).toBe(401);
  });

  it('403 for a foreign Origin on a write, before asking the Auth server', async () => {
    signedInAs.mockResolvedValue(ADMIN);
    for (const origin of ['https://evil.example', undefined]) {
      expect(((await requireAdmin(req('POST', origin))) as NextResponse).status).toBe(403);
    }
    expect(signedInAs).not.toHaveBeenCalled();
  });

  it('lets the admin through: a same-origin write, a GET, and a page (no request)', async () => {
    signedInAs.mockResolvedValue(ADMIN);
    expect(await requireAdmin(req('PATCH', SITE))).toEqual({ email: ADMIN });
    expect(await requireAdmin(req('GET', 'https://evil.example'))).toEqual({ email: ADMIN });
    expect(await requireAdmin()).toEqual({ email: ADMIN });
  });

  it('matches the allowlist case- and space-insensitively', () => {
    expect(isAdminEmail('  JON@Example.com ')).toBe(true);
    expect(isAdminEmail('jon@example.com.evil')).toBe(false);
  });
});
