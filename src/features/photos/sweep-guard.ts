// src/features/photos/sweep-guard.ts — pr55 F1: the operator's storage sweep deletes photos AND their R2 backup,
// so every target must belong to the env the operator named, not just the database. A staging database with
// production storage keys would otherwise see every production photo as an orphan. Pure functions (unit-tested).

export type SweepEnv = 'staging' | 'production';

/**
 * The R2 backup bucket of each env (bucket names aren't secret). Production gets its bucket at T3.1: until the
 * name is written here, a production sweep is refused.
 */
export const R2_BACKUP_BUCKETS: Record<SweepEnv, string | null> = {
  staging: 'timewithjon-photos-staging',
  production: null,
};

/** Without an explicit --max-delete, a sweep may remove at most this many objects per store... */
export const DEFAULT_MAX_DELETE = 50;
/** ...and never more than this share of what it listed (a wrong database makes EVERYTHING look orphaned). */
export const MAX_ORPHAN_SHARE = 0.2;

const REF = /^[a-z0-9]{20}$/;

/** `https://<ref>.supabase.co` → ref. */
export function refFromSupabaseUrl(url: string): string | null {
  try {
    const m = /^([a-z0-9]+)\.supabase\.co$/.exec(new URL(url).hostname);
    return m && REF.test(m[1]!) ? m[1]! : null;
  } catch {
    return null;
  }
}

/** A direct URL (`db.<ref>.supabase.co`) or a pooler URL (user `postgres.<ref>` on `*.pooler.supabase.com`) → ref. */
export function refFromDatabaseUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname)?.[1];
    // pr55-verify N-D: the `postgres.<ref>` user names a project only on Supabase's pooler.
    const user = u.hostname.endsWith('.pooler.supabase.com')
      ? /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(u.username))?.[1]
      : undefined;
    const ref = host ?? user ?? null;
    return ref && REF.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

/** null = the Supabase project and the R2 bucket both belong to `env`'s database; else why not. */
export function checkSweepTargets(t: {
  env: SweepEnv;
  databaseUrl: string;
  supabaseUrl: string;
  r2Bucket: string;
}): string | null {
  const dbRef = refFromDatabaseUrl(t.databaseUrl);
  const storeRef = refFromSupabaseUrl(t.supabaseUrl);
  if (!dbRef || !storeRef)
    return 'refusing: cannot read the Supabase project ref from DATABASE_URL and SUPABASE_URL';
  if (dbRef !== storeRef) return 'refusing: SUPABASE_URL is a different Supabase project than DATABASE_URL';
  const bucket = R2_BACKUP_BUCKETS[t.env];
  if (!bucket) return `refusing: no R2 backup bucket is registered for ${t.env} (sweep-guard.ts)`;
  if (t.r2Bucket !== bucket) return `refusing: R2_BACKUP_BUCKET is not the ${t.env} bucket`;
  return null;
}

/** null = within the cap. `maxDelete` is the operator's explicit --max-delete (then the share rule is waived). */
export function checkDeleteCap(c: { orphans: number; listed: number; maxDelete?: number }): string | null {
  const cap = c.maxDelete ?? DEFAULT_MAX_DELETE;
  if (c.orphans > cap) return `refusing: ${c.orphans} objects to delete is over --max-delete=${cap}`;
  if (c.maxDelete === undefined && c.listed > 0 && c.orphans / c.listed > MAX_ORPHAN_SHARE)
    return `refusing: ${c.orphans} of ${c.listed} objects would go (over ${MAX_ORPHAN_SHARE * 100}%); check the target, then pass --max-delete=${c.orphans}`;
  return null;
}
