// T3.9 (TSD T3.9 AC1-AC4) and T3.11 (AC1): the cron tick, the E3 nudge, the 07:00 PT token check, the 18:00 PT
// story digest and the counts, against the test DB. The prototype mailer writes to dev_outbox; nothing is sent.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { mockCalendar } from '@/lib/adapters/mock/calendar';
import { mockMailer } from '@/lib/adapters/mock/mailer';
import { POST as tick } from '@/app/api/cron/tick/route';
import { POST as beacon } from '@/app/api/events/route';
import { sendDueNudges } from '@/features/email/nudge';
import { sendDailyDigest, firstLine } from '@/features/email/daily-digest';
import { checkTokenHealth } from '@/features/jobs/token-health';
import { e14EventKey, GOOGLE_ALERT_KEY, sendE14Once } from '@/features/calendar/alerts';
import { countEvent } from '@/features/analytics/count';
import { saveAfterSendStory } from '@/features/photos/after-send';
import { vancouverDate } from '@/lib/time';

const FAR = Date.now() + 60_000;
const HOUR = 3_600_000;
const sendSpy = vi.spyOn(mockMailer, 'send');
const mine: string[] = [];
let guestId = '';
let inviteId = '';

async function makeRequest(cols: Record<string, unknown>): Promise<string> {
  const base: Record<string, unknown> = {
    is_test: true,
    client_key: randomUUID(),
    guest_id: guestId,
    invite_id: inviteId,
    contact_name: 'Nudge Test',
    contact_email: 'nudge-test@example.com',
    dish: 'the-long-lunch',
    mode: 'slots',
    counts_toward: 'weekly_cap',
    status: 'requested',
    ...cols,
  };
  const keys = Object.keys(base);
  const [row] = await q<{ id: string }>(
    `insert into request (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    keys.map((k) => base[k]),
  );
  mine.push(row!.id);
  return row!.id;
}
const e3For = (id: string) =>
  q<{ event_key: string; status: string }>(
    `select event_key, status::text from email_log where template = 'E3' and request_id = $1 order by created_at`,
    [id],
  );
const counts = async () =>
  Object.fromEntries(
    (
      await q<{ name: string; count: number }>(`select name, count from event_count where day = $1::date`, [
        vancouverDate(new Date()),
      ])
    ).map((r) => [r.name, r.count]),
  );

beforeAll(async () => {
  inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general' limit 1`))[0]!.id;
  guestId = (
    await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [
      `jobs+${randomUUID().slice(0, 8)}@example.com`,
    ])
  )[0]!.id;
});
beforeEach(async () => {
  await q('delete from email_queue');
  await q('delete from email_budget');
  await q(`delete from system_status where key = 'token_health_day'`);
  sendSpy.mockClear();
});
afterAll(async () => {
  await q('delete from email_log where request_id = any($1::uuid[])', [mine]);
  await q('delete from request where id = any($1::uuid[])', [mine]);
  await q('delete from email_budget');
});

describe('AC4: POST /api/cron/tick', () => {
  const call = (secret?: string) =>
    tick(
      new NextRequest('http://localhost:3000/api/cron/tick', {
        method: 'POST',
        headers: secret === undefined ? {} : { 'x-cron-secret': secret },
      }),
    );
  it('a wrong, short, long or missing secret gets 401 and runs nothing', async () => {
    await q(`delete from system_status where key = 'last_tick_at'`);
    for (const s of [undefined, '', 'c'.repeat(31), 'c'.repeat(33), 'd'.repeat(32)]) {
      const res = await call(s);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(await q(`select 1 from system_status where key = 'last_tick_at'`)).toHaveLength(0);
  });
  it('the right secret runs every job, including the T3.9 ones, and records last_tick_at', async () => {
    const res = await call('c'.repeat(32));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ran: string[]; failed: string[] };
    expect(body.ran).toEqual(expect.arrayContaining(['e3-nudge', 'token-health', 'e13-daily']));
    expect(body.failed).toEqual([]);
    expect(await q(`select 1 from system_status where key = 'last_tick_at'`)).toHaveLength(1);
  });
});

