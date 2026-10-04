// src/app/story/page.tsx — T3.12.U1 S19: send a story without a booking (F27). Reached only with a valid invite
// (T3.12 AC2): getInviteSession() 'valid' renders the S11 story form posting to /api/story-page (T3.12.01), which
// saves with source 'story_page' (AC1); 'none' or 'stale' shows the S16 stale page, never the form.
// Photos go to /api/photos/sign?for=story_page (invite + twj_story). S19 has no photo slot of its own.
// The first save creates the story; for the general invite it carries a Turnstile token (AD-9, as /api/requests).
// The general invite's form also asks for the guest's name (QA r2 M4); a personal invite already names them.
import type { Metadata } from 'next';
import { getEnv } from '@/config/env';
import { SEND_A_STORY } from '@/content';
import { SENT_UI } from '@/content/ui/guest-after';
import { getInviteSession } from '@/features/invites/session';
import { MAX_PHOTOS } from '@/features/photos/limits';
import { loadSettings } from '@/lib/settings';
import { ROUTES, SiteFooter, SiteHeader } from '@/ui';
import { NARROW } from '../_guest/layout';
import { StaleState } from '../_guest/stale';
import { StoryForm } from '../_guest/story-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'A story · Time with Jon' };

/** Module-level so the form's uploader (memoised on it) is stable across renders. */
const STORY_PAGE_TARGET = { query: '?for=story_page' };

export default async function StoryPage() {
  const session = await getInviteSession();
  const valid = session.state === 'valid';
  return (
    <>
      <SiteHeader back={{ href: ROUTES.home, label: SENT_UI.backHome }} />
      {valid ? (
        <Story
          before60={(await loadSettings()).before60_enabled}
          general={session.invite.kind === 'general'}
        />
      ) : (
        <StaleState />
      )}
      <SiteFooter photos={[]} />
    </>
  );
}

function Story({ before60, general }: { before60: boolean; general: boolean }) {
  const siteKey = general ? getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY : undefined;
  return (
    <main id="main">
      <div className="wrap" style={NARROW}>
        <div className="flow-top">
          <h1 className="display">{SEND_A_STORY.title}</h1>
        </div>
        <StoryForm
          endpoint="/api/story-page"
          target={STORY_PAGE_TARGET}
          maxPhotos={MAX_PHOTOS.story_page}
          before60={before60}
          skipHref={ROUTES.home}
          storyPage={general ? { siteKey, askName: true } : {}}
        />
      </div>
    </main>
  );
}
