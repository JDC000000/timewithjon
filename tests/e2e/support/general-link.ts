// The seeded general invite link (supabase/seed.sql, `?for=friends-g3hx8q2v`) is shared state: early-rollout and
// other specs open it by its literal value, so a spec that rotates it must (a) run under early-rollout's Postgres
// session lock, so neither sees the other's half-done state, and (b) put the seeded link back as the active one.
// Same mechanism (and the same lock keys) as privacy.spec's rotation (#125).
import { Client } from 'pg';
import { expect } from './fixtures';

/** The seeded general invite (supabase/seed.sql): other specs use its literal link. */
export const SEEDED_GENERAL = { secret: 'g3hx8q2v', slug: 'friends' } as const;

/**
 * Runs `fn` under early-rollout's Postgres session lock (released with the connection, so a crashed run leaves no
 * stale lock), then restores the seeded general link as the only active one, in one transaction under the
 * rotation's own lock (the partial unique index allows one active general row: revoke first, then un-revoke).
 */
export async function withRotationLock<T>(fn: () => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(`select pg_advisory_lock(hashtext('twj_e2e_early_rollout'))`);
    try {
      return await fn();
    } finally {
      await db.query('begin');
      await db.query(`select pg_advisory_xact_lock(hashtext('twj_general_invite'))`);
      await db.query(
        `update invite set revoked_at = now()
          where kind = 'general' and revoked_at is null and not (token_secret = $1 and name_slug = $2)`,
        [SEEDED_GENERAL.secret, SEEDED_GENERAL.slug],
      );
      const { rowCount } = await db.query(
        `update invite set revoked_at = null where kind = 'general' and token_secret = $1 and name_slug = $2`,
        [SEEDED_GENERAL.secret, SEEDED_GENERAL.slug],
      );
      await db.query('commit');
      expect(rowCount, 'the seeded general link is restored').toBe(1);
    }
  } finally {
    await db.end(); // ends the session: the advisory lock goes with it
  }
}
