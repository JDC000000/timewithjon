// src/features/admin/spam.ts — T2.9.04: Jon's two answers in "Check these" (TSD T2.2 A2, T2.9 AC4, AD-9):
//   Not spam: the row joins the normal flow. A request moves to Needs a reply (awaiting_jon_since = now) and Jon
//             gets the E2 he never got (the E1 moment has passed, so the guest gets nothing new).
//   Delete:   only a spam-suspect row can be deleted (AC4); everything real stays.
// Stories have the same two answers, with no email. Server-only; every caller has passed requireAdmin().
import 'server-only';
import type { PoolClient } from 'pg';
import { getEnv } from '@/config/env';
import { dishInSentence } from '@/content/menu-helpers';
import { jonEmail, queueEmail } from '@/features/email/send';
import { intakeEmails } from '@/features/requests/intake-emails';
import { withTx } from '@/lib/db';

export type SpamResult = 'ok' | 'not_found' | 'not_spam';
export type DeleteRequestResult = SpamResult | 'not_deletable';

interface SpamRequestRow {
  spam_suspect: boolean;
  status: string;
  dish: string;
  mode: 'slots' | 'dates';
  contact_name: string;
  contact_email: string;
  crew_size: number;
  big_crew: boolean;
  standby_week: string | null;
  choices: number;
  calendar_state: string;
  has_dependants: boolean;
}

async function lockRequest(c: PoolClient, id: string): Promise<SpamRequestRow | undefined> {
  const { rows } = await c.query<SpamRequestRow>(
    `select r.spam_suspect, r.status::text, r.dish, r.mode, r.contact_name, r.contact_email::text, r.crew_size,
            r.big_crew, r.standby_week::text, r.calendar_state::text,
            (exists (select 1 from story s where s.request_id = r.id)
             or exists (select j.id from request j where j.joined_to_request_id = r.id)) as has_dependants,
            case when r.mode = 'slots'
                 then (select count(*)::int from request_slot_choice s where s.request_id = r.id)
                 else coalesce(jsonb_array_length(r.date_prefs -> 'dates'), 0) end as choices
       from request r where r.id = $1 for update`,
    [id],
  );
  return rows[0];
}

/** Not spam for a request. Only a request still waiting on Jon (requested, standby) gets the wait and E2. */
export async function markRequestNotSpam(id: string): Promise<SpamResult> {
  return withTx(async (c) => {
    const r = await lockRequest(c, id);
    if (!r) return 'not_found';
    if (!r.spam_suspect) return 'not_spam';
    const waiting = r.status === 'requested' || r.status === 'standby';
    await c.query(
      `update request set spam_suspect = false,
              awaiting_jon_since = case when $2 then coalesce(awaiting_jon_since, now()) else awaiting_jon_since end
        where id = $1`,
      [id, waiting],
    );
    const {
      rows: [audit],
    } = await c.query<{ id: string }>(
      `insert into audit_log (actor, action, request_id) values ('jon', 'request_not_spam', $1) returning id`,
      [id],
    );
    if (waiting) {
      const e2 = intakeEmails({
        requestId: id,
        auditId: audit!.id,
        status: r.status as 'requested' | 'standby',
        dishName: dishInSentence(r.dish),
        guestEmail: r.contact_email,
        guestName: r.contact_name,
        crew: r.crew_size,
        bigCrew: r.big_crew,
        choiceCount: r.choices,
        choiceKind: r.mode === 'slots' ? 'times' : 'dates',
        standbyWeek: r.standby_week,
        requestedTimes: [], // only E2 is sent here
        jonEmail: jonEmail(),
        siteUrl: getEnv().NEXT_PUBLIC_SITE_URL,
      }).find((e) => e.template === 'E2')!;
      await queueEmail(c, e2);
    }
    return 'ok';
  });
}

/**
 * Delete a spam-suspect request (its choices and offers go with it; audit and email rows keep a null request).
 * pr47 F1: only one that never went further than a request (requested or stand-by, nothing on a calendar) with no
 * story and nobody joined to it; anything else is `not_deletable` (a booking's event, a story's photos, a joined
 * guest's row would be orphaned or block the delete). Jon clears it with Not spam and handles it as a real one.
 * pr47 F4: the audit row names the deleted id in detail.request_id (migration 0304); its request_id column can't,
 * as the delete sets it null.
 */
export async function deleteSpamRequest(id: string): Promise<DeleteRequestResult> {
  return withTx(async (c) => {
    const r = await lockRequest(c, id);
    if (!r) return 'not_found';
    if (!r.spam_suspect) return 'not_spam';
    const onlyARequest = r.status === 'requested' || r.status === 'standby';
    if (!onlyARequest || r.calendar_state !== 'none' || r.has_dependants) return 'not_deletable';
    await c.query(
      `insert into audit_log (actor, action, detail) values ('jon', 'spam_request_deleted', $1)`,
      [JSON.stringify({ request_id: id })],
    );
    await c.query(`delete from request where id = $1 and spam_suspect`, [id]);
    return 'ok';
  });
}

export type StorySpamResult = SpamResult | 'has_photos';

async function lockStory(c: PoolClient, id: string) {
  const { rows } = await c.query<{ spam_suspect: boolean; request_id: string | null; photos: number }>(
    `select s.spam_suspect, s.request_id,
            (select count(*)::int from photo p where p.story_id = s.id)
            + (select count(*)::int from photo_upload u
                where u.story_id = s.id and u.finalised_at is null and u.expires_at > now()) as photos
       from story s where s.id = $1 for update`,
    [id],
  );
  return rows[0];
}

/** Not spam for a story: it joins the list and the counts; its consent stays as the guest gave it. */
export async function markStoryNotSpam(id: string): Promise<SpamResult> {
  return withTx(async (c) => {
    const s = await lockStory(c, id);
    if (!s) return 'not_found';
    if (!s.spam_suspect) return 'not_spam';
    await c.query(`update story set spam_suspect = false where id = $1`, [id]);
    await c.query(
      `insert into audit_log (actor, action, request_id, detail) values ('jon', 'story_not_spam', $1, $2)`,
      [s.request_id, JSON.stringify({ story_id: id })],
    );
    return 'ok';
  });
}

/**
 * Delete a spam-suspect story. One with finalised photos is refused (`has_photos`): deleting the rows would
 * orphan the files in the photos bucket and R2 until a storage delete exists (T3.6, lane L6). pr47 F2: so is one
 * with an upload still in flight (unfinalised, unexpired), which would finalise into a story that's gone.
 */
export async function deleteSpamStory(id: string): Promise<StorySpamResult> {
  return withTx(async (c) => {
    const s = await lockStory(c, id);
    if (!s) return 'not_found';
    if (!s.spam_suspect) return 'not_spam';
    if (s.photos > 0) return 'has_photos';
    await c.query(
      `insert into audit_log (actor, action, request_id, detail) values ('jon', 'spam_story_deleted', $1, $2)`,
      [s.request_id, JSON.stringify({ story_id: id })],
    );
    await c.query(`delete from story where id = $1 and spam_suspect`, [id]);
    return 'ok';
  });
}
