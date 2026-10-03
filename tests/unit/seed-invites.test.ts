// The demo invites' secrets in supabase/seed.sql and the list /api/health looks up outside the prototype stay in step.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SEED_INVITE_SECRETS, seedSecretsToCheck } from '@/features/invites/seed-invites';

const SEED = readFileSync(new URL('../../supabase/seed.sql', import.meta.url), 'utf8');

/** The second value of every row of the seed's `insert into invite (kind, token_secret, …)` statements. */
function seededSecrets(sql: string): string[] {
  const out: string[] = [];
  for (const stmt of sql.split(';')) {
    if (!/insert into invite \(kind, token_secret\b/.test(stmt)) continue;
    for (const m of stmt.matchAll(/\(\s*'(?:general|personal)'\s*,\s*'([^']+)'/g)) out.push(m[1]!);
  }
  return out;
}

describe('seed invites', () => {
  it('the list matches every invite secret seed.sql inserts', () => {
    const seeded = seededSecrets(SEED);
    expect(seeded.length).toBeGreaterThan(0);
    expect([...SEED_INVITE_SECRETS].sort()).toEqual([...seeded].sort());
  });

  it('is looked up in staging and production only', () => {
    expect(seedSecretsToCheck('prototype')).toEqual([]);
    expect(seedSecretsToCheck('staging')).toEqual([...SEED_INVITE_SECRETS]);
    expect(seedSecretsToCheck('production')).toEqual([...SEED_INVITE_SECRETS]);
  });
});
