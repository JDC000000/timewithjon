// src/features/photos/story.ts — L7: the After-Send story a request's photos hang off, created on first use
// WITHOUT touching an existing story's text or consent (saveAfterSendStory would overwrite consent).
import 'server-only';
import { q } from '@/lib/db';

export async function ensureAfterSendStory(requestId: string): Promise<string | null> {
  const rows = await q<{ id: string }>(
    `with ins as (
       insert into story (source, request_id, guest_id, from_email, from_name)
       select 'after_send', r.id, r.guest_id, r.contact_email, r.contact_name from request r where r.id = $1
       on conflict (request_id) where source = 'after_send' do nothing
       returning id)
     select id from ins
     union all
     select id from story where request_id = $1 and source = 'after_send'
     limit 1`,
    [requestId],
  );
  return rows[0]?.id ?? null;
}

/** The After-Send story for a request, if one exists (finalise never creates one). */
export async function afterSendStoryId(requestId: string): Promise<string | null> {
  const rows = await q<{ id: string }>(
    `select id from story where request_id = $1 and source = 'after_send'`,
    [requestId],
  );
  return rows[0]?.id ?? null;
}
