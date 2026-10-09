// src/ui/PhotoSlot.tsx (decision 35; G1 SIGNED, decisions 46-47): a photo position on a guest screen, in the v2.0
// slot API's markup (the design pack CONTRACT.md: <figure class="ph ph--{kind}" data-slot="{slot}"><img …>).
// The slot's file comes from photo-slots.ts; a slot with no photo yet stays the empty ratio box (hidden from AT).
// With a photo, the <img alt> speaks for itself (pr73 F8): no aria-hidden on the figure.
// A slot with `slides` > 1 (private builds only) is a slideshow (./Slideshow.tsx): the same figure and first <img>,
// with photos 2..n and a Pause/Play toggle added in the browser after the page loads.
import type { CSSProperties, ReactNode } from 'react';
import { preload } from 'react-dom';
import { cx } from './cx';
import {
  PHOTO_SLOTS,
  PHOTO_VIEWS,
  photoSlides,
  photoSources,
  photoViewStyle,
  type PhotoSlots,
  type PhotoViews,
} from './photo-slots';
import { PHOTO_SIZES } from './photo-sizes';
import { SlideshowScope, SlideshowSlides, SlideshowToggle } from './Slideshow';

/** The v2.0 slot kinds (placement + ratio). */
export type PhotoKind = 'hero' | 'band' | 'dish' | 'sheet' | 'thumb' | 'sent' | 'wine' | 'close';

export type PhotoSlotProps = {
  /** the key in photo-slots.ts (the v2.0 slots.json, e.g. 'hero', 'why', 'long-lunch') */
  slot: string;
  kind: PhotoKind;
  /** overrides the slot's alt; '' = decorative (the words next to it say the same) */
  alt?: string;
  /** the <img sizes>; default: the kind's measured widths (photo-sizes.ts) */
  sizes?: string;
  /**
   * 'hero' = THE page hero (one per page, first viewport): eager, fetchpriority high and preloaded.
   * 'eager' = in the first viewport but not the hero. Default: lazy (everything below the fold).
   */
  priority?: 'hero' | 'eager';
  className?: string;
  /**
   * A slideshow's toggle: 'inside' the figure (default), or 'outside' when the photo sits inside a link (a button
   * can't nest in an <a>): the caller then wraps the link in <SlideshowScope> and places <SlideshowToggle> itself
   * (DishPhotoScope in src/app/_menu/Menu.tsx).
   */
  controls?: 'inside' | 'outside';
  /** the slot registry; default PHOTO_SLOTS (a fixture only in the test page src/app/dev/slides) */
  slots?: PhotoSlots;
  /** the per-source framing; default PHOTO_VIEWS (a fixture only in src/app/dev/slides) */
  views?: PhotoViews;
  /**
   * Only where this media query matches is photo 1 fetched (a <picture> source); elsewhere its <img> holds a blank
   * pixel. For a figure another layout replaces on some screens (the closing tiles from 1024 px: Closing), so the
   * hidden one costs no download in any browser (display: none alone doesn't stop WebKit's lazy image choice).
   */
  media?: string;
};

export function PhotoSlot({
  slot,
  kind,
  alt,
  sizes,
  priority,
  className,
  controls = 'inside',
  slots = PHOTO_SLOTS,
  views = PHOTO_VIEWS,
  media,
}: PhotoSlotProps) {
  const cls = cx('ph', `ph--${kind}`, className);
  sizes ??= PHOTO_SIZES[kind];
  const src = photoSources(slot, slots);
  if (!src) return <figure className={cls} data-slot={slot} data-alt={alt ?? ''} aria-hidden="true" />;
  if (priority === 'hero')
    preload(src.src, { as: 'image', imageSrcSet: src.srcSet, imageSizes: sizes, fetchPriority: 'high' });
  // each source gets its own framing (slides too: a slide never borrows photo 1's position)
  const slides = photoSlides(slot, slots).map((s, i) => ({
    ...s,
    style: photoViewStyle(slot, i + 1, src.photo.pos, views),
  }));
  const figure = (
    <figure className={cls} data-slot={slot} data-slides={slides.length > 0 ? slides.length + 1 : undefined}>
      {/* the pack's plain <img srcset> (the files are pre-sized webp); next/image would re-encode them */}
      <MediaImg media={media} srcSet={src.srcSet} sizes={sizes}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media ? BLANK_PIXEL : src.src}
          srcSet={media ? undefined : src.srcSet}
          sizes={media ? undefined : sizes}
          alt={alt ?? src.photo.alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority === 'hero' ? 'high' : undefined}
          decoding="async"
          style={photoViewStyle(slot, 0, src.photo.pos, views) as CSSProperties | undefined}
        />
      </MediaImg>
      {slides.length > 0 ? <SlideshowSlides slides={slides} sizes={sizes} /> : null}
      {slides.length > 0 && controls === 'inside' ? <SlideshowToggle /> : null}
    </figure>
  );
  if (slides.length === 0 || controls === 'outside') return figure;
  return <SlideshowScope count={slides.length + 1}>{figure}</SlideshowScope>;
}

/** A 1x1 transparent GIF: an <img> that shows (and fetches) nothing where its <picture> source doesn't apply. */
export const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** With `media`: the <img> inside a <picture> whose one source holds the real files for that media only. */
export function MediaImg({
  media,
  srcSet,
  sizes,
  children,
}: {
  media?: string;
  srcSet: string;
  sizes: string;
  children: ReactNode;
}) {
  if (!media) return children;
  return (
    <picture>
      <source media={media} srcSet={srcSet} sizes={sizes} />
      {children}
    </picture>
  );
}

/** Visually hidden text (.vh), still read by screen readers. */
export function Vh({ children }: { children: ReactNode }) {
  return <span className="vh">{children}</span>;
}
