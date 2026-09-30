// src/app/admin/(app)/stories/_a6/StoryDetail.tsx — T2.9.U1: the A6 detail (wireframe 09 A6): "After The Long Lunch",
// the name, the story in full, its photos (10-minute signed URLs, T3.6.07), the Before 60 answer and "OK for the
// book". A spam suspect can't be consented (the route answers 409): it gets A2b's Not spam / Delete instead. Server.
import type { ReactNode } from 'react';
import type { StoryItem } from '@/features/admin/stories';
import type { AdminPhoto } from '@/features/photos/thumbnails';
import { STORIES } from '@/content/ui/admin-season';
import { LandingHeading } from '@/app/admin/_season/Landing';
import { ConsentToggle } from './ConsentToggle';
import { SpamActions } from './SpamActions';
import { storyWho } from './model';
import { STORY_RETURN_KEY, storyPath } from './paths';

const THUMB = 96; // wireframe 09 A6 (96 x 96)

export function StoryDetail({
  story,
  photos,
  say,
  landOnConsent = false,
  back,
}: {
  story: StoryItem;
  photos: AdminPhoto[];
  say: string | null;
  /** just marked "Not spam": focus lands on "OK for the book" (FOC-04) */
  landOnConsent?: boolean;
  back: ReactNode;
}) {
  const who = storyWho(story);
  const dish = story.request?.dishName;
  return (
    <>
      {back}
      <div className="pane-pad" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s6)' }}>
        {dish ? <p className="cap muted">{STORIES.capAfter(dish)}</p> : null}
        <LandingHeading
          returnKey={STORY_RETURN_KEY}
          href={storyPath(story.id)}
          say={say}
          className="h1"
          style={{ marginTop: 'var(--s2)' }}
        >
          {who}
        </LandingHeading>
        {story.body ? (
          <p
            className="lead"
            style={{ marginTop: 'var(--s3)', maxWidth: 'var(--measure)', whiteSpace: 'pre-line' }}
          >
            {story.body}
          </p>
        ) : null}
        {photos.length > 0 ? (
          <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)', marginTop: 'var(--s4)' }}>
            {photos.map((p, i) => (
              <li key={p.id}>
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a 10-minute signed URL; next/image would cache it
                  <img
                    src={p.url}
                    alt={STORIES.photo(i + 1)}
                    width={THUMB}
                    height={THUMB}
                    style={{ objectFit: 'cover', borderRadius: 'var(--r-control)' }}
                  />
                ) : (
                  <span className="photo" style={{ width: THUMB, height: THUMB }}>
                    {STORIES.photoMissing(i + 1)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {story.before60Answer ? (
          <dl className="kv">
            <dt>{STORIES.before60}</dt>
            <dd>{story.before60Answer}</dd>
          </dl>
        ) : null}
        {story.spamSuspect ? (
          <>
            <p className="notice">{STORIES.spamNote}</p>
            <SpamActions key={story.id} storyId={story.id} />
          </>
        ) : (
          <ConsentToggle
            key={story.id}
            storyId={story.id}
            who={who}
            consent={story.consent}
            land={landOnConsent}
          />
        )}
      </div>
    </>
  );
}
