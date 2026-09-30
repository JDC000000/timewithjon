// src/lib/stories/afterSend.ts — L7: one After-Send story per request, upserted on first save (or first photo sign).
import 'server-only';
import { countEvent } from '@/features/analytics/count';
import { q } from '@/lib/db';

export async function saveAfterSendStory(
  requestId: string,
  b: { body?: string; consent: boolean; before60Answer?: string; spam?: boolean },
): Promise<string> {
  const rows = await q<{ id: string; inserted: boolean }>(
    `insert into story (source, request_id, guest_id, from_email, from_name, body, consent, consent_source, before60_answer, spam_suspect)
     select 'after_send', r.id, r.guest_id, r.contact_email, r.contact_name, $2, $3, case when $3 then 'tickbox'::consent_source end, $4, $5
       from request r where r.id = $1
     on conflict (request_id) where source = 'after_send'
     do update set body = coalesce(excluded.body, story.body), consent = excluded.consent,
                   consent_source = excluded.consent_source, before60_answer = coalesce(excluded.before60_answer, story.before60_answer),
                   spam_suspect = story.spam_suspect or excluded.spam_suspect
     returning id, (xmax = 0) as inserted`,
    [requestId, b.body ?? null, b.consent, b.before60Answer ?? null, b.spam ?? false],
  );
  if (!rows[0]) throw new Error('request not found');
  // T3.11: the first save or photo, once per story; a honeypot hit is spam, not a story (pr42 F7).
  if (rows[0].inserted && !b.spam) await countEvent('story_added');
  return rows[0].id;
}
