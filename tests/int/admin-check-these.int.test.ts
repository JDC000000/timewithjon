// T2.9.04 (TSD T2.9 AC4, T2.2 A2 "Check these"): Not spam → Needs a reply + E2; Delete only for spam suspects;
// stories get the same two answers. Through the real route handlers against the test DB; only the Supabase
// session is faked. afterAll deletes every row made here.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { pool, q } from '@/lib/db';
import { made, newRequest, slotId } from '../fixtures/requests-db';
import { deliverRequestEmails } from '@/features/email/send';
import { lockRequest } from '@/features/requests/lock';
import { POST as requestNotSpam } from '@/app/api/admin/requests/[id]/not-spam/route';
import { DELETE as requestDelete } from '@/app/api/admin/requests/[id]/spam/route';
import { POST as storyNotSpam } from '@/app/api/admin/stories/[id]/not-spam/route';
import { DELETE as storyDelete } from '@/app/api/admin/stories/[id]/spam/route';
import { PATCH as storyConsent } from '@/app/api/admin/stories/[id]/route';
import { GET as inbox } from '@/app/api/admin/requests/route';

vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn() }));
// pr47 F3: the real sender, unless a test makes it throw once.
vi.mock('@/features/email/send', async (actual) => {
  const real = await actual<typeof import('@/features/email/send')>();
  return { ...real, deliverRequestEmails: vi.fn(real.deliverRequestEmails) };
});
vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const stories: string[] = [];
type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const call = (h: Handler, method: string, id: string, body?: unknown, origin = SITE) =>
  h(
    new NextRequest(`${SITE}/api/admin/x/${id}`, {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
const expectRefusal = async (res: Response, status: number, code: string) => {
  expect(res.status).toBe(status);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(((await res.json()) as { code: string }).code).toBe(code);
};
const tab = async (t: string) =>
  (
    (await (await inbox(new NextRequest(`${SITE}/api/admin/requests?tab=${t}`))).json()) as {
      cards: { id: string }[];
    }
  ).cards.map((c) => c.id);
const emails = (requestId: string) =>
  q<{ template: string; to_email: string; status: string; vars: { summary: string; adminLink: string } }>(
    `select template, to_email::text, status, vars from email_log where request_id = $1 order by template`,
    [requestId],
  );
const audits = (action: string, target: string) =>
  q(`select 1 from audit_log where action = $1 and (request_id::text = $2 or detail->>'story_id' = $2)`, [
    action,
    target,
  ]);

async function newStory(spam: boolean, requestId: string | null = null): Promise<string> {
  const [row] = await q<{ id: string }>(
    `insert into story (source, request_id, from_name, from_email, body, consent, consent_source, spam_suspect)
     values ('story_page', $1, 'Sam', 'sam@example.com', 'A long lunch.', true, 'tickbox', $2) returning id`,
    [requestId, spam],
  );
  stories.push(row!.id);
  return row!.id;
}

afterAll(async () => {
  await q(`delete from story where id = any($1::uuid[])`, [stories]);
  await q(`delete from request where id = any($1::uuid[])`, [made]);
  await pool().end();
});

describe('Check these: a request (T2.9.04)', () => {
  it('Not spam moves it to Needs a reply and sends Jon the E2 once; the guest gets nothing', async () => {
    const slots = [await slotId('2027-05-13', 'lunch'), await slotId('2027-05-13', 'evening')];
    const id = await newRequest({ spam: true, slotIds: slots });
    expect(await tab('check')).toContain(id);
    expect(await emails(id)).toEqual([]);

    const res = await call(requestNotSpam, 'POST', id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const [r] = await q<{ spam_suspect: boolean; awaiting: boolean; status: string }>(
      `select spam_suspect, awaiting_jon_since is not null as awaiting, status from request where id = $1`,
      [id],
    );
    expect(r).toEqual({ spam_suspect: false, awaiting: true, status: 'requested' });
    expect(await tab('needs_reply')).toContain(id);
    expect(await tab('check')).not.toContain(id);
    const sent = await emails(id);
    expect(sent.map((e) => [e.template, e.to_email, e.status])).toEqual([['E2', 'jon@example.com', 'sent']]);
    expect(sent[0]!.vars.summary).toBe('Crew 3. 2 time(s).');
    expect(sent[0]!.vars.adminLink).toMatch(new RegExp(`/admin/requests/${id}$`));
    expect(await audits('request_not_spam', id)).toHaveLength(1);

    // Again: it's no longer a spam suspect, so nothing changes and no second E2.
    await expectRefusal(await call(requestNotSpam, 'POST', id), 409, 'not_spam_suspect');
    expect(await emails(id)).toHaveLength(1);
  });

  it('a stand-by suspect gets the stand-by E2', async () => {
    const id = await newRequest({ spam: true, standbyWeek: '2027-05-10' });
    expect((await call(requestNotSpam, 'POST', id)).status).toBe(200);
    const [e2] = await emails(id);
    expect(e2!.vars.summary).toBe('Crew 3. Stand-by, week of May 10.');
  });

  it('a suspect that no longer waits on Jon is cleared with no wait and no email', async () => {
    const id = await newRequest({ spam: true });
    await q(
      `update request set status = 'cancelled', cancelled_at = now(), cancelled_by = 'guest' where id = $1`,
      [id],
    );
    expect((await call(requestNotSpam, 'POST', id)).status).toBe(200);
    expect(await q(`select spam_suspect, awaiting_jon_since from request where id = $1`, [id])).toEqual([
      { spam_suspect: false, awaiting_jon_since: null },
    ]);
    expect(await emails(id)).toEqual([]);
  });

  it('AC4: only a spam suspect can be deleted; its children go with it', async () => {
    const real = await newRequest({ slotIds: [await slotId('2027-05-14', 'lunch')] });
    await expectRefusal(await call(requestDelete, 'DELETE', real), 409, 'not_spam_suspect');
    expect(await q(`select 1 from request where id = $1`, [real])).toHaveLength(1);

    const spam = await newRequest({ spam: true, slotIds: [await slotId('2027-05-14', 'lunch')] });
    const before = (await q(`select 1 from audit_log where action = 'spam_request_deleted'`)).length;
    // pr53 F1: an UPPERCASE id (z.uuid() takes it) is the same row, audited in the lowercase form.
    expect((await call(requestDelete, 'DELETE', spam.toUpperCase())).status).toBe(200);
    expect(await q(`select 1 from request where id = $1`, [spam])).toEqual([]);
    expect(await q(`select 1 from request_slot_choice where request_id = $1`, [spam])).toEqual([]);
    expect(await q(`select 1 from audit_log where action = 'spam_request_deleted'`)).toHaveLength(before + 1);
    // pr47 F4: the audit names the deleted request in its detail (the column was set null by the delete).
    expect(
      await q(
        `select request_id from audit_log where action = 'spam_request_deleted' and detail->>'request_id' = $1`,
        [spam],
      ),
    ).toEqual([{ request_id: null }]);
    await expectRefusal(await call(requestDelete, 'DELETE', spam), 404, 'not_found');
  });

  it('pr47 F1: a suspect that went further than a request is not deletable, and is kept', async () => {
    const kept = async (id: string) => {
      await expectRefusal(await call(requestDelete, 'DELETE', id), 409, 'not_deletable');
      expect(await q(`select 1 from request where id = $1`, [id])).toHaveLength(1);
    };
    // Jon locked it from its detail page: a booking with a calendar event queued.
    const locked = await newRequest({ spam: true });
    const slot = await slotId('2027-06-18', 'lunch');
    expect(await lockRequest({ requestId: locked, target: { slotId: slot }, mode: 'lock' })).toMatchObject({
      ok: true,
    });
    await kept(locked);
    // Still requested, but something reached a calendar, or a story or a joined guest hangs off it.
    const onCalendar = await newRequest({ spam: true });
    await q(`update request set calendar_state = 'failed' where id = $1`, [onCalendar]);
    await kept(onCalendar);
    const withStory = await newRequest({ spam: true });
    await newStory(false, withStory);
    await kept(withStory);
    const joinedTo = await newRequest({ spam: true });
    const joiner = await newRequest();
    await q(`update request set joined_to_request_id = $2 where id = $1`, [joiner, joinedTo]);
    await kept(joinedTo);
    await q(`update request set joined_to_request_id = null where id = $1`, [joiner]);
    const cancelled = await newRequest({ spam: true });
    await q(
      `update request set status = 'cancelled', cancelled_at = now(), cancelled_by = 'guest' where id = $1`,
      [cancelled],
    );
    await kept(cancelled);
    // A stand-by suspect with nothing hanging off it can still go.
    const standby = await newRequest({ spam: true, standbyWeek: '2027-06-07' });
    expect((await call(requestDelete, 'DELETE', standby)).status).toBe(200);
  });

  it('pr47 F3: Not spam is a 200 once committed, even if sending the E2 then throws (the tick retries it)', async () => {
    const id = await newRequest({ spam: true });
    vi.mocked(deliverRequestEmails).mockRejectedValueOnce(new Error('select failed'));
    expect((await call(requestNotSpam, 'POST', id)).status).toBe(200);
    expect(await q(`select spam_suspect from request where id = $1`, [id])).toEqual([
      { spam_suspect: false },
    ]);
    expect((await emails(id)).map((e) => [e.template, e.status])).toEqual([['E2', 'pending']]);
  });

  it('404s an unknown or malformed id and refuses a cross-site call', async () => {
    for (const h of [requestNotSpam, storyNotSpam]) {
      await expectRefusal(await call(h, 'POST', randomUUID()), 404, 'not_found');
      await expectRefusal(await call(h, 'POST', 'nope'), 404, 'not_found');
    }
    for (const h of [requestDelete, storyDelete]) {
      await expectRefusal(await call(h, 'DELETE', randomUUID()), 404, 'not_found');
      await expectRefusal(await call(h, 'DELETE', 'nope'), 404, 'not_found');
    }
    const id = await newRequest({ spam: true });
    expect((await call(requestDelete, 'DELETE', id, undefined, 'https://evil.example')).status).toBe(403);
    expect((await call(requestNotSpam, 'POST', id, undefined, 'https://evil.example')).status).toBe(403);
    expect(await q(`select spam_suspect from request where id = $1`, [id])).toEqual([{ spam_suspect: true }]);
  });
});

describe('Check these: a story (T2.9.04)', () => {
  it('Not spam lets it into the list and the counts, and consent can be set again', async () => {
    const requestId = await newRequest();
    const id = await newStory(true, requestId);
    await expectRefusal(await call(storyConsent, 'PATCH', id, { consent: false }), 409, 'spam_suspect');
    expect((await call(storyNotSpam, 'POST', id.toUpperCase())).status).toBe(200); // pr53 F1
    expect(await q(`select spam_suspect, consent from story where id = $1`, [id])).toEqual([
      { spam_suspect: false, consent: true },
    ]);
    expect(
      await q(
        `select request_id from audit_log where action = 'story_not_spam' and detail->>'story_id' = $1`,
        [id],
      ),
    ).toEqual([{ request_id: requestId }]);
    expect((await call(storyConsent, 'PATCH', id.toUpperCase(), { consent: false })).status).toBe(200); // pr53 F1
    expect(await audits('story_consent_withdrawn', id)).toHaveLength(1);
    await expectRefusal(await call(storyNotSpam, 'POST', id), 409, 'not_spam_suspect');
  });

  it('AC4: only a spam story can be deleted, and not while it has photos', async () => {
    const real = await newStory(false);
    await expectRefusal(await call(storyDelete, 'DELETE', real), 409, 'not_spam_suspect');
    expect(await q(`select 1 from story where id = $1`, [real])).toHaveLength(1);

    const withPhoto = await newStory(true);
    await q(`insert into photo (story_id, storage_path, width, height, bytes) values ($1, $2, 10, 10, 100)`, [
      withPhoto,
      `final/${randomUUID()}.jpg`,
    ]);
    await expectRefusal(await call(storyDelete, 'DELETE', withPhoto), 409, 'has_photos');
    expect(await q(`select 1 from story where id = $1`, [withPhoto])).toHaveLength(1);

    // pr47 F2: an upload still in flight counts; a finalised or expired one doesn't.
    const uploading = await newStory(true);
    const upload = (story: string, expiresIn: string, finalised: boolean) =>
      q(
        `insert into photo_upload (story_id, incoming_path, expires_at, finalised_at)
         values ($1, $2, now() + $3::interval, case when $4 then now() end)`,
        [story, `incoming/${randomUUID()}.jpg`, expiresIn, finalised],
      );
    await upload(uploading, '15 minutes', false);
    await expectRefusal(await call(storyDelete, 'DELETE', uploading), 409, 'has_photos');
    const stale = await newStory(true);
    await upload(stale, '-1 minute', false);
    await upload(stale, '15 minutes', true);
    expect((await call(storyDelete, 'DELETE', stale)).status).toBe(200);

    const spam = await newStory(true);
    expect((await call(storyDelete, 'DELETE', spam)).status).toBe(200);
    expect(await q(`select 1 from story where id = $1`, [spam])).toEqual([]);
    expect(await audits('spam_story_deleted', spam)).toHaveLength(1);
  });
});
