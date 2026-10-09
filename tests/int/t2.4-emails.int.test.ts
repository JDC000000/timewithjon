// T2.4.10 (lane L1): E5, E6, E7, E8, E9, E10 and E16 are wired. Each one is sent by its REAL sender (the service
// Jon's or the guest's action calls) and the delivered subject and body are pinned word for word against the
// copy (creative v1.4 §6.5, TSD §14.4): every placeholder filled, the link where the copy puts its button, the
// sign-off "Jon" on guest emails only. The single-use tokens are masked (their minting is tested in offers.int).
// COPY PINS (pr66-review F1): the lines noted below were approved with the copy list (decision 31). To change
// the wording, change src/content/emails.ts AND these expectations together: this test pins the approved copy.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createRequestTx } from '@/features/requests/create';
import { lockRequest } from '@/features/requests/lock';
import { replyToPitch, weatherCall } from '@/features/requests/pitch-weather';
import { proposeTimes } from '@/features/requests/propose';
import { RequestBody } from '@/features/requests/schema';
import { moveToStandby, offerStandbyWindow } from '@/features/requests/standby';
import { suggestTimes } from '@/features/requests/suggest';
import { stillOpen } from '@/features/requests/take-offer';
import { issueToken } from '@/features/invites/action-tokens';
import { pool, q, withTx } from '@/lib/db';
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
  invite = { id: i!.id, link: `${SITE}/?for=${i!.name_slug}-${i!.token_secret}` };
});
afterAll(async () => {
  vi.useRealTimers();
  await restoreBudget();
  await removeRequests(made); // gone for good: re-runs on one DB stay under admin-inbox's capped Cancelled tab
  await pool().end();
});

/** Lunch slots nothing locked or finished overlaps (other files' bookings stay on a re-run of the same DB). */
async function freeLunches(n: number): Promise<{ id: string; starts_at: Date }[]> {
  return q<{ id: string; starts_at: Date }>(
    `select s.id, s.starts_at from slot s
      where s.window_kind = 'lunch' and s.date >= '2027-04-01'
        and not exists (select 1 from request r where r.status in ('locked', 'done')
                          and tstzrange(r.locked_starts_at, r.locked_ends_at) && tstzrange(s.starts_at, s.ends_at))
        and not exists (select 1 from offer o where o.kind = 'standby_open' and s.id = any(o.slot_ids)
                          and o.released_at is null and o.taken_at is null)
      order by s.starts_at desc limit $1`,
    [n],
  );
}

async function newRequest(o: { dish?: string; slotIds?: string[] } = {}) {
  const dish = o.dish ?? 'the-long-lunch';
  const pitch = dish === 'pitch-me';
  const name = `Robin ${randomUUID().slice(0, 6)}`;
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish,
    name,
    email: `robin+${randomUUID().slice(0, 8)}@example.com`,
    crew: 2,
    slotIds: o.slotIds ?? [],
    dates: pitch ? ['2027-05-29'] : [],
    pitchIdea: pitch ? 'Three days on the Sunshine Coast' : undefined,
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId: invite.id,
      isTest: true,
      spam: true, // no intake emails: only the ones this file checks
      mode: pitch ? 'dates' : 'slots',
      status: 'requested',
      countsToward: pitch ? 'none' : 'weekly_cap',
      dishName: dish,
    }),
  );
  await q(`update request set spam_suspect = false where id = $1`, [requestId]);
  made.push(requestId);
  return { id: requestId, email: body.email, name };
}

/** The delivered mail, its single-use tokens masked. */
async function mail(to: string, template: string) {
  const [m] = await q<{ subject: string; text_body: string }>(
    `select subject, text_body from dev_outbox where to_email = $1 and template = $2 order by created_at desc limit 1`,
    [to, template],
  );
  expect(m, `${template} to ${to}`).toBeDefined();
  return { subject: m!.subject, text: m!.text_body.replace(/\?t=[A-Za-z0-9_-]{43}/g, '?t=TOKEN') };
}

