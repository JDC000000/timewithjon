// T2.9 AC1 (consent toggle → consent_source='jon') and AC2 (personal_open_at moves the picker at once), plus the
// A6 list and the A7 settings/counts (people reached, M9), through /api/admin/stories and /api/admin/settings.
// afterAll deletes every story/request made here and restores the seeded settings.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { pool, q, withTx } from '@/lib/db';
import { createRequestTx } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';
import { loadEngineData, engineInput } from '@/features/availability/load';
import { openWindows } from '@/features/availability';
import { adminCounts } from '@/features/admin/settings';
import { GET as storiesRoute } from '@/app/api/admin/stories/route';
import { PATCH as storyRoute } from '@/app/api/admin/stories/[id]/route';
import { GET as settingsGet, PATCH as settingsPatch } from '@/app/api/admin/settings/route';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const madeRequests: string[] = [];
const madeStories: string[] = [];

afterAll(async () => {
  await q(`delete from story where id = any($1::uuid[])`, [madeStories]);
  await q(`delete from request where id = any($1::uuid[])`, [madeRequests]);
  await q(
    `update settings set personal_open_at = '2027-02-25T16:00:00Z', general_open_at = '2027-03-01T16:00:00Z',
            reply_promise_days = 2, default_weekly_cap = 2, freebusy_calendar_ids = array['primary'],
            before60_enabled = false`,
  );
  await pool().end();
});

const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`${SITE}${path}`, {
    method,
    headers: { origin: SITE, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const patchStory = (id: string, body: unknown) =>
  storyRoute(req('PATCH', `/api/admin/stories/${id}`, body), { params: Promise.resolve({ id }) });
const patchSettings = (body: unknown) => settingsPatch(req('PATCH', '/api/admin/settings', body));

async function newRequest(o: { email?: string; crew?: number; spam?: boolean } = {}): Promise<string> {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Sam Guest',
    email: o.email ?? `sam+${randomUUID().slice(0, 8)}@example.com`,
    crew: o.crew ?? 1,
  });
  const inviteId = (
    await q<{ id: string }>(`select id from invite where kind = 'general' and revoked_at is null`)
  )[0]!.id;
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId,
      isTest: true,
      spam: o.spam ?? false,
      mode: 'slots',
      status: 'requested',
      countsToward: 'weekly_cap',
      bigCrew: false,
      dishName: 'The Long Lunch',
    }),
  );
  madeRequests.push(requestId);
  return requestId;
}
const lockAt = (id: string, starts: string, ends: string) =>
  q(`update request set status = 'locked', locked_starts_at = $2, locked_ends_at = $3 where id = $1`, [
    id,
    starts,
    ends,
  ]);

async function newStory(s: {
  source: 'after_send' | 'story_page' | 'email_in';
  requestId?: string;
  consent?: boolean;
  consentSource?: string | null;
  needsJon?: boolean;
  spam?: boolean;
}): Promise<string> {
  const [row] = await q<{ id: string }>(
    `insert into story (source, request_id, from_name, from_email, body, consent, consent_source, consent_needs_jon,
                        spam_suspect)
     values ($1, $2, 'Sam', 'sam@example.com', 'We rode the Seymour lap.', $3, $4::consent_source, $5, $6)
     returning id`,
    [
      s.source,
      s.requestId ?? null,
      s.consent ?? false,
      s.consentSource ?? null,
      s.needsJon ?? false,
      s.spam ?? false,
    ],
  );
  madeStories.push(row!.id);
  return row!.id;
}

