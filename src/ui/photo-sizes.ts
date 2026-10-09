// src/ui/photo-sizes.ts: the <img sizes> of each photo kind, from the widths the layout actually renders (measured at
// 375/768/1024/1440: site.css). It decides which file a browser fetches, so it must not overstate.
// A phone at 2.5x density or more fetches for about 2x: a full-width photo at 3x costs about twice the bytes of 2x for
// little visible gain (a 430 px phone would otherwise take the 1600 w file). Browsers without `resolution` media
// queries skip that entry and use the plain one.
import type { PhotoKind } from './PhotoSlot';

const DENSE_PHONE = '(max-width: 639px) and (min-resolution: 2.5dppx)';

export const PHOTO_SIZES: Readonly<Record<PhotoKind, string>> = {
  /** the landing hero: full-bleed on phones and tablets, the right column (<= 640 px) from 1024 */
  hero: `(min-width: 1024px) min(50vw, 640px), ${DENSE_PHONE} 67vw, 100vw`,
  /** the why band: full-bleed, at most 1920 px (centred past it) */
  band: `${DENSE_PHONE} 67vw, min(100vw, 1920px)`,
  /** the closing photo: full-bleed, at most 1920 px (centred past it) */
  close: `${DENSE_PHONE} 67vw, min(100vw, 1920px)`,
  /** a menu card: 3 columns (<= 380 px) from 1024, 2 from 640, else the page width */
  dish: `(min-width: 1024px) min(30vw, 380px), (min-width: 640px) 45vw, ${DENSE_PHONE} 62vw, 92vw`,
  /** a dish sheet's header: the side panel from 1024, else the sheet's full width */
  sheet: `(min-width: 1024px) 520px, ${DENSE_PHONE} 67vw, 100vw`,
  /** the /book thumb: the flow column (<= 704 px), page margins 20 px (32 px from 768) */
  thumb: `(min-width: 1024px) min(53vw, 704px), (min-width: 768px) min(calc(100vw - 64px), 704px), ${DENSE_PHONE} calc(67vw - 27px), calc(100vw - 40px)`,
  /** /sent and /manage: the 736 px column from 768, else full-bleed */
  sent: `(min-width: 768px) 736px, ${DENSE_PHONE} 67vw, 100vw`,
  /** the wine tag (no photo today) */
  wine: '100vw',
};

/** a closing tile (PhotoTiles): a third of the text column (<= 1200 px, 16 px gaps), shown only from 1024 px */
export const TILE_SIZES = '(min-width: 1024px) min(30vw, 390px), 100vw';
