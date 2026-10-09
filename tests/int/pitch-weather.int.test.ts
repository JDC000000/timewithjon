// T2.4 (lane L1): About your pitch → E8 / E9 (T2.4.05) and the weather call → delete the event + E10 (T2.4.06),
// with TSD T2.4 AC5, against the test DB with the mock mailer and calendar.
// The clock is 2027-03-15 (after the general release, before the season); each test uses its own season days.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

import { POST as pitchRoute } from '@/app/api/admin/requests/[id]/pitch/route';
import { POST as weatherRoute } from '@/app/api/admin/requests/[id]/weather/route';
import { queueIcsEmail } from '@/features/calendar/ics-email';
import { menuLink, resolveLinkVars, UnknownLinkKindError } from '@/features/email/link-vars';
import { findToken, issueManageToken, manageExpiry } from '@/features/invites/action-tokens';
import { loadManageModel, loadNewDateModel } from '@/features/invites/manage-model';
import { createRequestTx } from '@/features/requests/create';
import { lockRequest } from '@/features/requests/lock';
import { replyToPitch, weatherCall } from '@/features/requests/pitch-weather';
import { RerequestBody, rerequest } from '@/features/requests/rerequest';
import { RequestBody } from '@/features/requests/schema';
import { suggestTimes } from '@/features/requests/suggest';
import { takeOffer } from '@/features/requests/take-offer';
import { mockCalendar } from '@/lib/adapters/mock/calendar';
import { pool, q, withTx } from '@/lib/db';
import { vancouverInstant } from '@/lib/time';
import { saveEmailBudget } from '../fixtures/email-budget';
import { removeRequests } from '../fixtures/requests-db';

const SITE = 'http://localhost:3000';
const NOW = new Date('2027-03-15T18:00:00Z');
const made: string[] = [];
let invite = { id: '', link: '' };

let restoreBudget = async () => {};
beforeAll(async () => {
  restoreBudget = await saveEmailBudget();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const [i] = await q<{ id: string; name_slug: string; token_secret: string }>(
    `select id, name_slug, token_secret from invite where kind = 'general' and revoked_at is null`,
  );
  invite = { id: i!.id, link: `/?for=${i!.name_slug}-${i!.token_secret}` };
});
afterAll(async () => {
  vi.useRealTimers();
  await restoreBudget();
  await removeRequests(made); // gone for good: re-runs on one DB stay under admin-inbox's capped Cancelled tab
  await pool().end();
});

const slotId = async (date: string) =>
  (await q<{ id: string }>(`select id from slot where date = $1 and window_kind = 'lunch'`, [date]))[0]!.id;

async function newRequest(dish = 'the-long-lunch', slotIds: string[] = []) {
  const pitch = dish === 'pitch-me';
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish,
    name: 'Pat Pitcher',
    email: `pat+${randomUUID().slice(0, 8)}@example.com`,
    crew: 2,
    slotIds,
    dates: pitch ? ['2027-05-29'] : [],
    pitchIdea: pitch ? 'Three days on the Sunshine Coast' : undefined,
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId: invite.id,
      isTest: true,
      spam: false,
      mode: pitch ? 'dates' : 'slots',
      status: 'requested',
      countsToward: pitch ? 'none' : 'weekly_cap',
      bigCrew: false,
      dishName: dish,
    }),
  );
  made.push(requestId);
  return { id: requestId, email: body.email };
}
/** A locked booking; a Big Day unless `bigDay` is false (C4: only a Big Day gets a Weather call). */
async function lockedRequest(date: string, bigDay = true) {
  const slot = await slotId(date);
  const r = await newRequest('the-long-lunch', [slot]);
  expect((await lockRequest({ requestId: r.id, target: { slotId: slot }, mode: 'lock', now: NOW })).ok).toBe(
    true,
  );
  if (bigDay) await q(`update request set counts_toward = 'big_day' where id = $1`, [r.id]);
  return { ...r, slot };
}

const row = async (id: string) =>
  (
    await q<{
      status: string;
      awaiting_jon_since: Date | null;
      locked_starts_at: Date | null;
      google_event_id: string | null;
      calendar_state: string;
    }>(
      `select status, awaiting_jon_since, locked_starts_at, google_event_id, calendar_state from request where id = $1`,
      [id],
    )
  )[0]!;
const lastMail = async (to: string) =>
  (
    await q<{ subject: string; text_body: string }>(
      `select subject, text_body from dev_outbox where to_email = $1 order by created_at desc limit 1`,
      [to],
    )
  )[0];
