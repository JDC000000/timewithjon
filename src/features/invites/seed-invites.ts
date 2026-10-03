// src/features/invites/seed-invites.ts — the prototype's fixed demo invites (supabase/seed.sql). Their secrets are in
// this public repo, so they must never exist outside APP_MODE=prototype: /api/health fails (seed_invites: present)
// and reports it if one does (features/jobs/health.ts). tests/unit/seed-invites.test.ts keeps this list in step
// with seed.sql.
import type { AppMode } from '@/config/env';

export const SEED_INVITE_SECRETS: readonly string[] = Object.freeze(['g3hx8q2v', 'k7q2m9xp', 'p4r8t2wz']);

/** The secrets health looks up (by the unique token_secret index): none in the prototype, where they belong. */
export const seedSecretsToCheck = (mode: AppMode): string[] =>
  mode === 'prototype' ? [] : [...SEED_INVITE_SECRETS];

/** Reported (class name only) when a seed invite is found outside the prototype. */
export class SeedInvitePresent extends Error {
  override name = 'SeedInvitePresent';
}
