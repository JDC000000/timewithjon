// tests/e2e/a11y/axe.ts — T1.11.U2 (TSD T1.11 AC2 "axe is clean"): the axe run every a11y case uses, and the rows
// each case seeds for itself (its own test invite, guest and request; nothing shared with other specs, decision 7).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { signCookie } from '../../../src/features/invites/tokens';
import { expect } from '../support/fixtures';

/** WCAG 2.2 AA = every A and AA rule axe maps to WCAG 2.0, 2.1 and 2.2. */
export const WCAG22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/** Runs axe on the page as it stands and fails with one line per violation: rule, impact, first nodes, help URL. */
export async function expectAxeClean(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags([...WCAG22_AA]).analyze();
  const lines = violations.map((v) => {
    const nodes = v.nodes.map((n) => n.target.join(' ')).slice(0, 5);
    return `${v.id} (${v.impact ?? 'n/a'}, ${v.nodes.length} node(s)): ${nodes.join(' | ')} — ${v.helpUrl}`;
  });
  expect(lines, `axe WCAG 2.2 AA violations on ${page.url()}`).toEqual([]);
}

async function db<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** A personal test invite of this test's own (its secret in the invite-link alphabet). */
export function ownInvite(): Promise<string> {
  const secret = Array.from(randomBytes(8), (b) => 'abcdefghjkmnpqrstvwxyz23456789'[b % 30]).join('');
  return db(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `insert into invite (kind, token_secret, name_slug, display_name, is_test)
           values ('personal', $1, $2, 'A11y axe', true) returning id`,
          [secret, `e2e-axe-${secret}`],
        )
      ).rows[0]!.id,
  );
}

/** A requested (not locked) slots request on its own invite and guest; returns the request and invite ids. */
export async function ownRequest(): Promise<{ requestId: string; inviteId: string }> {
  const inviteId = await ownInvite();
  const requestId = await db(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `with g as (insert into guest (email) values ($1) returning id)
           insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, counts_toward,
                                status)
           select $2, g.id, $3, 'Sam Rivera', $1, 'the-flat-white', 'slots', 'weekly_cap', 'requested'
             from g returning id`,
          [`axe-${randomUUID()}@example.com`, randomUUID(), inviteId],
        )
      ).rows[0]!.id,
  );
  return { requestId, inviteId };
}

/** A manage token for the request, stored the way the app stores it (sha-256 of the raw token); returns the raw one. */
export async function manageToken(requestId: string, expired = false): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db((c) =>
    c.query(
      `insert into action_token (token_hash, purpose, request_id, expires_at)
       values ($1, 'manage', $2, now() + $3::interval)`,
      [createHash('sha256').update(token, 'utf8').digest(), requestId, expired ? '-1 day' : '30 days'],
    ),
  );
  return token;
}

/** Sets a signed cookie the way the app issues it: twj_invite (kind 'invite') or twj_req (kind 'req'). */
export async function signedCookie(
  page: Page,
  baseURL: string | undefined,
  kind: 'invite' | 'req',
  id: string,
): Promise<void> {
  const name = kind === 'invite' ? 'twj_invite' : 'twj_req'; // src/features/invites/session.ts, capability.ts
  const value = signCookie(kind, id, 3600, process.env.SESSION_SIGNING_SECRET!);
  await page.context().addCookies([{ name, value, url: baseURL! }]);
}
