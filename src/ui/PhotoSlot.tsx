// src/ui/PhotoSlot.tsx (decision 35; G1 SIGNED, decisions 46-47): a photo position on a guest screen, in the v2.0
// slot API's markup (the design pack CONTRACT.md: <figure class="ph ph--{kind}" data-slot="{slot}"><img …>).
// The slot's file comes from photo-slots.ts; a slot with no photo yet stays the empty ratio box (hidden from AT).
// With a photo, the <img alt> speaks for itself (pr73 F8): no aria-hidden on the figure.
import type { ReactNode } from 'react';
import { preload } from 'react-dom';
import { cx } from './cx';
import { photoSources } from './photo-slots';

/** The v2.0 slot kinds (placement + ratio). */
export type PhotoKind = 'hero' | 'band' | 'dish' | 'sheet' | 'thumb' | 'sent' | 'wine' | 'close';

export type PhotoSlotProps = {
  /** the key in photo-slots.ts (the v2.0 slots.json, e.g. 'hero', 'why', 'long-lunch') */
  slot: string;
  kind: PhotoKind;
  /** overrides the slot's alt; '' = decorative (the words next to it say the same) */
  alt?: string;
  /** the <img sizes>; default: the full viewport width */
  sizes?: string;
  /**
   * 'hero' = THE page hero (one per page, first viewport): eager, fetchpriority high and preloaded.
   * 'eager' = in the first viewport but not the hero. Default: lazy (everything below the fold).
   */
  priority?: 'hero' | 'eager';
  className?: string;
};

export function PhotoSlot({ slot, kind, alt, sizes = '100vw', priority, className }: PhotoSlotProps) {
  const cls = cx('ph', `ph--${kind}`, className);
  const src = photoSources(slot);
  if (!src) return <figure className={cls} data-slot={slot} data-alt={alt ?? ''} aria-hidden="true" />;
  if (priority === 'hero')
    preload(src.src, { as: 'image', imageSrcSet: src.srcSet, imageSizes: sizes, fetchPriority: 'high' });
  return (
    <figure className={cls} data-slot={slot}>
      {/* the pack's plain <img srcset> (the files are pre-sized webp); next/image would re-encode them */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src.src}
        srcSet={src.srcSet}
        sizes={sizes}
        alt={alt ?? src.photo.alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority === 'hero' ? 'high' : undefined}
        decoding="async"
        style={src.photo.pos ? { objectPosition: src.photo.pos } : undefined}
      />
    </figure>
  );
}

/** Visually hidden text (.vh), still read by screen readers. */
export function Vh({ children }: { children: ReactNode }) {
  return <span className="vh">{children}</span>;
}