const post = (url: string, body: unknown) =>
  new NextRequest(`${SITE}${url}`, {
    method: 'POST',
    headers: { origin: SITE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('T2.4.05 About your pitch → E8 or E9', () => {
  it('E8: the smaller version, in Jon’s words, with a manage link; the request needs a new time', async () => {
    const { id, email } = await newRequest('pitch-me');
    expect(await replyToPitch(id, { reply: 'smaller', length: 'three days long' })).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ status: 'needs_new_time', awaiting_jon_since: null });
    const mail = (await lastMail(email))!;
    expect(mail.subject).toBe('About your pitch');
    expect(mail.text_body).toMatch(
      /^I love this\. It’s also three days long, and I promised one night away, max\./,
    );
    const raw = /\/manage\?t=([A-Za-z0-9_-]{43})#another\n/.exec(mail.text_body)![1]!; // EML-05: opens the form
    expect((await findToken(raw))!.purpose).toBe('manage');
    const [log] = await q<{ event_key: string; vars: Record<string, unknown> }>(
      `select event_key, vars from email_log where request_id = $1 and template = 'E8'`,
      [id],
    );
    const [audit] = await q<{ id: string }>(
      `select id from audit_log where request_id = $1 and action = 'pitch_smaller'`,
      [id],
    );
    expect(log!.event_key).toBe(audit!.id);
    expect(log!.vars.manageLink).toEqual({ link: 'manage', requestId: id, anchor: 'another' });
  });

  it('EML-05: after E8 the guest sends the shorter pitch from the manage page (a new pitch and a new when)', async () => {
    const { id } = await newRequest('pitch-me');
    expect(await replyToPitch(id, { reply: 'smaller', length: 'three days long' })).toEqual({ ok: true });
    // The manage page starts the pitch form from the guest's own pitch (only the token holder sees it).
    expect(await loadManageModel(await issueManageToken(pool(), id, NOW))).toMatchObject({
      kind: 'manage',
      canAskAnother: true,
      ownPitch: { idea: 'Three days on the Sunshine Coast', when: '' },
    });
    const { clientKey, hp, ...rest } = RerequestBody.parse({
      clientKey: randomUUID(),
      hp: '',
      windowText: 'A Saturday in May',
      pitchIdea: '  One night on the Sunshine Coast  ',
    });
    expect(hp).toBe(''); // the manage route's body shape, strict (a pitch is one of its choices now)
    expect(await rerequest(id, rest, NOW, { clientKey })).toEqual({ ok: true });
    const [r] = await q<{ status: string; pitch_idea: string; date_prefs: { window_text: string } }>(
      `select status, pitch_idea, date_prefs from request where id = $1`,
      [id],
    );
    expect(r).toMatchObject({
      status: 'requested',
      pitch_idea: 'One night on the Sunshine Coast',
      date_prefs: { window_text: 'A Saturday in May' },
    });
    // No pitch in the body keeps the stored one; a pitch on another dish is ignored.
    expect(await rerequest(id, { ...rest, pitchIdea: undefined }, NOW, { clientKey: randomUUID() })).toEqual({
      ok: true,
    });
    expect((await q<{ p: string }>(`select pitch_idea as p from request where id = $1`, [id]))[0]!.p).toBe(
      'One night on the Sunshine Coast',
    );
    const lunch = await newRequest('the-long-lunch', [await slotId('2027-06-17')]);
    expect(
      await rerequest(
        lunch.id,
        { slotIds: [await slotId('2027-06-18')], dates: [], overnight: false, pitchIdea: 'nope' },
        NOW,
        { clientKey: randomUUID() },
      ),
    ).toEqual({ ok: true });
    expect(
      (await q<{ p: string | null }>(`select pitch_idea as p from request where id = $1`, [lunch.id]))[0]!.p,
    ).toBeNull();
  });

  it('E9: the honest no, with the guest’s own menu link (a link spec, built at send time)', async () => {
    const { id, email } = await newRequest('pitch-me');
    await q(`update request set status = 'standby' where id = $1`, [id]);
    expect(await replyToPitch(id, { reply: 'no' })).toEqual({ ok: true });
    expect((await row(id)).status).toBe('needs_new_time');
    const mail = (await lastMail(email))!;
    expect(mail.text_body).toMatch(/^I can’t make this one happen/);
    expect(mail.text_body).toContain(`${invite.link}\n`);
    const [log] = await q<{ vars: Record<string, unknown> }>(
      `select vars from email_log where request_id = $1 and template = 'E9'`,
      [id],
    );
    expect(log!.vars).toEqual({ menuLink: { link: 'menu', requestId: id } });
  });

  it('refuses a dish that is not a pitch, a locked or cancelled request; the route validates the body', async () => {
    const other = await newRequest();
    expect(await replyToPitch(other.id, { reply: 'no' })).toMatchObject({
      status: 409,
      reason: 'not_a_pitch',
    });
    const { id } = await newRequest('pitch-me');
    await q(`update request set status = 'cancelled' where id = $1`, [id]);
    expect(await replyToPitch(id, { reply: 'no' })).toMatchObject({ status: 409, reason: 'not_allowed' });
    expect(await replyToPitch(randomUUID(), { reply: 'no' })).toMatchObject({ status: 404 });
    const p = await newRequest('pitch-me');
    const bad = await pitchRoute(post(`/api/admin/requests/${p.id}/pitch`, { reply: 'smaller' }), ctx(p.id));
    expect(bad.status).toBe(400);
    const ok = await pitchRoute(
      post(`/api/admin/requests/${p.id}/pitch`, { reply: 'smaller', length: 'a week long' }),
      ctx(p.id),
    );
    expect(ok.status).toBe(200);
    expect((await row(p.id)).status).toBe('needs_new_time');
  });
  it('pr51-review M1/M2/L2: a double tap sends one email; live offers go; a joined pitch is refused', async () => {
    const { id, email } = await newRequest('pitch-me');
    const e9 = async () =>
      (await q(`select 1 from email_log where request_id = $1 and template = 'E9'`, [id])).length;
    // A pitch is a dates dish: Jon offers it a time, never a lunch or evening slot (CR-05).
    const time = {
      startsAt: vancouverInstant('2027-06-12', '10:00'),
      endsAt: vancouverInstant('2027-06-12', '13:00'),
      where: null,
    };
    expect((await suggestTimes(id, { ranges: [time] }, '', NOW)).ok).toBe(true);
    const token = /\/offer\?t=([A-Za-z0-9_-]{43})/.exec((await lastMail(email))!.text_body)![1]!;
    expect((await replyToPitch(id, { reply: 'no' })).ok).toBe(true);
    expect(await replyToPitch(id, { reply: 'no' })).toMatchObject({ status: 409, reason: 'already_replied' });
    expect(await e9()).toBe(1);
    // The E5 link can no longer lock the declined pitch.
    expect(await q(`select 1 from offer where request_id = $1 and released_at is null`, [id])).toHaveLength(
      0,
    );
    expect(await takeOffer({ token, rangeIndex: 0 }, false, NOW)).toBe('done');
    expect((await row(id)).status).toBe('needs_new_time');
    // A different reply is a new answer: E8 goes out.
    expect((await replyToPitch(id, { reply: 'smaller', length: 'three days long' })).ok).toBe(true);
    const joined = await newRequest('pitch-me');
    await q(`update request set joined_to_request_id = $2 where id = $1`, [joined.id, id]);
    expect(await replyToPitch(joined.id, { reply: 'no' })).toMatchObject({
      status: 409,
      reason: 'not_allowed',
    });
  });

  it('pr51-review L1 + EML-04: with a revoked invite, E9 still goes, with no link (never the dead one)', async () => {
    const { id, email } = await newRequest('pitch-me');
    const [inv] = await q<{ id: string }>(
      `insert into invite (is_test, kind, token_secret, name_slug, revoked_at)
       values (true, 'personal', $1, 'revoked-pat', now()) returning id`,
      [
        Array.from(
          { length: 8 },
          () => '0123456789abcdefghjkmnpqrstvwxyz'[Math.floor(Math.random() * 32)],
        ).join(''),
      ],
    );
    await q(`update request set invite_id = $2 where id = $1`, [id, inv!.id]);
    expect(await resolveLinkVars(randomUUID(), { menuLink: menuLink(id) })).toEqual({ menuLink: '' });
    // A request that doesn't exist is still an unknown link (fails closed).
    await expect(resolveLinkVars(randomUUID(), { menuLink: menuLink(randomUUID()) })).rejects.toBeInstanceOf(
      UnknownLinkKindError,
    );
    // Jon's honest no reaches the guest: the row is sent, the text ends with the sign-off, no link and no button.
    expect(await replyToPitch(id, { reply: 'no' })).toEqual({ ok: true });
    const [log] = await q<{ status: string }>(
      `select status from email_log where request_id = $1 and template = 'E9'`,
      [id],
    );
    expect(log!.status).toBe('sent');
    const [mail] = await q<{ text_body: string; html_body: string | null }>(
      `select text_body, html_body from dev_outbox where to_email = $1 order by created_at desc limit 1`,
      [email],
    );
    expect(mail!.text_body).toBe(
      'I can’t make this one happen, and I’d rather say so than leave it hanging. Pick anything else and it’s yours.\n\nJon\n',
    );
    expect(mail!.text_body).not.toContain('revoked-pat');
    expect(mail!.html_body).not.toContain('<a ');
  });
});

describe('T2.4.06 Weather call → delete the event + E10', () => {
  it('AC5: the weather call removes the event (mock), frees the window and sends E10 with a pick link', async () => {
    const remove = vi.spyOn(mockCalendar, 'remove');
    const { id, email, slot } = await lockedRequest('2027-04-02');
    const eventId = (await row(id)).google_event_id;
    expect(eventId).toMatch(/^mock-/);
    await q(`insert into offer (request_id, kind, slot_ids) values ($1, 'suggested_times', '{}')`, [id]);
    // A locked booking can be waiting on Jon (e.g. the guest said no in Google, T3.15): his call answers it.
    await q(`update request set awaiting_jon_since = $2 where id = $1`, [id, NOW]);

    const res = await weatherCall(id, NOW);
    expect(res.ok).toBe(true);
    const offerId = (res as { offerId: string }).offerId;
    expect(remove).toHaveBeenCalledWith(eventId);
    expect(await row(id)).toMatchObject({
      status: 'needs_new_time',
      awaiting_jon_since: null,
      locked_starts_at: null,
      google_event_id: null,
      calendar_state: 'none',
    });
    // Only the weather_call offer is live; the older one was released.
    expect(
      await q<{ kind: string }>(`select kind from offer where request_id = $1 and released_at is null`, [id]),
    ).toEqual([{ kind: 'weather_call' }]);
    const mail = (await lastMail(email))!;
    expect(mail.subject).toBe('Weather call');
    const raw = /\/new-date\?t=([A-Za-z0-9_-]{43})/.exec(mail.text_body)![1]!;
    expect(await findToken(raw)).toMatchObject({
      purpose: 'pick_new_date',
      offer_id: offerId,
      request_id: id,
    });
    expect(await loadNewDateModel(raw, NOW)).toMatchObject({ kind: 'new_date', offerId });
    // The window is free again: another guest can be locked into it.
    const next = await newRequest('the-long-lunch', [slot]);
    expect(
      (await lockRequest({ requestId: next.id, target: { slotId: slot }, mode: 'lock', now: NOW })).ok,
    ).toBe(true);
    const [audit] = await q<{ actor: string; detail: Record<string, unknown> }>(
      `select actor, detail from audit_log where request_id = $1 and action = 'weather_call'`,
      [id],
    );
    expect(audit).toEqual({
      actor: 'jon',
      detail: { from_status: 'locked', to_status: 'needs_new_time', offer_id: offerId },
    });
  });

  it('pr51-review H1/H2: joined guests follow rule 3: the same E10, each with an own pick link; they keep the range', async () => {
    const host = await lockedRequest('2027-04-09');
    const [before] = await q<{ s: Date; e: Date }>(
      `select locked_starts_at as s, locked_ends_at as e from request where id = $1`,
      [host.id],
    );
    const guests = [await newRequest(), await newRequest()];
    for (const g of guests) {
      await q(
        `update request set status = 'locked', joined_to_request_id = $2, counts_toward = 'none',
                locked_starts_at = null, locked_ends_at = null, locked_slot_id = null where id = $1`,
        [g.id, host.id],
      );
    }
    expect(await weatherCall(guests[0]!.id, NOW)).toMatchObject({ status: 409, reason: 'not_allowed' });
    // Manage links from the locked booking's emails: they last to its end + 7 days.
    const links = await withTx(async (c) =>
      Promise.all([host.id, ...guests.map((g) => g.id)].map((id) => issueManageToken(c, id, NOW))),
    );
    expect((await findToken(links[0]!))!.expires_at).toEqual(manageExpiry(before!.e, NOW));
    expect((await weatherCall(host.id, NOW)).ok).toBe(true);
    // Back to waiting on a new time: every live manage link (host and joined guests) lasts the unlocked lifetime,
    // not the old end + 7 days (as Ask for another time does).
    for (const raw of links) expect((await findToken(raw))!.expires_at).toEqual(manageExpiry(null, NOW));
    const tokens: string[] = [];
    for (const g of guests) {
      const [j] = await q<{
        status: string;
        awaiting: Date | null;
        s: Date | null;
        e: Date | null;
        host: string;
      }>(
        `select status, awaiting_jon_since as awaiting, locked_starts_at as s, locked_ends_at as e,
                joined_to_request_id as host from request where id = $1`,
        [g.id],
      );
      expect(j).toMatchObject({ status: 'needs_new_time', s: before!.s, e: before!.e, host: host.id }); // H2
      expect(j!.awaiting).not.toBeNull();
      const mail = (await lastMail(g.email))!;
      expect(mail.subject).toBe('Weather call'); // E10, not E5j
      const token = /\/new-date\?t=([A-Za-z0-9_-]{43})/.exec(mail.text_body)![1]!;
      const t = (await findToken(token))!;
      expect(t).toMatchObject({ purpose: 'pick_new_date', request_id: g.id });
      tokens.push(token);
      expect(
        await q(`select 1 from audit_log where request_id = $1 and action = 'weather_call'`, [g.id]),
      ).toHaveLength(1);
    }
    expect(new Set(tokens).size).toBe(2);
    expect((await row(host.id)).locked_starts_at).toBeNull(); // the host's own range is cleared afterwards
  });

  it('T3.4.05: a guest who has the .ics gets the .ics CANCEL, with the time it had and the next SEQUENCE', async () => {
    const { id } = await lockedRequest('2027-04-30');
    await q(`update request set calendar_state = 'ics_sent' where id = $1`, [id]);
    await withTx((c) => queueIcsEmail(c, id, 'REQUEST')); // the .ics the guest already has (pr51-verify N1)
    expect((await weatherCall(id, NOW)).ok).toBe(true);
    const e4c = await q<{ event_key: string; method: string; sequence: string; lead: string }>(
      `select event_key, vars->>'method' as method, vars->>'sequence' as sequence, vars->>'lead' as lead
         from email_log where request_id = $1 and template = 'E4c' order by created_at`,
      [id],
    );
    expect(e4c.map((m) => [m.event_key, m.method, m.sequence])).toEqual([
      ['ics:0', 'REQUEST', '0'],
      ['ics:1', 'CANCEL', '1'], // bumped: a CANCEL at the REQUEST's own SEQUENCE would be ignored
    ]);
    expect(e4c[1]!.lead).toMatch(/^The Long Lunch, Fri Apr 30 · noon–2 pm Vancouver time, is off\./);
    expect(await q(`select ics_sequence from request where id = $1`, [id])).toEqual([{ ics_sequence: 1 }]);
    expect((await row(id)).locked_starts_at).toBeNull();
  });

  it('pr51-review M3: only a Big Day gets a Weather call (409 not_a_big_day; nothing changes)', async () => {
    const small = await lockedRequest('2027-04-23', false);
    expect(await weatherCall(small.id, NOW)).toMatchObject({ status: 409, reason: 'not_a_big_day' });
    expect((await row(small.id)).status).toBe('locked');
    expect(await q(`select 1 from offer where request_id = $1`, [small.id])).toHaveLength(0);
  });

  it('refuses a request that is not locked, a booking that has ended, and an unknown id; the route is strict', async () => {
    const open = await newRequest();
    expect(await weatherCall(open.id, NOW)).toMatchObject({ status: 409, reason: 'not_allowed' });
    const ended = await lockedRequest('2027-04-16');
    expect(await weatherCall(ended.id, new Date('2027-04-17T00:00:00Z'))).toMatchObject({
      reason: 'not_allowed',
    });
    expect(await weatherCall(randomUUID(), NOW)).toMatchObject({ status: 404 });
    expect(
      (await weatherRoute(post(`/api/admin/requests/${ended.id}/weather`, { x: 1 }), ctx(ended.id))).status,
    ).toBe(400);
    const ok = await weatherRoute(post(`/api/admin/requests/${ended.id}/weather`, {}), ctx(ended.id));
    expect(ok.status).toBe(200);
    expect((await ok.json()) as { offerId: string }).toMatchObject({ ok: true, offerId: expect.any(String) });
  });
});