describe('T2.9.01 stories list + consent toggle', () => {
  it('lists stories ("needs Jon" first) with the request, photo count and no sealed plan', async () => {
    const requestId = await newRequest();
    await q(`update request set surprise_plan_sealed = 'SEALED-CANARY' where id = $1`, [requestId]);
    const afterSend = await newStory({
      source: 'after_send',
      requestId,
      consent: true,
      consentSource: 'tickbox',
    });
    await q(
      `insert into photo (story_id, storage_path, width, height, bytes) values ($1, $2, 10, 10, 100), ($1, $3, 10, 10, 100)`,
      [afterSend, `final/${randomUUID()}.jpg`, `final/${randomUUID()}.jpg`],
    );
    const emailed = await newStory({ source: 'email_in', needsJon: true });

    const res = await storiesRoute(req('GET', '/api/admin/stories'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).not.toContain('SEALED-CANARY');
    const { stories } = JSON.parse(text) as {
      stories: { id: string; consentNeedsJon: boolean; photoCount: number; request: unknown }[];
    };
    expect(stories[0]!.consentNeedsJon).toBe(true);
    const a = stories.find((s) => s.id === afterSend)!;
    expect(a.photoCount).toBe(2);
    expect(a.request).toEqual({
      id: requestId,
      dish: 'the-long-lunch',
      dishName: 'The Long Lunch',
      contactName: 'Sam Guest',
    });
    expect(stories.find((s) => s.id === emailed)!.request).toBeNull();
  });

  it('F5: a spam-suspect story is flagged, listed after every real one (even "needs Jon"), and refuses consent', async () => {
    const spam = await newStory({ source: 'story_page', needsJon: true, spam: true });
    const real = await newStory({ source: 'story_page' });
    const { stories } = (await (await storiesRoute(req('GET', '/api/admin/stories'))).json()) as {
      stories: { id: string; spamSuspect: boolean }[];
    };
    const at = (id: string) => stories.findIndex((s) => s.id === id);
    expect(stories[at(spam)]!.spamSuspect).toBe(true);
    expect(stories[at(real)]!.spamSuspect).toBe(false);
    expect(stories.slice(at(spam)).every((s) => s.spamSuspect)).toBe(true);
    expect(stories.slice(0, at(spam)).every((s) => !s.spamSuspect)).toBe(true);

    const auditsBefore = await q(`select 1 from audit_log where detail->>'story_id' = $1`, [spam]);
    for (const consent of [true, false]) {
      const res = await patchStory(spam, { consent });
      expect(res.status).toBe(409);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(((await res.json()) as { code: string }).code).toBe('spam_suspect');
    }
    expect(
      await q(`select consent, consent_source, consent_needs_jon from story where id = $1`, [spam]),
    ).toEqual([{ consent: false, consent_source: null, consent_needs_jon: true }]);
    expect(await q(`select 1 from audit_log where detail->>'story_id' = $1`, [spam])).toEqual(auditsBefore);
  });

  it('AC1: the toggle persists either way with consent_source=jon and settles "needs Jon"', async () => {
    const needsJon = await newStory({ source: 'email_in', needsJon: true });
    const ticked = await newStory({ source: 'story_page', consent: true, consentSource: 'tickbox' });
    expect((await patchStory(needsJon, { consent: true })).status).toBe(200);
    expect((await patchStory(ticked, { consent: false })).status).toBe(200);
    // F1: a story tied to a request audits that request as its target.
    const requestId = await newRequest();
    const linked = await newStory({ source: 'after_send', requestId });
    expect((await patchStory(linked, { consent: true })).status).toBe(200);
    const [last] = await q<{ action: string; request_id: string | null; detail: unknown }>(
      `select action, request_id, detail from audit_log where action like 'story_consent_%' order by at desc, id limit 1`,
    );
    expect(last).toEqual({
      action: 'story_consent_given',
      request_id: requestId,
      detail: { story_id: linked },
    });
    // Follow-up to F1 (migration 0303): a story with no request is still named, through detail.story_id.
    expect((await patchStory(ticked, { consent: true })).status).toBe(200);
    const byStory = await q<{ action: string; request_id: string | null }>(
      `select action, request_id from audit_log where detail->>'story_id' = $1 order by at, id`,
      [ticked],
    );
    expect(byStory).toEqual([
      { action: 'story_consent_withdrawn', request_id: null },
      { action: 'story_consent_given', request_id: null },
    ]);
    await patchStory(ticked, { consent: false });
    const rows = await q<{
      id: string;
      consent: boolean;
      consent_source: string;
      consent_needs_jon: boolean;
    }>(
      `select id, consent, consent_source, consent_needs_jon from story where id = any($1::uuid[]) order by consent desc`,
      [[needsJon, ticked]],
    );
    expect(rows).toEqual([
      { id: needsJon, consent: true, consent_source: 'jon', consent_needs_jon: false },
      { id: ticked, consent: false, consent_source: 'jon', consent_needs_jon: false },
    ]);
    const audit = await q<{ action: string }>(
      `select action from audit_log where action like 'story_consent_%' order by at desc limit 2`,
    );
    expect(audit.map((a) => a.action)).toContain('story_consent_given');
  });

  it('refuses a bad body (400) and an unknown or malformed id (404)', async () => {
    const id = await newStory({ source: 'story_page' });
    for (const body of [{ consent: 'yes' }, {}, { consent: true, source: 'jon' }]) {
      expect((await patchStory(id, body)).status).toBe(400);
    }
    expect((await patchStory(randomUUID(), { consent: true })).status).toBe(404);
    expect((await patchStory('nope', { consent: true })).status).toBe(404);
  });
});

describe('T2.9.02 settings read/update', () => {
  const personalPicker = async (now: Date) =>
    openWindows(engineInput(await loadEngineData(now), [], 'personal', ['lunch']));

  it('AC2: changing personal_open_at moves the picker opening at once', async () => {
    const now = new Date('2027-02-26T18:00:00Z');
    expect((await personalPicker(now)).opensAt).toBeUndefined(); // open since Feb 25
    const res = await patchSettings({ personalOpenAt: '2027-02-28T08:00:00-08:00' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { settings: { personalOpenAt: string } }).settings.personalOpenAt).toBe(
      '2027-02-28T16:00:00.000Z',
    );
    const out = await personalPicker(now);
    expect(out.opensAt).toBe('2027-02-28T16:00:00.000Z');
    expect(out.weeks.every((w) => w.state === 'closed')).toBe(true);
  });

  it('updates the other fields together and reads them back', async () => {
    const t0 = (await q<{ t: Date }>(`select clock_timestamp() t`))[0]!.t;
    const res = await patchSettings({
      replyPromiseDays: 3,
      defaultWeeklyCap: 3,
      freebusyCalendarIds: ['primary', 'family@group.calendar.google.com'],
      before60Enabled: true,
    });
    expect(res.status).toBe(200);
    const audits = await q(`select 1 from audit_log where action = 'settings_updated' and at >= $1`, [t0]);
    expect(audits).toHaveLength(1); // F4
    // F9: the audit row lists the changed column names only, never their values.
    const [audit] = await q<{ detail: unknown }>(
      `select detail from audit_log where action = 'settings_updated' and at >= $1`,
      [t0],
    );
    expect(audit!.detail).toEqual({
      fields: ['reply_promise_days', 'default_weekly_cap', 'freebusy_calendar_ids', 'before60_enabled'],
    });
    const getRes = await settingsGet(req('GET', '/api/admin/settings'));
    expect(getRes.headers.get('cache-control')).toBe('no-store');
    const got = (await getRes.json()) as {
      settings: Record<string, unknown>;
      counts: unknown;
    };
    expect(got.settings).toMatchObject({
      replyPromiseDays: 3,
      defaultWeeklyCap: 3,
      freebusyCalendarIds: ['primary', 'family@group.calendar.google.com'],
      before60Enabled: true,
      seasonStart: '2027-04-01',
    });
    expect(got.counts).toHaveProperty('peopleReached');
  });

  it('keeps the hoped-for list opening first, and refuses bad values', async () => {
    const before = await q(`select * from settings`);
    const late = await patchSettings({ personalOpenAt: '2027-03-02T16:00:00Z' });
    expect(late.status).toBe(400);
    expect(((await late.json()) as { code: string }).code).toBe('personal_after_general');
    expect((await patchSettings({ generalOpenAt: '2027-02-01T16:00:00Z' })).status).toBe(400);
    for (const body of [
      {},
      { replyPromiseDays: 0 },
      { replyPromiseDays: 15 },
      { defaultWeeklyCap: 11 },
      { freebusyCalendarIds: [] },
      { freebusyCalendarIds: ['a b'] },
      { freebusyCalendarIds: Array.from({ length: 11 }, (_, i) => `c${i}`) },
      { personalOpenAt: '2027-02-28T16:00:00' },
      { personalOpenAt: 'tomorrow' },
      { before60Enabled: 'yes' },
      { seasonStart: '2027-03-01' },
      { replyPromiseDays: 3, seasonEnd: '2027-12-31' }, // F3: an unknown key is refused, not dropped
      { freebusyCalendarIds: ['primary', 'primary'] }, // F8
    ]) {
      expect((await patchSettings(body)).status).toBe(400);
    }
    expect(await q(`select * from settings`)).toEqual(before);
    // Both moving together is fine.
    // F7: release times within the last year and before the season ends.
    for (const body of [
      { personalOpenAt: '0001-01-01T00:00:00Z' },
      { generalOpenAt: '2027-07-01T08:00:00Z' }, // after Jun 30 in Vancouver
      { personalOpenAt: '2027-02-25T16:00:00Z', generalOpenAt: '9999-12-31T00:00:00Z' },
    ]) {
      const r = await patchSettings(body);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { code: string }).code).toBe('release_out_of_range');
    }
    // F2: the same moment for both is fine.
    expect(
      (await patchSettings({ personalOpenAt: '2027-03-01T16:00:00Z', generalOpenAt: '2027-03-01T16:00:00Z' }))
        .status,
    ).toBe(200);
    const both = await patchSettings({
      personalOpenAt: '2027-03-10T16:00:00Z',
      generalOpenAt: '2027-03-12T16:00:00Z',
    });
    expect(both.status).toBe(200);
  });
});