describe('AC3 + AC1: the E3 nudge', () => {
  it('25 h of waiting gets one E3; two more ticks send nothing twice; a new wait gets its own E3', async () => {
    const now = new Date();
    const first = new Date(now.getTime() - 25 * HOUR);
    const id = await makeRequest({ awaiting_jon_since: first });
    await sendDueNudges(now, FAR);
    await sendDueNudges(now, FAR);
    expect(await e3For(id)).toEqual([{ event_key: first.toISOString(), status: 'sent' }]);
    const sent = sendSpy.mock.calls.filter((c) => c[0].template === 'E3');
    expect(sent).toHaveLength(1);
    expect(sent[0]![0].to).toBe('jon@example.com');
    expect(sent[0]![0].subject).toBe('Still waiting: Nudge Test, The Long Lunch');
    // the guest re-proposes: a new wait starts; nothing until it is 24 h old, then its own E3
    const second = new Date(now.getTime() - 2 * HOUR);
    await q(`update request set awaiting_jon_since = $2 where id = $1`, [id, second]);
    await sendDueNudges(now, FAR);
    expect(await e3For(id)).toHaveLength(1);
    const later = new Date(second.getTime() + 24 * HOUR + 60_000);
    await sendDueNudges(later, FAR);
    await sendDueNudges(later, FAR);
    expect((await e3For(id)).map((r) => r.event_key)).toEqual([first.toISOString(), second.toISOString()]);
  });
  it('23 h is too early; Jon acting (the wait cleared), spam, cancelled or done never get one', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 30 * HOUR);
    const ids = [
      await makeRequest({ awaiting_jon_since: new Date(now.getTime() - 23 * HOUR) }),
      await makeRequest({ awaiting_jon_since: null }),
      await makeRequest({ awaiting_jon_since: old, spam_suspect: true }),
      await makeRequest({
        awaiting_jon_since: old,
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: 'jon',
      }),
      await makeRequest({
        awaiting_jon_since: old,
        status: 'done',
        locked_starts_at: new Date(now.getTime() - 50 * HOUR),
        locked_ends_at: new Date(now.getTime() - 48 * HOUR),
      }),
    ];
    await sendDueNudges(now, FAR);
    for (const id of ids) expect(await e3For(id)).toEqual([]);
  });
  it('the claim and the email commit together: nudged_for is the wait that was nudged', async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 26 * HOUR);
    const ids = [
      await makeRequest({ awaiting_jon_since: since }),
      await makeRequest({ awaiting_jon_since: since }),
    ];
    await sendDueNudges(now, FAR, 1); // a batch of one still drains every due row
    const rows = await q<{ nudged_for: Date }>('select nudged_for from request where id = any($1::uuid[])', [
      ids,
    ]);
    expect(rows.map((r) => r.nudged_for.toISOString())).toEqual([since.toISOString(), since.toISOString()]);
  });
});

