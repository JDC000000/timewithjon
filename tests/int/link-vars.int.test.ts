// T2.3.05 + pr40-review: action-token links are minted at SEND time from a link spec in email_log.vars, and are
// DETERMINISTIC per email row: a retry renders a byte-identical body (H1). No raw token lands in ANY database
// column (a generic information_schema scan; dev_outbox, the prototype's rendered-mail viewer, excepted), in the
// console or in a report (M3). Unknown kinds, 'toString' included, fail closed and for good (M2, M4); a later
// move never revives an expired link (M1).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const reports = vi.hoisted(() => [] as unknown[][]);
vi.mock('@/lib/report', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/report')>();
  return {
    ...m,
    report: (...args: unknown[]) => void reports.push(args),
    reportMessage: (...args: unknown[]) => void reports.push(args),
  };
});

import { manageLink } from '@/features/email/link-vars';
import { extendManageTokens, findToken } from '@/features/invites/action-tokens';
import { loadManageModel } from '@/features/invites/manage-model';
import { deliverEmail, MAX_ATTEMPTS, queueEmail } from '@/features/email/send';
import { createRequestTx } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';
import { hashActionToken } from '@/features/invites/tokens';
import { mockMailer } from '@/lib/adapters/mock/mailer';
import { pool, q, withTx } from '@/lib/db';

let requestId = '';
let email = '';
beforeAll(async () => {
  const [invite] = await q<{ id: string }>(
    `select id from invite where kind = 'general' and revoked_at is null`,
  );
  email = `link+${randomUUID().slice(0, 8)}@example.com`;
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Lin Guest',
    email,
    crew: 2,
  });
  ({ requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId: invite!.id,
      isTest: true,
      spam: true, // no intake emails: only the ones this file queues
      mode: 'slots',
      status: 'requested',
      countsToward: 'weekly_cap',
      dishName: 'The Long Lunch',
    }),
  ));
});
const consoleLines: string[] = [];
beforeEach(() => {
  reports.length = 0;
  consoleLines.length = 0;
  vi.restoreAllMocks();
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const)
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void consoleLines.push(JSON.stringify(a)));
});
afterAll(async () => {
  await q(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [requestId]);
  await pool().end();
});

const queueE4 = async (link: unknown) => {
  const queued = await queueEmail(pool(), {
    template: 'E4',
    to: email,
    requestId,
    eventKey: randomUUID(),
    vars: {
      dish: 'The Long Lunch',
      day: 'Thu May 13',
      when: 'Thu May 13 · noon–2 pm',
      manageLink: link as never,
    },
  });
  if (typeof queued !== 'object') throw new Error(`not queued: ${queued}`);
  return queued.queued;
};
const tokensOf = (emailLogId: string) =>
  q<{ token_hash: Buffer; live: boolean }>(
    `select token_hash, expires_at > now() as live from action_token where email_log_id = $1 order by created_at`,
    [emailLogId],
  );
/** Every raw token that left the app in an email text (captured at the mailer, the failed tries included). */
function captureMailer(failFirst: boolean) {
  const texts: string[] = [];
  const real = mockMailer.send.bind(mockMailer);
  let calls = 0;
  vi.spyOn(mockMailer, 'send').mockImplementation(async (m) => {
    texts.push(m.text);
    if (failFirst && calls++ === 0) throw new Error('provider accepted it, then answered 502');
    return real(m);
  });
  const tokens = () => [
    ...new Set(texts.flatMap((t) => [...t.matchAll(/[?&]t=([A-Za-z0-9_-]{43})/g)].map((x) => x[1]!))),
  ];
  return { texts, tokens };
}

/** pr40-review M3: a raw token in any text/json column of any table (dev_outbox excepted by design). */
async function dbHits(raw: string): Promise<string[]> {
  const cols = await q<{ t: string; c: string }>(
    `select table_name as t, column_name as c from information_schema.columns
      where table_schema = 'public' and table_name <> 'dev_outbox'
        and data_type in ('text', 'character varying', 'jsonb', 'json', 'USER-DEFINED', 'ARRAY')`,
  );
  const hits: string[] = [];
  for (const { t, c } of cols) {
    const rows = await q(`select 1 from "${t}" where "${c}"::text like $1 limit 1`, [`%${raw}%`]);
    if (rows.length) hits.push(`${t}.${c}`);
  }
  return hits;
}

