// src/ui/photo-slots.ts (the v2.0 slot API's slots.json, the design pack CONTRACT.md): which file fills a
// <PhotoSlot slot=…>. Files live in public/img/{file}-{w}.webp, one per listed width. A slot missing here renders as
// the empty ratio box. Git holds only licensed stand-ins (docs/PHOTOS.md). Slots with no `credit` are Jon's own photos
// (decision 48): a private build fetches them over the stand-ins (scripts/fetch-real-photos.mjs); never an original.

export type PhotoCredit = { by: string; url: string; licence: string };

export type Photo = {
  /** public/img/{file}-{w}.webp */
  file: string;
  /** every width that exists on disk, ascending; the first is the fallback src */
  w: readonly number[];
  /** CSS object-position (the focal point) */
  pos?: string;
  /** how many photos the slot shows in turn (absent or 1 = a still photo). Written only by a private build
   *  (scripts/fetch-real-photos.mjs); photo n >= 2 is public/img/{file}-{n}-{w}.webp, at the same widths. */
  slides?: number;
  /** the default alt; '' = decorative (the words next to the photo say the same) */
  alt: string;
  /** a stand-in's licence record (kept as provenance; not shown since Jon's menu polish: the Unsplash License asks for
   *  no attribution); none = Jon's own */
  credit?: PhotoCredit;
};

export const PHOTO_DIR = '/img';

export const PHOTO_SLOTS: Readonly<Record<string, Photo>> = {
  hero: {
    file: 'hero',
    w: [480, 800, 1200, 1600],
    alt: '',
  },
  why: {
    file: 'why',
    w: [480, 800, 1200, 1600],
    alt: '',
  },
  close: {
    file: 'close',
    w: [480, 800, 1200, 1600],
    alt: '',
  },
  // S04 /menu (pack v2.2 s04 + s05 sheets): the 16 dish slots, in menu order; pos = the pack's inline object-position.
  'flat-white': {
    file: 'flat-white',
    w: [480, 800, 1200],
    alt: '',
  },
  'first-round': {
    file: 'first-round',
    w: [480, 800, 1200],
    alt: '',
  },
  'long-distance': {
    file: 'long-distance',
    w: [480, 800, 1200],
    alt: '',
  },
  'long-lunch': {
    file: 'long-lunch',
    w: [480, 800, 1200],
    alt: '',
  },
  'old-haunt': {
    file: 'old-haunt',
    w: [480, 800, 1200],
    alt: '',
  },
  encore: {
    file: 'encore',
    w: [480, 800, 1200],
    alt: '',
  },
  'double-date': {
    file: 'double-date',
    w: [480, 800, 1200],
    alt: '',
  },
  'family-hang': {
    file: 'family-hang',
    w: [480, 800, 1200],
    alt: '',
  },
  'shore-ride': {
    file: 'shore-ride',
    w: [480, 800, 1200],
    alt: '',
  },
  'catch-release': {
    file: 'catch-release',
    w: [480, 800, 1200],
    alt: '',
  },
  grind: {
    file: 'grind',
    w: [480, 800, 1200],
    alt: '',
  },
  'day-trip': {
    file: 'day-trip',
    w: [480, 800, 1200],
    alt: '',
  },
  'surprise-me': {
    file: 'surprise-me',
    w: [480, 800, 1200],
    alt: '',
  },
  'pitch-me': {
    file: 'pitch-me',
    w: [480, 800, 1200],
    alt: '',
  },
  'something-new': {
    file: 'something-new',
    w: [480, 800, 1200],
    alt: '',
    credit: {
      by: 'Vitaly Gariev',
      url: 'https://unsplash.com/photos/BFBikYWtA9c',
      licence: 'Unsplash License',
    },
  },
};

/** A registry of slots: PHOTO_SLOTS, or a test fixture. */
export type PhotoSlots = Readonly<Record<string, Photo>>;

/** The src + srcset of a slot's photo, or null when the slot has none yet. */
export function photoSources(
  slot: string,
  slots: PhotoSlots = PHOTO_SLOTS,
): { src: string; srcSet: string; photo: Photo } | null {
  const photo = slots[slot];
  if (!photo || photo.w.length === 0) return null;
  const url = (w: number) => `${PHOTO_DIR}/${photo.file}-${w}.webp`;
  return { src: url(photo.w[0]!), srcSet: photo.w.map((w) => `${url(w)} ${w}w`).join(', '), photo };
}

/** The most photos one slot shows in turn (scripts/build-real-photos.mjs MAX_SLIDES). */
export const MAX_SLIDES = 6;

/** The src + srcset of a slot's photos 2..n (empty for a still photo or an empty slot). */
export function photoSlides(
  slot: string,
  slots: PhotoSlots = PHOTO_SLOTS,
): { src: string; srcSet: string }[] {
  const photo = slots[slot];
  if (!photo || photo.w.length === 0) return [];
  const n = Math.min(MAX_SLIDES, Math.max(1, Math.floor(photo.slides ?? 1)));
  return Array.from({ length: n - 1 }, (_, i) => {
    const url = (w: number) => `${PHOTO_DIR}/${photo.file}-${i + 2}-${w}.webp`;
    return { src: url(photo.w[0]!), srcSet: photo.w.map((w) => `${url(w)} ${w}w`).join(', ') };
  });
}

/** How many photos a slot shows in turn (1 = a still photo, or an empty slot). */
export function slideCount(slot: string, slots: PhotoSlots = PHOTO_SLOTS): number {
  return photoSlides(slot, slots).length + 1;
}
