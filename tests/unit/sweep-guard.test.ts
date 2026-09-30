// pr55 F1: the storage sweep's guards. Every target must be the named env's; big deletes need an explicit cap.
import { describe, expect, it } from 'vitest';
import {
  checkDeleteCap,
  checkSweepTargets,
  R2_BACKUP_BUCKETS,
  refFromDatabaseUrl,
  refFromSupabaseUrl,
} from '@/features/photos/sweep-guard';

const STAGING = 'stagingprojectrefabc';
const PROTO = 'protoprojectrefabcde';
const ok = {
  env: 'staging' as const,
  databaseUrl: `postgresql://postgres.${STAGING}:pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
  supabaseUrl: `https://${STAGING}.supabase.co`,
  r2Bucket: 'timewithjon-photos-staging',
};

describe('project refs', () => {
  it('reads the ref from SUPABASE_URL and from a pooler or direct DATABASE_URL', () => {
    expect(refFromSupabaseUrl(`https://${STAGING}.supabase.co`)).toBe(STAGING);
    expect(refFromDatabaseUrl(ok.databaseUrl)).toBe(STAGING);
    expect(refFromDatabaseUrl(`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres`)).toBe(
      STAGING,
    );
  });
  it('anything else has no ref', () => {
    expect(refFromSupabaseUrl('https://evil.example.com')).toBeNull();
    expect(refFromSupabaseUrl('not a url')).toBeNull();
    expect(refFromDatabaseUrl('postgres://postgres:test@127.0.0.1:5432/postgres')).toBeNull();
    // pr55-verify N-D: the pooler user form counts only on Supabase's pooler host
    expect(refFromDatabaseUrl(`postgresql://postgres.${STAGING}:pw@127.0.0.1:6543/postgres`)).toBeNull();
    expect(
      refFromDatabaseUrl(`postgresql://postgres.${STAGING}:pw@evil.example.com:6543/postgres`),
    ).toBeNull();
    // pr60-verify N-G: the host must END with the pooler domain
    for (const host of ['evil.pooler.supabase.com.attacker.io', 'pooler.supabase.com.evil'])
      expect(
        refFromDatabaseUrl(`postgresql://postgres.${STAGING}:pw@${host}:6543/postgres`),
        host,
      ).toBeNull();
  });
});

describe('checkSweepTargets', () => {
  it('passes when the database, the Supabase project and the R2 bucket are all staging', () => {
    expect(checkSweepTargets(ok)).toBeNull();
  });
  it('refuses another project in SUPABASE_URL (a staging DB with other storage keys)', () => {
    expect(checkSweepTargets({ ...ok, supabaseUrl: `https://${PROTO}.supabase.co` })).toMatch(/different/);
  });
  it('refuses when a ref cannot be read', () => {
    expect(checkSweepTargets({ ...ok, databaseUrl: 'postgres://x@127.0.0.1/postgres' })).toMatch(
      /project ref/,
    );
  });
  it("refuses any bucket but the env's own", () => {
    expect(checkSweepTargets({ ...ok, r2Bucket: 'timewithjon-photos' })).toMatch(/not the staging bucket/);
  });
  it('refuses production until T3.1 registers its bucket', () => {
    expect(R2_BACKUP_BUCKETS.production).toBeNull();
    expect(checkSweepTargets({ ...ok, env: 'production' })).toMatch(/no R2 backup bucket/);
  });
});

describe('checkDeleteCap', () => {
  it('allows up to 50 and at most 20% without --max-delete', () => {
    expect(checkDeleteCap({ orphans: 10, listed: 100 })).toBeNull();
    expect(checkDeleteCap({ orphans: 0, listed: 0 })).toBeNull();
    expect(checkDeleteCap({ orphans: 51, listed: 1000 })).toMatch(/max-delete=50/);
    expect(checkDeleteCap({ orphans: 21, listed: 100 })).toMatch(/21 of 100/);
  });
  it('an explicit --max-delete replaces both limits', () => {
    expect(checkDeleteCap({ orphans: 30, listed: 30, maxDelete: 30 })).toBeNull();
    expect(checkDeleteCap({ orphans: 31, listed: 31, maxDelete: 30 })).toMatch(/max-delete=30/);
    expect(checkDeleteCap({ orphans: 1, listed: 1, maxDelete: 0 })).toMatch(/max-delete=0/);
  });
});
