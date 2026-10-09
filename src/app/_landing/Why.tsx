// src/app/_landing/Why.tsx — the landing's story block (Jon, 2026-10-05): the why band photo, then ONE block in the
// body face: the why lines and the story invite as one paragraph, the stories@ address (a mailto link) and its copy
// button inline in parentheses, then Jon's sign-off. It replaces the S3 why line, the #story block and the S14
// closing line; the closing photo stays, with no words on it (v2.2: no words on a photo).
import { STORY_BLOCK } from '@/content';
import { LANDING_LABELS, STORIES_DOMAIN } from '@/content/ui/landing';
import { PhotoSlot } from '@/ui';
import { slideCount } from '@/ui/photo-slots';
import { BELOW_TILES_MEDIA, PhotoTiles, TILES } from '@/ui/PhotoTiles';
import { CopyAddress } from './CopyAddress';

export function Why() {
  return (
    <section className="why" aria-label={LANDING_LABELS.why}>
      <PhotoSlot slot="why" kind="band" />
    </section>
  );
}

/** The header's "Send a story" jumps here (#story). stories@ forwards to Jon's Gmail; no auto-reply is promised. */
export function StoryBlock() {
  const address = `stories@${STORIES_DOMAIN}`;
  return (
    <section className="section story-block" id="story">
      <div className="wrap">
        <p className="body measure">{STORY_BLOCK.why}</p>
        <p className="body measure">
          {STORY_BLOCK.lead} <a href={`mailto:${address}`}>{address}</a> (<CopyAddress address={address} />)
        </p>
        <p className="body measure">{STORY_BLOCK.signOff}</p>
      </div>
    </section>
  );
}

/** The closing photo, on its own (the closing line is gone: Jon, 2026-10-05). */
export function Closing() {
  const tiles = slideCount('close') >= TILES;
  return (
    <section className="closing" aria-label={LANDING_LABELS.closing}>
      {/* design round 6 (P3 B): from 1024 px, three tiles in the text column instead (site.css); each layout
          fetches its photo only where it shows */}
      <PhotoSlot slot="close" kind="close" media={tiles ? BELOW_TILES_MEDIA : undefined} />
      {tiles ? (
        <div className="wrap">
          <PhotoTiles slot="close" />
        </div>
      ) : null}
    </section>
  );
}