describe('AC2: the 07:00 PT token check', () => {
  const at = (iso: string) => new Date(iso); // March 2027: PDT is UTC-7, so 07:00 PT = 14:00 UTC
  // #41's E14 claim (rolling 6 h) and other files' E14 rows outlive a test; these tests use 2027 dates, so a later one would read as recent.
  beforeEach(async () => {
    await q(`delete from system_status where key in ($1, 'token_health_day', 'token_health_fails')`, [
      GOOGLE_ALERT_KEY,
    ]);
    await q(`delete from email_log where template = 'E14'`); // other files' E14 rows (#41's alert tests)
  });
  it('before 07:00 PT nothing runs; a revoked grant sends E14 by 07:00, once that day', async () => {
    const health = vi.spyOn(mockCalendar, 'health').mockResolvedValue('revoked');
    try {
      expect(await checkTokenHealth(at('2027-03-15T13:45:00Z'))).toBe('not_due');
      expect(health).not.toHaveBeenCalled();
      const r = await checkTokenHealth(at('2027-03-15T14:00:00Z'));
      expect(r).toEqual({ health: 'revoked', e14: 'sent' });
      expect(await checkTokenHealth(at('2027-03-15T14:15:00Z'))).toBe('not_due');
      expect(health).toHaveBeenCalledTimes(1);
      const [e14] = await q<{ event_key: string; to_email: string }>(
        `select event_key, to_email::text from email_log where template = 'E14' and event_key = $1`,
        [e14EventKey(at('2027-03-15T14:00:00Z'))],
      );
      expect(e14).toEqual({ event_key: 'google_auth:2027-03-15T12:00:00.000Z', to_email: 'jon@example.com' });
      // pr42 F1: ONE sender. A live invalid_grant an hour later (#41's path) sends no second E14.
      expect(await sendE14Once('invalid_grant', at('2027-03-15T15:00:00Z'))).toBe('recent');
      expect(await q(`select 1 from email_log where template = 'E14'`)).toHaveLength(1);
      // the next day checks again
      expect(await checkTokenHealth(at('2027-03-16T14:05:00Z'))).toEqual({ health: 'revoked', e14: 'sent' });
    } finally {
      health.mockRestore();
      await q(`delete from email_log where template = 'E14'`);
    }
  });
  it('a healthy or never-connected calendar sends nothing; a transient error is retried by later ticks, 3 tries a day (pr42 F6)', async () => {
    const health = vi.spyOn(mockCalendar, 'health').mockResolvedValueOnce('ok');
    try {
      expect(await checkTokenHealth(at('2027-03-17T15:00:00Z'))).toEqual({ health: 'ok', e14: null });
      await q(`delete from system_status where key = 'token_health_day'`);
      health.mockResolvedValueOnce('not_connected');
      expect(await checkTokenHealth(at('2027-03-17T15:00:00Z'))).toEqual({
        health: 'not_connected',
        e14: null,
      });
      await q(`delete from system_status where key = 'token_health_day'`);
      await q(`delete from system_status where key = 'token_health_fails'`);
      health.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce('revoked');
      await expect(checkTokenHealth(at('2027-03-17T15:00:00Z'))).rejects.toThrow('ECONNRESET');
      expect(await checkTokenHealth(at('2027-03-17T15:15:00Z'))).toEqual({ health: 'revoked', e14: 'sent' });
      expect(await checkTokenHealth(at('2027-03-17T15:30:00Z'))).toBe('not_due'); // done for the day
      await q(`delete from email_log where template = 'E14'`);

      // Three failures on one day: the third keeps the claim, so a fourth tick doesn't call Google again.
      health.mockReset().mockRejectedValue(new Error('timeout'));
      for (const t of ['14:00', '14:15', '14:30'])
        await expect(checkTokenHealth(at(`2027-03-18T${t}:00Z`))).rejects.toThrow('timeout');
      expect(await checkTokenHealth(at('2027-03-18T14:45:00Z'))).toBe('not_due');
      expect(health).toHaveBeenCalledTimes(3);
      // A new day starts its own count.
      await expect(checkTokenHealth(at('2027-03-19T14:00:00Z'))).rejects.toThrow('timeout');
      health.mockResolvedValueOnce('ok');
      expect(await checkTokenHealth(at('2027-03-19T14:15:00Z'))).toEqual({ health: 'ok', e14: null });
      expect(await q(`select 1 from email_log where template = 'E14'`)).toHaveLength(0);
    } finally {
      health.mockRestore();
    }
  });
});

