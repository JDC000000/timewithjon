// pr55-verify N-C: ops/purge-storage.ts itself wires the guards in: a target that isn't the named env's makes
// ZERO database or storage calls; a matching one reaches the sweep, dry run unless --apply.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  pool: vi.fn(),
  r2: vi.fn(),
  store: vi.fn(),
  sweep: vi.fn(async () => ({
    photoRows: 0,
    finalObjects: 0,
    r2Objects: 0,
    orphanFinal: [],
    orphanR2: [],
    applied: false,
  })),
  settingsEnv: 'staging',
}));
vi.mock('../../src/lib/db-config', () => ({
  createPool: (...a: unknown[]) => {
    calls.pool(...a);
    return { query: async () => ({ rows: [{ env: calls.settingsEnv }] }), end: async () => {} };
  },
}));
vi.mock('../../src/lib/adapters/r2', () => ({ createR2Backup: (...a: unknown[]) => calls.r2(...a) }));
vi.mock('../../src/lib/adapters/supabase-storage', () => ({
  createSupabasePhotoStore: (...a: unknown[]) => calls.store(...a),
}));
vi.mock('../../src/features/photos/sweep', () => ({ sweepOrphanPhotos: calls.sweep }));

const STAGING = 'stagingprojectrefabc';
const ENV = {
  DATABASE_URL: `postgresql://postgres.${STAGING}:pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
  DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  SUPABASE_URL: `https://${STAGING}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: 'k',
  R2_ACCOUNT_ID: 'a',
  R2_ACCESS_KEY_ID: 'i',
  R2_SECRET_ACCESS_KEY: 's',
  R2_BACKUP_BUCKET: 'timewithjon-photos-staging',
};
const argv = process.argv;
const saved = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  for (const f of [calls.pool, calls.r2, calls.store, calls.sweep]) f.mockClear();
  calls.settingsEnv = 'staging';
});
afterEach(() => {
  process.argv = argv;
  process.env = { ...saved };
});
async function run(args: string[], env: Record<string, string> = {}) {
  vi.resetModules();
  process.argv = ['node', 'ops/purge-storage.ts', ...args];
  Object.assign(process.env, ENV, env);
  return import('../../ops/purge-storage');
}
const untouched = () => {
  expect(calls.pool).not.toHaveBeenCalled();
  expect(calls.r2).not.toHaveBeenCalled();
  expect(calls.store).not.toHaveBeenCalled();
  expect(calls.sweep).not.toHaveBeenCalled();
};

describe('ops/purge-storage.ts', () => {
  it('another project in SUPABASE_URL: refused with zero calls', async () => {
    await expect(
      run(['--env=staging', '--apply'], { SUPABASE_URL: 'https://protoprojectrefabcde.supabase.co' }),
    ).rejects.toThrow(/different Supabase project/);
    untouched();
  });
  it('another R2 bucket, or production (no registered bucket): refused with zero calls', async () => {
    await expect(
      run(['--env=staging', '--apply'], { R2_BACKUP_BUCKET: 'timewithjon-photos' }),
    ).rejects.toThrow(/not the staging bucket/);
    await expect(run(['--env=production', '--apply'])).rejects.toThrow(/no R2 backup bucket/);
    untouched();
  });
  it('a bad --max-delete: refused with zero calls', async () => {
    await expect(run(['--env=staging', '--apply', '--max-delete=-1'])).rejects.toThrow(/whole number/);
    untouched();
  });
  it("a database whose settings.env isn't the named env: no storage call", async () => {
    calls.settingsEnv = 'production';
    await expect(run(['--env=staging'])).rejects.toThrow(/settings.env is not staging/);
    expect(calls.sweep).not.toHaveBeenCalled();
  });
  it('matching targets reach the sweep: dry run by default, --apply and --max-delete passed through', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(['--env=staging']);
    expect(calls.sweep).toHaveBeenLastCalledWith(
      expect.objectContaining({ apply: false, maxDelete: undefined }),
    );
    await run(['--env=staging', '--apply', '--max-delete=7']);
    expect(calls.sweep).toHaveBeenLastCalledWith(expect.objectContaining({ apply: true, maxDelete: 7 }));
    expect(calls.r2).toHaveBeenLastCalledWith(
      expect.objectContaining({ bucket: 'timewithjon-photos-staging' }),
    );
    log.mockRestore();
  });
});
