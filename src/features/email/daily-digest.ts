// src/features/email/daily-digest.ts — T3.9.05 (TSD §6.4 E13): the 18:00 PT story digest to Jon. Counts and the
// first line of each story saved IN THE APP between the last digest's 18:00 PT (yesterday's, or up to a week back
// if evenings were missed: pr42 F5) and today's (emailed stories go straight
// to Jon's Gmail and are never seen here), spam suspects left out. Never a plan, a note or a phone number.
// Nothing new: no email.
// event_key = the Vancouver date, so any number of ticks after 18:00 send it once.
import 'server-only';
import { getEnv } from '@/config/env';
import { dishBySlug } from '@/content/menu-helpers';
import { STORY_HAS_CONTENT } from '@/features/photos/story-content';
import { pool, q } from '@/lib/db';
import { addDays, vancouverDate, vancouverInstant } from '@/lib/time';
import { deliverEmail, jonEmail, queueEmail, type SendResult } from './send';

export const DAILY_DIGEST_AT = '18:00';
const FIRST_LINE_MAX = 120;

export function firstLine(body: string | null): string {
  const line = (body ?? '').trim().split(/\r?\n/, 1)[0]!.trim();
  return line.length > FIRST_LINE_MAX ? `${line.slice(0, FIRST_LINE_MAX - 1)}…` : line;
}

/** A missed evening isn't lost (pr42 F5): the window starts where the last daily digest's ended, within a week. */
export const CATCH_UP_DAYS = 7;
async function digestSince(day: string): Promise<Date> {
  const [last] = await q<{ key: string | null }>(
    `select max(event_key) as key from email_log
      where template = 'E13' and event_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and event_key < $1 and event_key >= $2`,
    [day, addDays(day, -CATCH_UP_DAYS)],
  );
  return vancouverInstant(last?.key ?? addDays(day, -1), DAILY_DIGEST_AT);
}

export async function sendDailyDigest(now: Date): Promise<SendResult | 'not_yet' | 'nothing_new'> {
  const day = vancouverDate(now);
  const until = vancouverInstant(day, DAILY_DIGEST_AT);
  if (now < until) return 'not_yet';
  const since = await digestSince(day);
  const stories = await q<{ name: string | null; dish: string | null; body: string | null; photos: number }>(
    `select coalesce(s.from_name, r.contact_name) as name, r.dish, s.body,
            (select count(*)::int from photo p where p.story_id = s.id) as photos
       from story s left join request r on r.id = s.request_id
      where s.created_at >= $1 and s.created_at < $2 and not s.spam_suspect and ${STORY_HAS_CONTENT}
      order by s.created_at`,
    [since, until],
  );
  if (stories.length === 0) return 'nothing_new';
  const photos = stories.reduce((n, s) => n + s.photos, 0);
  const lines = stories.map((s) => {
    const who = [s.name, s.dish ? (dishBySlug(s.dish)?.name ?? s.dish) : null].filter(Boolean).join(', ');
    return `- ${who || 'A story'}: ${firstLine(s.body)}`;
  });
  if (photos > 0) lines.push(`- Photos: ${photos}`);
  const queued = await queueEmail(pool(), {
    template: 'E13',
    to: jonEmail(),
    requestId: null,
    eventKey: day,
    vars: {
      count: stories.length,
      lines: lines.join('\n'),
      adminLink: `${getEnv().NEXT_PUBLIC_SITE_URL}/admin/stories`,
    },
  });
  return typeof queued === 'string' ? queued : deliverEmail(queued.queued, { inline: true, now });
}