describe('E13: the 18:00 PT story digest', () => {
  const at = (iso: string) => new Date(iso); // 18:00 PDT = 01:00 UTC the next day
  async function story(createdAt: string, body: string, requestId: string | null, photos = 0) {
    const [s] = await q<{ id: string }>(
      `insert into story (source, request_id, from_name, body, created_at) values ('story_page', $1, $2, $3, $4) returning id`,
      [requestId, requestId ? null : 'Kim', body, createdAt],
    );
    for (let i = 0; i < photos; i++) {
      await q(
        `insert into photo (story_id, storage_path, width, height, bytes) values ($1, $2, 10, 10, 10)`,
        [s!.id, `final/${randomUUID()}.jpg`],
      );
    }
    return s!.id;
  }
  // Each case starts with no E13 row: a tick earlier in the run that ran on the real clock after 18:00 PT writes
  // today's E13, which would otherwise be read back as this case's (CI flake, 2026-10-09).
  beforeEach(async () => {
    await q(`delete from email_log where template = 'E13'`);
  });
  afterAll(async () => {
    await q(`delete from story where created_at < '2027-06-01'`);
    await q(`delete from email_log where template = 'E13'`);
  });
  it('sends once after 18:00 PT with the first line of each story saved since yesterday 18:00; never before', async () => {
    const req = await makeRequest({ contact_name: 'Dave' });
    await story('2027-03-14T00:59:00Z', 'Too early: yesterday before 18:00', null);
    await story('2027-03-14T02:00:00Z', 'The lake at dawn\nand the rest of it', req, 2);
    await story('2027-03-14T20:00:00Z', `  ${'x'.repeat(200)}`, null, 1);
    await story('2027-03-15T01:30:00Z', 'After today 18:00: tomorrow', null);
    const spam = await story('2027-03-14T21:00:00Z', 'Buy cheap pills', null);
    await q('update story set spam_suspect = true where id = $1', [spam]);
    expect(await sendDailyDigest(at('2027-03-15T00:59:00Z'))).toBe('not_yet');
    expect(await sendDailyDigest(at('2027-03-15T01:45:00Z'))).toBe('sent');
    expect(await sendDailyDigest(at('2027-03-15T02:00:00Z'))).toBe('duplicate');
    const e13 = sendSpy.mock.calls.filter((c) => c[0].template === 'E13');
    expect(e13).toHaveLength(1);
    expect(e13[0]![0].subject).toBe('New stories: 2');
    expect(e13[0]![0].text).toBe(
      `- Dave, The Long Lunch: The lake at dawn\n- Kim: ${'x'.repeat(119)}…\n- Photos: 3\nhttp://localhost:3000/admin/stories\n`,
    );
    const rows = await q<{ event_key: string }>(`select event_key from email_log where template = 'E13'`);
    expect(rows.map((r) => r.event_key)).toEqual(['2027-03-14']);
  });
  it('no photos: no photo line', async () => {
    await story('2027-04-10T20:00:00Z', 'Just words', null);
    expect(await sendDailyDigest(at('2027-04-11T01:05:00Z'))).toBe('sent');
    expect(sendSpy.mock.calls[0]![0].text).toBe('- Kim: Just words\nhttp://localhost:3000/admin/stories\n');
  });
  it('pr42 F5: missed evenings are caught up (from the last digest, at most a week back)', async () => {
    await story('2027-05-01T20:00:00Z', 'Day one', null);
    expect(await sendDailyDigest(at('2027-05-02T01:05:00Z'))).toBe('sent'); // 05-01 18:05 PT
    await story('2027-05-02T03:00:00Z', 'Evening one', null); // 05-01 20:00 PT
    await story('2027-05-02T22:00:00Z', 'Day two', null); // 05-02, whose 18:00 digest never ran
    await story('2027-05-03T20:00:00Z', 'Day three', null);
    sendSpy.mockClear();
    expect(await sendDailyDigest(at('2027-05-04T01:05:00Z'))).toBe('sent'); // 05-03 18:05 PT
    expect(sendSpy.mock.calls[0]![0].subject).toBe('New stories: 3');
    // More than a week since the last digest: only since yesterday 18:00.
    await story('2027-05-12T20:00:00Z', 'Old and unsent', null);
    await story('2027-05-19T20:00:00Z', 'Recent', null);
    sendSpy.mockClear();
    expect(await sendDailyDigest(at('2027-05-20T01:05:00Z'))).toBe('sent');
    expect(sendSpy.mock.calls[0]![0].text).toBe('- Kim: Recent\nhttp://localhost:3000/admin/stories\n');
  });
  it('nothing new: no email', async () => {
    expect(await sendDailyDigest(at('2027-04-02T02:00:00Z'))).toBe('nothing_new');
    expect(sendSpy).not.toHaveBeenCalled();
  });
  it('firstLine trims, stops at the first line break and caps the length', () => {
    expect(firstLine(null)).toBe('');
    expect(firstLine('\n  hello  \r\nworld')).toBe('hello');
  });
});

