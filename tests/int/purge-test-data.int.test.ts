// T3.16.04 + T3.16.06 (TSD T3.16 AC2, R2-L3): ops/purge-test-data.sql, run through psql exactly as the operator
// does, removes every trace of is_test data and nothing real. It deletes ALL test invites (the seed's included),
// so it runs in a scratch database built from the migrations + supabase/seed.sql, dropped afterwards.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const BASE = process.env.DATABASE_URL!;
const DB = `twj_purge_${randomUUID().slice(0, 8)}`;
const url = (() => {
  const u = new URL(BASE);
  u.pathname = `/${DB}`;
  return u.toString();
})();
let db: Client;
/** 0303 (on main via #44) lets audit detail name a story; this stack's base predates it. */
let auditHasStoryId = false;

/** The scratch database needs CREATEDB (the PG15 job has it; if a job's role lacks it, that job skips). */
const canCreateDb = await (async () => {
  const c = new Client({ connectionString: BASE });
  await c.connect();
  try {
    const { rows } = await c.query<{ ok: boolean }>(
      `select rolcreatedb or rolsuper as ok from pg_roles where rolname = current_user`,
    );
    return rows[0]?.ok === true;
  } finally {
    await c.end();
  }
})();

/** A file through psql, minus the Supabase-only lines (as scripts/test-db.sh does). */
function psqlFile(sql: string, vars: string[] = []) {
  const r = spawnSync('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...vars, '-f', '-'], {
    input: sql
      .split('\n')
      .filter((l) => !l.includes('TWJ:SUPABASE-ONLY'))
      .join('\n'),
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
/** The operator's call; dry_run=0 (commit) unless the test passes its own (the last -v wins in psql). */
const purge = (...vars: string[]) =>
  psqlFile(readFileSync('ops/purge-test-data.sql', 'utf8'), ['-v', 'dry_run=0', ...vars]);
const purgeRaw = (...vars: string[]) => psqlFile(readFileSync('ops/purge-test-data.sql', 'utf8'), vars);
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T;
const count = async (sql: string, params: unknown[] = []) =>
  Number((await one<{ n: string }>(`select count(*) as n from (${sql}) x`, params)).n);

beforeAll(async () => {
  if (!canCreateDb) return;
  const admin = new Client({ connectionString: BASE });
  await admin.connect();
  await admin.query(`create database ${DB}`);
  await admin.end();
  const setup = psqlFile('create schema if not exists extensions;');
  expect(setup.status, setup.stderr).toBe(0);
  for (const f of readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const r = psqlFile(readFileSync(`supabase/migrations/${f}`, 'utf8'));
    expect(r.status, `${f}: ${r.stderr}`).toBe(0);
  }
  const seed = psqlFile(readFileSync('supabase/seed.sql', 'utf8'));
  expect(seed.status, seed.stderr).toBe(0);
  db = new Client({ connectionString: url });
  await db.connect();
  auditHasStoryId =
    (
      await one<{ def: string | null }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'audit_log_detail_check'`,
      )
    )?.def?.includes('story_id') ?? false;
}, 120_000);
afterAll(async () => {
  if (!canCreateDb) return;
  await db?.end();
  const admin = new Client({ connectionString: BASE });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.end();
});

async function invite(isTest: boolean, openCount = 0): Promise<string> {
  const secret = randomUUID()
    .replace(/[^a-hjkmnp-tv-z0-9]/g, '')
    .slice(0, 8)
    .padEnd(8, 'a');
  return (
    await one<{ id: string }>(
      `insert into invite (kind, token_secret, name_slug, display_name, is_test, open_count, first_opened_at)
       values ('personal', $1, $2, 'x', $3, $4, case when $4 > 0 then now() end) returning id`,
      [secret, `p-${randomUUID().slice(0, 8)}`, isTest, openCount],
    )
  ).id;
}
const guest = async () =>
  (
    await one<{ id: string }>(`insert into guest (email) values ($1) returning id`, [
      `${randomUUID()}@example.com`,
    ])
  ).id;
async function request(
  inviteId: string,
  guestId: string,
  o: {
    isTest?: boolean;
    joinedTo?: string;
    eventId?: string;
    pending?: boolean;
    queuedCalendar?: boolean;
  } = {},
): Promise<string> {
  const slot = await one<{ id: string }>(`select id from slot limit 1`);
  const r = await one<{ id: string }>(
    `insert into request (is_test, client_key, guest_id, invite_id, contact_name, contact_email, dish, mode,
                          counts_toward, joined_to_request_id, google_event_id, calendar_state)
     values ($1, gen_random_uuid(), $2, $3, 'Pia', 'pia@example.com', 'the-long-lunch', 'slots', 'weekly_cap', $4, $5,
             $6::calendar_state)
     returning id`,
    [
      o.isTest ?? false,
      guestId,
      inviteId,
      o.joinedTo ?? null,
      o.eventId ?? null,
      o.pending ? 'pending' : 'none',
    ],
  );
  await db.query(`insert into request_slot_choice (request_id, slot_id) values ($1, $2)`, [r.id, slot.id]);
  await db.query(`insert into offer (request_id, kind) values ($1, 'suggested_times')`, [r.id]);
  await db.query(
    `insert into action_token (token_hash, purpose, request_id, expires_at)
     values (decode(md5(random()::text) || md5(random()::text), 'hex'), 'manage', $1, now() + interval '1 day')`,
    [r.id],
  );
  const log = await one<{ id: string }>(
    `insert into email_log (template, to_email, request_id) values ('E1', 'pia@example.com', $1) returning id`,
    [r.id],
  );
  await db.query(`insert into email_queue (email_log_id, priority, not_before) values ($1, 1, now())`, [
    log.id,
  ]);
  await db.query(
    `insert into audit_log (actor, action, request_id) values ('guest', 'request.created', $1)`,
    [r.id],
  );
  // a finished calendar row (a queued one blocks the purge, pr55 F7)
  await db.query(
    `insert into outbox (kind, request_id, done_at) values ('calendar_create', $1, case when $2 then null else now() end)`,
    [r.id, o.queuedCalendar ?? false],
  );
  return r.id;
}
/** A story with a photo, an upload and their media outbox rows. */
async function story(o: { requestId?: string; inviteId?: string; guestId?: string }): Promise<string> {
  const s = await one<{ id: string }>(
    `insert into story (source, request_id, invite_id, guest_id, body)
     values ($1, $2, $3, $4, 'a story') returning id`,
    [o.requestId ? 'after_send' : 'story_page', o.requestId ?? null, o.inviteId ?? null, o.guestId ?? null],
  );
  const p = await one<{ id: string }>(
    `insert into photo (story_id, storage_path, width, height, bytes)
     values ($1, 'final/' || gen_random_uuid() || '.jpg', 1, 1, 1) returning id`,
    [s.id],
  );
  const u = await one<{ id: string }>(
    `insert into photo_upload (story_id, incoming_path) values ($1, 'incoming/' || gen_random_uuid()) returning id`,
    [s.id],
  );
  await db.query(
    `insert into outbox (kind, payload) values ('r2_copy', jsonb_build_object('photoId', $1::text)),
                                               ('attachment_finalise', jsonb_build_object('photoUploadId', $2::text))`,
    [p.id, u.id],
  );
  if (auditHasStoryId)
    await db.query(
      `insert into audit_log (actor, action, detail) values ('jon', 'story.consent', jsonb_build_object('story_id', $1::text))`,
      [s.id],
    );
  return s.id;
}

describe.skipIf(!canCreateDb)('ops/purge-test-data.sql', () => {
  it('refuses without -v env, or with an env that is not this database (nothing deleted)', async () => {
    const before = await count(`select 1 from invite where is_test`);
    expect(before).toBeGreaterThan(0);
    const none = purge();
    expect(none.status).not.toBe(0);
    expect(none.stderr).toMatch(/usage/);
    const wrong = purge('-v', 'env=production');
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toMatch(/settings.env is not production/);
    expect(await count(`select 1 from invite where is_test`)).toBe(before);
  });

  it('fails closed while a test request still has a calendar event; -v events_ok=1 proceeds', async () => {
    const ti = await invite(true);
    const linked = await request(ti, await guest(), { isTest: true, eventId: 'evt123' });
    const blocked = purge('-v', 'env=prototype');
    expect(blocked.status).not.toBe(0);
    expect(blocked.stdout).toContain(linked);
    expect(blocked.stderr).toMatch(/still have calendar events/);
    expect(await count(`select 1 from request where id = $1`, [linked])).toBe(1);
    const confirmed = purge('-v', 'env=prototype', '-v', 'events_ok=1');
    expect(confirmed.status, confirmed.stderr).toBe(0);
    expect(await count(`select 1 from request where id = $1`, [linked])).toBe(0);
  });

  it('pr55 F5/F7: a pending calendar state or a queued calendar change on a TEST request blocks; a real one never does', async () => {
    const ti = await invite(true);
    const ri = await invite(false);
    const real = await request(ri, await guest(), {
      eventId: 'evt-real',
      pending: true,
      queuedCalendar: true,
    });
    for (const o of [{ pending: true }, { queuedCalendar: true }]) {
      const test = await request(ti, await guest(), { isTest: true, ...o });
      const blocked = purge('-v', 'env=prototype');
      expect(blocked.status, JSON.stringify(o)).not.toBe(0);
      expect(blocked.stdout).toContain(test);
      expect(blocked.stdout).not.toContain(real);
      expect(await count(`select 1 from request where id = $1`, [test])).toBe(1);
      await db.query(`update request set calendar_state = 'none' where id = $1`, [test]);
      await db.query(`update outbox set done_at = now() where request_id = $1`, [test]);
    }
    const run = purge('-v', 'env=prototype');
    expect(run.status, run.stderr).toBe(0);
    expect(await count(`select 1 from request where id = $1`, [real])).toBe(1);
  });

  it('pr55 F3: -v dry_run=1 changes nothing; production needs confirm=production, and post_launch_ok once open', async () => {
    const ti = await invite(true);
    const test = await request(ti, await guest(), { isTest: true });
    await db.query(`insert into event_count (day, name, count) values (current_date, 'f3', 1)`);
    const dry = purge('-v', 'env=prototype', '-v', 'dry_run=1');
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain('DRY RUN');
    expect(await count(`select 1 from request where id = $1`, [test])).toBe(1);
    expect(await count(`select 1 from event_count where name = 'f3'`)).toBe(1);

    await db.query(`update settings set env = 'production', personal_open_at = now() + interval '1 day'`);
    try {
      const noConfirm = purge('-v', 'env=production');
      expect(noConfirm.status).not.toBe(0);
      expect(noConfirm.stderr).toMatch(/confirm=production/);
      const preLaunch = purge('-v', 'env=production', '-v', 'confirm=production', '-v', 'dry_run=1');
      expect(preLaunch.status, preLaunch.stderr).toBe(0);

      await db.query(`update settings set personal_open_at = now() - interval '1 day'`);
      const open = purge('-v', 'env=production', '-v', 'confirm=production');
      expect(open.status).not.toBe(0);
      expect(open.stderr).toMatch(/post_launch_ok=1/);
      expect(await count(`select 1 from request where id = $1`, [test])).toBe(1);
      const post = purge('-v', 'env=production', '-v', 'confirm=production', '-v', 'post_launch_ok=1');
      expect(post.status, post.stderr).toBe(0);
      expect(await count(`select 1 from request where id = $1`, [test])).toBe(0);
      expect(await count(`select 1 from event_count where name = 'f3'`)).toBe(1); // real analytics kept
    } finally {
      await db.query(`update settings set env = 'prototype', personal_open_at = '2027-02-25T16:00:00Z'`);
      await db.query(`delete from event_count`);
    }
  });

  it('pr55-verify N-A + pr60-verify N-E: dry_run missing, or anything but exactly 0 or 1, refuses before anything runs', async () => {
    const ti = await invite(true);
    const test = await request(ti, await guest(), { isTest: true });
    for (const v of ['2', 'maybe', '', 'true', ' 1', '1 ', '01', 'TRUE']) {
      const run = purge('-v', 'env=prototype', '-v', `dry_run=${v}`);
      expect(run.status, v).not.toBe(0);
      expect(run.stderr).toMatch(/dry_run must be exactly 0 or 1/);
      expect(run.stdout).not.toMatch(/Real rows|After the purge/);
    }
    // pr60-verify: dry_run is required; a forgotten flag refuses like a bad one
    const unset = purgeRaw('-v', 'env=prototype');
    expect(unset.status).not.toBe(0);
    expect(unset.stderr).toMatch(/pass -v dry_run=1 \(preview\) or -v dry_run=0/);
    expect(await count(`select 1 from request where id = $1`, [test])).toBe(1);
    expect(await count(`select 1 from invite where id = $1`, [ti])).toBe(1);
  });

  it('pr55 F4: if any real row would go, everything rolls back', async () => {
    const ti = await invite(true);
    const test = await request(ti, await guest(), { isTest: true });
    const ri = await invite(false);
    const real = await request(ri, await guest());
    // a stray side effect: deleting the test invite also deletes a real request
    await db.query(`create function twj_stray() returns trigger language plpgsql as $f$
      begin delete from request where id = '${real}'; return old; end $f$`);
    await db.query(
      `create trigger twj_stray after delete on invite for each row execute function twj_stray()`,
    );
    try {
      const run = purge('-v', 'env=prototype');
      expect(run.status).not.toBe(0);
      expect(run.stderr).toMatch(/real rows changed/);
      expect(await count(`select 1 from request where id = any($1::uuid[])`, [[test, real]])).toBe(2);
    } finally {
      await db.query(`drop trigger twj_stray on invite; drop function twj_stray()`);
    }
  });

  it('removes every trace of test data and keeps real data (AC2 verification counts all 0)', async () => {
    const ti = await invite(true);
    const ri = await invite(false, 3);
    const [gt, gs, gr] = [await guest(), await guest(), await guest()];
    const rt = await request(ti, gt, { isTest: true });
    const onTestInvite = await request(ti, gs); // not flagged, but made through a test invite
    const joined = await request(ri, gs, { joinedTo: rt }); // joined to a test request
    const real = await request(ri, gr);
    const realShared = await request(ri, gs);
    const tsAfter = await story({ requestId: rt, guestId: gt });
    const tsPage = await story({ inviteId: ti });
    const rsAfter = await story({ requestId: real, guestId: gr });
    const rsPage = await story({ inviteId: ri });
    const emailIn = await story({});
    await db.query(`insert into email_suppression (email, reason) values
      ('bounced@resend.dev', 'bounced'), ('complained@resend.dev', 'complained'), ('real@example.com', 'bounced')`);
    await db.query(
      `insert into email_log (template, to_email, event_key) values ('E14', 'bounced@resend.dev', 'b'), ('E14', 'jon@example.com', 'j')`,
    );
    await db.query(`insert into event_count (day, name, count) values (current_date, 'invite_opened', 4)`);
    await db.query(
      `insert into rate_limit (scope, key, window_start, count) values ('storySave', 'ip', now(), 1)`,
    );

    const run = purge('-v', 'env=prototype');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/0 \| +0 \| +0 \| +0 \| +0/); // the closing verification row

    const test = [rt, onTestInvite, joined];
    expect(await count(`select 1 from request where id = any($1::uuid[])`, [test])).toBe(0);
    expect(await count(`select 1 from request where id = any($1::uuid[])`, [[real, realShared]])).toBe(2);
    for (const t of ['request_slot_choice', 'offer', 'action_token', 'email_log', 'audit_log', 'outbox'])
      expect(await count(`select 1 from ${t} where request_id = any($1::uuid[])`, [test]), t).toBe(0);
    for (const t of ['request_slot_choice', 'offer', 'action_token', 'email_log', 'audit_log', 'outbox'])
      expect(await count(`select 1 from ${t} where request_id = $1`, [real]), t).toBe(1);
    expect(
      await count(
        `select 1 from email_queue q join email_log l on l.id = q.email_log_id where l.request_id = $1`,
        [real],
      ),
    ).toBe(1);
    expect(await count(`select 1 from story where id = any($1::uuid[])`, [[tsAfter, tsPage]])).toBe(0);
    expect(await count(`select 1 from story where id = any($1::uuid[])`, [[rsAfter, rsPage, emailIn]])).toBe(
      3,
    );
    expect(await count(`select 1 from photo where story_id = any($1::uuid[])`, [[tsAfter, tsPage]])).toBe(0);
    expect(
      await count(`select 1 from photo_upload where story_id = any($1::uuid[])`, [[tsAfter, tsPage]]),
    ).toBe(0);
    expect(
      await count(`select 1 from photo where story_id = any($1::uuid[])`, [[rsAfter, rsPage, emailIn]]),
    ).toBe(3);
    // media rows: only the real stories' photos and uploads are left
    expect(await count(`select 1 from outbox where kind in ('r2_copy', 'attachment_finalise')`)).toBe(6);
    if (auditHasStoryId) expect(await count(`select 1 from audit_log where detail ? 'story_id'`)).toBe(3);
    expect(await count(`select 1 from guest where id = $1`, [gt])).toBe(0);
    expect(await count(`select 1 from guest where id = any($1::uuid[])`, [[gs, gr]])).toBe(2);
    expect(await count(`select 1 from invite where is_test`)).toBe(0);
    expect(await one(`select open_count, first_opened_at from invite where id = $1`, [ri])).toEqual({
      open_count: 0,
      first_opened_at: null,
    });
    expect((await db.query(`select email::text from email_suppression`)).rows).toEqual([
      { email: 'real@example.com' },
    ]);
    expect((await db.query(`select to_email::text from email_log where request_id is null`)).rows).toEqual([
      { to_email: 'jon@example.com' },
    ]);
    expect(await count(`select 1 from event_count`)).toBe(0);
    expect(await count(`select 1 from rate_limit`)).toBe(0);

    const again = purge('-v', 'env=prototype'); // idempotent
    expect(again.status, again.stderr).toBe(0);
  });
});
