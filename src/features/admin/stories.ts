// src/features/admin/stories.ts — T2.9.01: the A6 stories list and Jon's consent toggle (TSD T2.9, §6 `story`).
// Thumbnails come with T3.6; "Add emailed story" with T3.7. Explicit column lists only: the request's sealed plan
// is never selected (C4). Server-only; every caller has passed requireAdmin().
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import { STORY_HAS_CONTENT } from '@/features/photos/story-content';
import { q, withTx } from '@/lib/db';

const LIST_MAX = 500; // ~100 guests; a cap keeps a runaway story page from building a huge response

export interface StoryItem {
  id: string;
  source: 'after_send' | 'story_page' | 'email_in';
  fromName: string | null;
  fromEmail: string | null;
  body: string | null;
  consent: boolean;
  consentSource: 'tickbox' | 'email_reply' | 'jon' | null;
  /** The guest's consent is unclear (e.g. an emailed story): Jon should decide. Cleared by the toggle. */
  consentNeedsJon: boolean;
  /** A filled honeypot (T3.8.03): kept, listed last, left out of the counts; consent is refused until "Not spam". */
  spamSuspect: boolean;
  before60Answer: string | null;
  photoCount: number;
  createdAt: string;
  request: { id: string; dish: string; dishName: string | null; contactName: string } | null;
}

export async function listStories(): Promise<{ stories: StoryItem[]; truncated: boolean }> {
  const rows = await q<{
    id: string;
    source: StoryItem['source'];
    from_name: string | null;
    from_email: string | null;
    body: string | null;
    consent: boolean;
    consent_source: StoryItem['consentSource'];
    consent_needs_jon: boolean;
    spam_suspect: boolean;
    before60_answer: string | null;
    photos: number;
    created_at: Date;
    request_id: string | null;
    dish: string | null;
    contact_name: string | null;
  }>(
    `select s.id, s.source, s.from_name, s.from_email::text as from_email, s.body, s.consent, s.consent_source,
            s.consent_needs_jon, s.spam_suspect, s.before60_answer, s.created_at,
            (select count(*)::int from photo p where p.story_id = s.id) as photos,
            r.id as request_id, r.dish, r.contact_name
       from story s left join request r on r.id = s.request_id
      where ${STORY_HAS_CONTENT}
      order by s.spam_suspect, s.consent_needs_jon desc, s.created_at desc, s.id
      limit $1`,
    [LIST_MAX + 1],
  );
  return {
    truncated: rows.length > LIST_MAX,
    stories: rows.slice(0, LIST_MAX).map((s) => ({
      id: s.id,
      source: s.source,
      fromName: s.from_name,
      fromEmail: s.from_email,
      body: s.body,
      consent: s.consent,
      consentSource: s.consent_source,
      consentNeedsJon: s.consent_needs_jon,
      spamSuspect: s.spam_suspect,
      before60Answer: s.before60_answer,
      photoCount: s.photos,
      createdAt: s.created_at.toISOString(),
      request:
        s.request_id && s.dish && s.contact_name
          ? {
              id: s.request_id,
              dish: s.dish,
              dishName: dishBySlug(s.dish)?.name ?? null,
              contactName: s.contact_name,
            }
          : null,
    })),
  };
}

/**
 * Jon's decision either way is recorded as `consent_source='jon'` (AC1) and settles the "needs Jon" flag.
 * A spam-suspect story is refused (`spam`) until Jon marks it "Not spam" (T2.9.04): consent to a honeypot hit
 * would put it in the keepsake. The audit row names the story (detail.story_id) and its request, if any.
 */
export async function setStoryConsent(id: string, consent: boolean): Promise<'ok' | 'not_found' | 'spam'> {
  return withTx(async (c) => {
    const { rows } = await c.query<{ request_id: string | null; spam_suspect: boolean }>(
      `select request_id, spam_suspect from story where id = $1 for update`,
      [id],
    );
    const story = rows[0];
    if (!story) return 'not_found';
    if (story.spam_suspect) return 'spam';
    await c.query(
      `update story set consent = $2, consent_source = 'jon', consent_needs_jon = false where id = $1`,
      [id, consent],
    );
    await c.query(`insert into audit_log (actor, action, request_id, detail) values ('jon', $1, $2, $3)`, [
      consent ? 'story_consent_given' : 'story_consent_withdrawn',
      story.request_id,
      JSON.stringify({ story_id: id }),
    ]);
    return 'ok';
  });
}