describe('T3.11: counts only', () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    beacon(
      new NextRequest('http://localhost:3000/api/events', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari',
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
  beforeEach(async () => {
    await q('delete from event_count');
    await q(`delete from rate_limit where scope = 'eventBeacon'`);
  });
  it('countEvent adds one per call to today (Vancouver) and nothing else', async () => {
    await countEvent('invite_opened');
    await countEvent('invite_opened');
    await countEvent('locked');
    expect(await counts()).toEqual({ invite_opened: 2, locked: 1 });
  });
  it('the beacon counts the sheet and the picker; bots, bad names and foreign origins count nothing', async () => {
    expect((await post({ name: 'dish_sheet_opened' })).status).toBe(204);
    expect((await post({ name: 'picker_opened' })).status).toBe(204);
    expect((await post({ name: 'picker_opened' }, { 'user-agent': 'facebookexternalhit/1.1' })).status).toBe(
      204,
    );
    expect((await post({ name: 'locked' })).status).toBe(400); // server-side events can't be faked
    expect((await post({ name: 'picker_opened' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect(await counts()).toEqual({ dish_sheet_opened: 1, picker_opened: 1 });
  });
  it('pr42 F3: the 61st beacon in an hour is refused before its body is read, and counts nothing', async () => {
    for (let i = 0; i < 60; i++) expect((await post({ name: 'dish_sheet_opened' })).status).toBe(204);
    expect((await post({ name: 'dish_sheet_opened' })).status).toBe(429);
    expect((await post({ name: 'locked' })).status).toBe(429); // a bad body: still 429, not 400
    expect(await counts()).toEqual({ dish_sheet_opened: 60 });
  });
  it('pr42 F4: a body over 256 bytes is refused (declared or actual), before any parsing', async () => {
    expect((await post({ name: 'picker_opened', pad: 'x'.repeat(300) })).status).toBe(413);
    expect((await post({ name: 'picker_opened', pad: 'é'.repeat(120) })).status).toBe(413); // bytes, not chars
    const declared = await post({ name: 'picker_opened' }, { 'content-length': '5000' });
    expect(declared.status).toBe(413);
    expect(await counts()).toEqual({});
  });
  it('pr42 F7: a honeypot (spam) story counts nothing', async () => {
    const id = await makeRequest({ contact_name: 'Spam Count' });
    await saveAfterSendStory(id, { body: 'x', consent: false, spam: true });
    expect(await counts()).toEqual({});
    await q('delete from story where request_id = $1', [id]);
  });
  it('a story counts once when it is first saved, not on each later save', async () => {
    const id = await makeRequest({ contact_name: 'Story Count' });
    await saveAfterSendStory(id, { consent: false });
    await saveAfterSendStory(id, { body: 'More', consent: true });
    expect(await counts()).toEqual({ story_added: 1 });
    await q('delete from story where request_id = $1', [id]);
  });
});