describe('T2.9.02 counts: people reached (M9)', () => {
  it('a joined guest whose host is already done counts as done (the inbox ENDED rule, F6)', async () => {
    const now = new Date('2027-06-01T00:00:00Z');
    const base = await adminCounts(now);
    const host = await newRequest({ crew: 2 });
    await q(
      `update request set status = 'done', locked_starts_at = '2027-06-28T18:00:00Z',
              locked_ends_at = '2027-06-28T19:00:00Z' where id = $1`,
      [host],
    );
    const joiner = await newRequest({ crew: 1 });
    await q(`update request set status = 'locked', joined_to_request_id = $2 where id = $1`, [joiner, host]);
    const after = await adminCounts(now);
    expect(after.requests.done - base.requests.done).toBe(2);
    expect(after.guestsReached - base.guestsReached).toBe(2);
    expect(after.peopleReached - base.peopleReached).toBe(3);
  });

  it('distinct guests with a done booking (joined included) + their companions; groups count once', async () => {
    const now = new Date('2027-06-20T12:00:00Z');
    const base = await adminCounts(now);
    const aEmail = `a+${randomUUID().slice(0, 8)}@example.com`;
    const host = await newRequest({ email: aEmail, crew: 3 });
    await lockAt(host, '2027-06-19T17:00:00Z', '2027-06-19T19:00:00Z'); // ended: lazily done
    const joined = await newRequest({ crew: 2 });
    await q(`update request set status = 'locked', joined_to_request_id = $2 where id = $1`, [joined, host]);
    const again = await newRequest({ email: aEmail, crew: 1 }); // guest A's second done booking
    await lockAt(again, '2027-06-19T20:00:00Z', '2027-06-19T21:00:00Z');
    await q(`update request set status = 'done' where id = $1`, [again]);
    const future = await newRequest({ crew: 4 });
    await lockAt(future, '2027-06-27T18:00:00Z', '2027-06-27T19:00:00Z');
    const spam = await newRequest({ crew: 5, spam: true });
    await lockAt(spam, '2027-06-19T22:00:00Z', '2027-06-19T23:00:00Z');
    const cancelled = await newRequest();
    await q(`update request set status = 'cancelled' where id = $1`, [cancelled]);
    await newStory({ source: 'story_page', consent: true, consentSource: 'tickbox', needsJon: true });
    // F5: spam-suspect stories count only as spam, never in total/consented/needsJon.
    await newStory({
      source: 'story_page',
      consent: true,
      consentSource: 'tickbox',
      needsJon: true,
      spam: true,
    });
    await newStory({ source: 'email_in', spam: true });

    const after = await adminCounts(now);
    expect(after.guestsReached - base.guestsReached).toBe(2); // A (twice) and the joined guest
    expect(after.peopleReached - base.peopleReached).toBe(2 + (2 + 1 + 0)); // + companions
    expect(after.confirmedBookings - base.confirmedBookings).toBe(3); // host, A again, future; not joined
    expect(after.requests.done - base.requests.done).toBe(3);
    expect(after.requests.locked - base.requests.locked).toBe(1);
    expect(after.requests.cancelled - base.requests.cancelled).toBe(1);
    expect(after.checkThese - base.checkThese).toBe(1);
    expect(after.stories.total - base.stories.total).toBe(1);
    expect(after.stories.consented - base.stories.consented).toBe(1);
    expect(after.stories.needsJon - base.stories.needsJon).toBe(1);
    expect(after.stories.spam - base.stories.spam).toBe(2);
    // Before the end times pass, none of it is done yet.
    const early = await adminCounts(new Date('2027-06-19T16:00:00Z'));
    expect(early.guestsReached - base.guestsReached).toBe(1); // only the one marked done
  });
});
