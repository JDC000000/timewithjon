// src/lib/invites/repo.ts — C2 invite lookups. Lookup is by the SECRET only (never the slug).
import 'server-only';
import { q } from '@/lib/db';

export interface Invite {
  id: string;
  kind: 'personal' | 'general';
  is_test: boolean;
  name_slug: string;
  display_name: string | null;
  our_things: string[]; // TSD v1.8: replaces jon_line; '{}' = blank (open-link line)
  picked_dish: string | null;
  prefill_name: string | null;
  prefill_email: string | null;
  revoked_at: Date | null;
}
const COLS =
  'id, kind, is_test, name_slug, display_name, our_things, picked_dish, prefill_name, prefill_email::text as prefill_email, revoked_at';

export async function findInviteBySecret(secret: string): Promise<Invite | null> {
  return (await q<Invite>(`select ${COLS} from invite where token_secret = $1`, [secret]))[0] ?? null;
}
export async function findInviteById(id: string): Promise<Invite | null> {
  return (await q<Invite>(`select ${COLS} from invite where id = $1`, [id]))[0] ?? null;
}
export async function recordOpen(id: string): Promise<void> {
  await q(
    `update invite set open_count = open_count + 1, first_opened_at = coalesce(first_opened_at, now()) where id = $1`,
    [id],
  );
}
