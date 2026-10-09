// src/ui/PhotoTiles.tsx: a slideshow slot shown as a row of three square tiles (design round 6, P3 option B: the
// closing photos on screens 1024 px and up). Tile k shows photo k and crossfades to photo k + 3 (1<->4, 2<->5, 3<->6),
// all three on one timer, with ONE Pause/Play toggle for the row (src/ui/Slideshow.tsx: one SlideshowScope, `need`
// = the tiles that have a second photo). Each photo is framed by its own `close-tile` view (photo-views.json).
// A slot of fewer than 3 photos renders nothing (the caller keeps its single photo). site.css shows the row only
// from 1024 px and hides the slot's single figure there. Each tile's first photo is a <picture> source for
// TILES_MEDIA only (a blank pixel below it), and Closing gives the single figure BELOW_TILES_MEDIA, so neither layout
// downloads anything on the screens where it is hidden (display: none alone doesn't stop WebKit choosing a lazy
// image's file). Second photos join only once the row is on screen (Slideshow.tsx), so never while it is hidden.
import type { CSSProperties } from 'react';
import {
  PHOTO_SLOTS,
  PHOTO_VIEWS,
  photoSlides,
  photoSources,
  photoViewStyle,
  type PhotoSlots,
  type PhotoViews,
} from './photo-slots';
import { TILE_SIZES } from './photo-sizes';
import { BLANK_PIXEL, MediaImg } from './PhotoSlot';
import { SlideshowScope, SlideshowSlides, SlideshowToggle } from './Slideshow';

/** tiles in the row */
export const TILES = 3;
/** where the row shows (site.css); its photo 1s are fetched only there, the single photo only below it */
export const TILES_MEDIA = '(min-width: 1024px)';
export const BELOW_TILES_MEDIA = '(max-width: 1023px)';

export function PhotoTiles({
  slot,
  slots = PHOTO_SLOTS,
  views = PHOTO_VIEWS,
}: {
  slot: string;
  slots?: PhotoSlots;
  views?: PhotoViews;
}) {
  const first = photoSources(slot, slots);
  if (!first) return null;
  // photo i (0-based): photo 1 is the slot's own file, photos 2..n its slides
  const photos = [{ src: first.src, srcSet: first.srcSet }, ...photoSlides(slot, slots)];
  if (photos.length < TILES) return null;
  const pos = first.photo.pos;
  const at = (i: number) => ({ ...photos[i]!, style: photoViewStyle(slot, i, pos, views) });
  const tiles = Array.from({ length: TILES }, (_, k) => ({
    photo: at(k),
    partner: k + TILES < photos.length ? at(k + TILES) : null,
  }));
  const pairs = tiles.filter((t) => t.partner).length;
  const row = (
    <div className="ph-tiles" data-slot={slot}>
      {tiles.map(({ photo, partner }, k) => (
        <figure key={photo.src} className="ph ph--tile" data-tile={k + 1}>
          <MediaImg media={TILES_MEDIA} srcSet={photo.srcSet} sizes={TILE_SIZES}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={BLANK_PIXEL}
              alt={first.photo.alt}
              loading="lazy"
              decoding="async"
              style={photo.style as CSSProperties | undefined}
            />
          </MediaImg>
          {partner ? <SlideshowSlides slides={[partner]} sizes={TILE_SIZES} /> : null}
        </figure>
      ))}
      {pairs > 0 ? <SlideshowToggle /> : null}
    </div>
  );
  if (pairs === 0) return row;
  return (
    <SlideshowScope count={2} need={pairs}>
      {row}
    </SlideshowScope>
  );
}