describe('T2.4.10 E5-E10 and E16: the copy, sent by the real senders', () => {
  it("E5 Suggest another time: Jon's line, the times, one take link, Jon", async () => {
    const slot = (
      await q<{ id: string }>(`select id from slot where date = '2027-05-14' and window_kind = 'lunch'`)
    )[0]!;
    const r = await newRequest();
    expect(
      (await suggestTimes(r.id, { slotIds: [slot.id] }, 'Thursday went before I could grab it.', NOW)).ok,
    ).toBe(true);
    // Approved copy (decision 31): the times layout (one per line) and the link line under them; the rest is creative v1.4 §6.5.
    expect(await mail(r.email, 'E5')).toEqual({
      subject: 'Another time for The Long Lunch?',
      text:
        'Thursday went before I could grab it. This one’s still open:\nFri May 14 · noon–2 pm Vancouver time\nTap one and it’s yours.\n' + // Q6: one time
        `${SITE}/offer?t=TOKEN\n\nJon\n`,
    });
  });

  it('E6 Move to stand-by: the week', async () => {
    const r = await newRequest();
    expect((await moveToStandby(r.id, '2027-05-12', NOW)).ok).toBe(true);
    expect(await mail(r.email, 'E6')).toEqual({
      subject: 'You’re on stand-by',
      text: 'You’re on stand-by for the week of May 10. If something opens up, I’ll email you.\n\nJon\n',
    });
  });

  it('E7 a freed window: the real weekday, the time, one take link', async () => {
    const [slot] = await q<{ id: string; starts_at: Date }>(
      `select id, starts_at from slot where date = '2027-04-02' and window_kind = 'lunch'`,
    );
    const r = await newRequest();
    await q(`update request set status = 'standby', standby_week = '2027-03-29' where id = $1`, [r.id]);
    expect(
      await stillOpen(
        r.id,
        [{ slotId: slot!.id, startsAt: slot!.starts_at, endsAt: slot!.starts_at }],
        'standby_open',
        NOW,
      ),
    ).toHaveLength(1); // the fixed window must be free (a clear failure if another file's data ever takes it)
    expect((await offerStandbyWindow(r.id, { slotId: slot!.id }, false, NOW)).ok).toBe(true);
    // Approved copy (decision 31): "{when} is free now" (creative v1.4 has "Thursday the 13th at noon") and the link line.
    expect(await mail(r.email, 'E7')).toEqual({
      subject: 'Friday just opened up',
      text: `Fri Apr 2 · noon–2 pm Vancouver time is free now. Want it? It’s yours until Wed Mar 17 · 11 am Vancouver time.\n${SITE}/offer?t=TOKEN\n\nJon\n`, // Q4
    });
  });

  it("E8 the smaller version (in Jon's words) and E9 the honest no (the guest's own menu link)", async () => {
    const small = await newRequest({ dish: 'pitch-me' });
    expect((await replyToPitch(small.id, { reply: 'smaller', length: 'three days long' })).ok).toBe(true);
    // Approved copy (decision 31): the manage link line.
    expect(await mail(small.email, 'E8')).toEqual({
      subject: 'About your pitch',
      text:
        'I love this. It’s also three days long, and I promised one night away, max. Pitch me the shorter version?\n' +
        `${SITE}/manage?t=TOKEN#another\n\nJon\n`, // EML-05: the link opens the pitch form
    });
    const no = await newRequest({ dish: 'pitch-me' });
    expect((await replyToPitch(no.id, { reply: 'no' })).ok).toBe(true);
    // Approved copy (decision 31): the menu (invite) link line.
    expect(await mail(no.email, 'E9')).toEqual({
      subject: 'About your pitch',
      text:
        'I can’t make this one happen, and I’d rather say so than leave it hanging. Pick anything else and it’s yours.\n' +
        `${invite.link}\n\nJon\n`,
    });
  });

  it('E10 Weather call: the pick-a-new-date link', async () => {
    const [slot] = await freeLunches(1);
    const r = await newRequest({ slotIds: [slot!.id] });
    expect(
      (await lockRequest({ requestId: r.id, target: { slotId: slot!.id }, mode: 'lock', now: NOW })).ok,
    ).toBe(true);
    await q(`update request set counts_toward = 'big_day' where id = $1`, [r.id]);
    expect((await weatherCall(r.id, NOW)).ok).toBe(true);
    // Approved copy (decision 31): the pick-a-new-date link line.
    expect(await mail(r.email, 'E10')).toEqual({
      subject: 'Weather call',
      text: `It’s pouring. Let’s move it.\n${SITE}/new-date?t=TOKEN\n\nJon\n`,
    });
  });

  it('E16 to Jon: the guest picked new times (no sign-off on a Jon-facing email)', async () => {
    const [offer, next] = await freeLunches(2);
    const r = await newRequest();
    const res = await suggestTimes(r.id, { slotIds: [offer!.id] }, '', NOW);
    const offerId = (res as { offerId: string }).offerId;
    const token = await withTx((c) =>
      issueToken(c, {
        purpose: 'take_offer',
        requestId: r.id,
        offerId,
        expiresAt: new Date(NOW.getTime() + 864e5),
      }),
    );
    const out = await proposeTimes({
      token,
      slotIds: [next!.id],
      dates: [],
      overnight: false,
      clientKey: randomUUID(),
    });
    expect(out).toEqual({ ok: true });
    const [m] = await q<{ subject: string; text_body: string }>(
      `select subject, text_body from dev_outbox where template = 'E16' and text_body like $1`,
      [`${r.name} %`],
    );
    expect(m).toEqual({
      subject: `Updated: The Long Lunch from ${r.name}`,
      text_body: `${r.name} picked a new time for The Long Lunch.\n${SITE}/admin/requests/${r.id}\n`, // Q6: one time
    });
  });
});