describe('link vars minted at send time (T2.3.05, pr40-review)', () => {
  it('H1: a retry after a failed try sends a byte-identical body; its one link opens S17', async () => {
    const mail = captureMailer(true);
    const id = await queueE4(manageLink(requestId));
    expect(await deliverEmail(id, { inline: true })).toBe('failed');
    // The tick's retry re-checks what the E4 says (email/stale.ts): the booking is locked, as an E4 says.
    await q(
      `update request set status = 'locked', locked_starts_at = '2031-05-13T19:00Z', locked_ends_at = '2031-05-13T21:00Z'
        where id = $1`,
      [requestId],
    );
    try {
      expect(await deliverEmail(id, { inline: false, now: new Date(Date.now() + 3600_000) })).toBe('sent');
    } finally {
      await q(
        `update request set status = 'requested', locked_starts_at = null, locked_ends_at = null where id = $1`,
        [requestId],
      );
    }
    expect(mail.texts).toHaveLength(2);
    expect(mail.texts[1]).toBe(mail.texts[0]); // same body under the same idempotency key
    const [raw] = mail.tokens();
    expect(mail.tokens()).toHaveLength(1);
    expect(await tokensOf(id)).toHaveLength(1);
    expect((await tokensOf(id))[0]!.token_hash.equals(hashActionToken(raw!))).toBe(true);
    expect(await loadManageModel(raw)).toMatchObject({ kind: 'manage', requestId });
    const [log] = await q<{ v: unknown }>(`select vars->'manageLink' as v from email_log where id = $1`, [
      id,
    ]);
    expect(log!.v).toEqual({ link: 'manage', requestId });
  });

  it('M3: no raw token in any database column, the console or a report, the failed try included', async () => {
    const mail = captureMailer(true);
    const id = await queueE4(manageLink(requestId));
    await deliverEmail(id, { inline: true });
    await deliverEmail(id, { inline: false, now: new Date(Date.now() + 3600_000) });
    const raws = mail.tokens();
    expect(raws.length).toBeGreaterThan(0);
    expect(reports.length).toBeGreaterThan(0); // the failed try was reported
    const reported = JSON.stringify(reports, (_k, v: unknown) =>
      v instanceof Error ? `${v.name}: ${v.message} ${v.stack ?? ''}` : v,
    );
    for (const raw of raws) {
      expect(await dbHits(raw)).toEqual([]);
      expect(reported).not.toContain(raw);
      expect(consoleLines.join('\n')).not.toContain(raw);
    }
  });

  it.each([
    ['an unknown kind', { link: 'bogus', requestId: 'x' }],
    ['a prototype key', { link: 'toString', requestId: 'x' }],
    ['a manage spec without its request', { link: 'manage' }],
  ])('M2/M4: %s fails closed and for good: one report, nothing minted or sent', async (_n, spec) => {
    const before = (await q(`select 1 from dev_outbox where to_email = $1`, [email])).length;
    const id = await queueE4(spec);
    expect(await deliverEmail(id, { inline: true })).toBe('failed');
    const [row] = await q<{ status: string; last_error: string; attempts: number }>(
      `select status, last_error, attempts from email_log where id = $1`,
      [id],
    );
    expect(row).toEqual({ status: 'failed', last_error: 'UnknownLinkKindError', attempts: MAX_ATTEMPTS });
    expect(await deliverEmail(id, { inline: false, now: new Date(Date.now() + 86400_000) })).toBe('skipped');
    expect(await tokensOf(id)).toEqual([]);
    expect(await q(`select 1 from dev_outbox where to_email = $1`, [email])).toHaveLength(before);
    expect(reports).toHaveLength(1);
  });

  it('M1: a later lock or move never brings an expired manage link back', async () => {
    const mail = captureMailer(false);
    const id = await queueE4(manageLink(requestId));
    await deliverEmail(id, { inline: true });
    const [raw] = mail.tokens();
    await q(`update action_token set expires_at = now() - interval '1 minute' where token_hash = $1`, [
      hashActionToken(raw!),
    ]);
    await withTx((c) => extendManageTokens(c, requestId, new Date('2027-06-30T20:00:00Z')));
    expect((await findToken(raw))!.expires_at.getTime()).toBeLessThan(Date.now());
    expect(await loadManageModel(raw)).toMatchObject({ kind: 'expired' });
  });
});
