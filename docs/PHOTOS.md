# Photos

`public/img` in git holds **licensed Unsplash stand-ins only**, one file per slot and width
(`<slot>-<width>.webp`, listed in `src/ui/photo-slots.ts`). Jon's own photos are never committed: a private build
swaps them in just before `next build`. CI, forks and local dev build with the stand-ins.

## How the swap works

`pnpm build` runs `node scripts/fetch-real-photos.mjs && next build`.

| Env var                   | Where                             | Meaning                                                                               |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `PRIVATE_PHOTOS_BASE_URL` | Vercel (build), never in git      | https base of the private photo folder. **Unset = no-op** (stand-ins ship).           |
| `PRIVATE_PHOTOS_TOKEN`    | Vercel (build, sensitive), secret | Optional. Sent as `Authorization: Bearer <token>`. Leave unset for a signed/open URL. |

The folder at the base URL holds a `manifest.json` and the files it names:

```json
{
  "prebuilt": ["hero-480.webp", "hero-800.webp"],
  "sha256": { "hero-480.webp": "<hex>", "hero-800.webp": "<hex>" },
  "slots": {
    "grind": { "file": "sources/grind.jpg", "pos": "50% 40%" },
    "hero": [{ "file": "sources/hero-1.jpg" }, { "file": "sources/hero-2.jpg", "pos": "50% 30%" }]
  },
  "text": { "<exact public wording>": "<private wording>" },
  "pos": { "grind": "50% 20%" }
}
```

- `prebuilt`: finished files, each copied over the stand-in of the same name. Each must already exist in
  `public/img`, be WebP at the same pixel size, be at most 200 KB and carry no metadata (no EXIF, XMP, IPTC or
  ICC). `sha256` pins are optional and checked when present.
- `slots`: source photos, downloaded to a temp folder and rendered by `scripts/build-real-photos.mjs` (same
  manifest format it has always taken: widths, aspect, focal point, all metadata stripped). The temp folder is
  deleted afterwards. A slot is either one source (`{ "file", "pos"? }`) or a **list of 1 to 6** of them, shown in
  turn as a slideshow (below). A rendered slot wins over `prebuilt` files of the same slot (those are skipped).
- `text`: private copy. The public repo carries stand-in wording; the private build swaps in the real wording by
  exact string replace. The object form applies to `src/content/menu.ts`; the list form
  (`[{ "file": "src/content/menu.ts", "find": "…", "replace": "…" }]`) names the file, which must be on the
  allow-list (`TEXT_FILES` in `scripts/private-overrides.mjs`, the menu copy only). Each find string must occur
  **exactly once** in its file, inside one single-quoted string on one line (it may be the start or any part of
  that string). Find and replace are plain copy only (`PLAIN_TEXT`): letters (accented ones too), digits, spaces
  and `. , ! ? ’ ‘ “ ” – — … : ; ( ) -`. Anything else, including a straight quote, `<`, a backtick, `$`, braces, a
  slash, a backslash or a line break, fails the build (use typographic quotes, as the copy does). The replacement
  text is never logged.
- `pos`: focal points for Jon's own photos, which may need framing different from the stand-ins'. Each key must be
  an existing slot in `src/ui/photo-slots.ts`; each value is a CSS `object-position` in whole percents, `"x% y%"`
  (0 to 100). It is written as that slot's `pos` (the `<img>` `object-position`). It only moves the crop where the
  slot's box is a different shape from the file (e.g. a 4:3 photo in a 16:9 sheet); it cannot bring back what the
  file itself cut off.

When `PRIVATE_PHOTOS_BASE_URL` is set, any failure (HTTP error, wrong size, metadata, hash mismatch, a `text` find
string not found exactly once, an unknown slot, a bad `pos`, an empty list or more than 6 sources, or a source
missing from the store) **fails the build**, so a production deploy never
silently ships stand-ins or stand-in wording. The overrides are checked before any file is written. The token is
never logged.

Any https store that answers a plain GET works, e.g. a private Supabase Storage bucket
(`https://<ref>.supabase.co/storage/v1/object/authenticated/<bucket>/` with a read-only key as the token), a
private GitHub repo via `raw.githubusercontent.com` (fine-grained read-only token), or R2 behind a signed/protected
URL. Use a read-only credential scoped to that folder only.

Only set these variables on the Vercel projects that should show Jon's photos. Keep **Git Fork Protection** on, so
a fork's pull request never builds with them.

### Slideshows (a list of sources)

With a list, source 1 renders to the slot's usual `<slot>-<w>.webp`, so the page's first photo (and the landing
hero's largest paint) is unchanged. Source _n_ ≥ 2 renders to `<slot>-<n>-<w>.webp` with the same widths, aspect,
quality (q60 for `why` and `close`) and no metadata. The build then writes the count into that slot's entry in
`src/ui/photo-slots.ts` as `slides: <n>` (a count of 1 writes nothing). These extra files exist only in a private
build: they are never committed, and the public image allowlist test accepts a `<slot>-<n>-<w>.webp` only when the
slot's `slides` asks for it (and git never tracks it).

On the page (`<PhotoSlot>`, `src/ui/Slideshow.tsx`), a slot with `slides` > 1 keeps the same box and renders
photo 1 exactly as a still photo. Photos 2 to _n_ are added after the page's load event (lazy, low priority, `alt=""`)
and crossfade every 5 seconds; a Pause/Play button sits on the photo's bottom-right. With reduced motion there is
no rotation and no button (photo 1 only), and the rotation stops while the tab is hidden. On a menu card the photo
is inside the card's link, so the button sits next to the link, laid over the photo. Any slot works: the landing
hero (and the /sent hero, same slot), `why`, `close`, and any dish slot (its menu card and its sheet). The
prototype-only page `/dev/slides` shows one on a test fixture (`tests/e2e/ui/slideshow.spec.ts`).

### Framing (per source, per breakpoint)

A source may also carry:

- `"aspect": "source"`: keep the source's own aspect. The build does not crop it to the slot's aspect (`pos` is not
  used for it); the source is expected to be pre-cut to what any breakpoint shows. Same widths, quality and size cap.
- `"view"`: how the page frames that source in each box. Keys are the ratio tokens, one per kind and breakpoint:
  `hero-s` (<640), `hero-m` (640–1023), `hero` (≥1024); `band`, `band-l` (≥1024); `close-s` (<640),
  `close-m` (640–1023), `close-l` (≥1024), `close-tile` (a closing tile, below); `dish`; `sheet`, `sheet-l`
  (≥1024); `thumb`, `thumb-l` (≥1024); `sent`, `sent-m` (≥768). A value is a position `"x% y%"` (0–100, at most
  one decimal), or `{ "pos": "x% y%", "frame": <w/h> }` (0.2–5): the photo is drawn in the largest centred box of
  that ratio, the rest of the box shows the page paper. Instead of a frame, `"zoom": <1–3>` draws the photo that
  many times larger than cover about its `pos` point, clipped by its box (e.g. `{ "pos": "55% 40%", "zoom": 1.6 }`
  for a closer crop on phones; a view with both `frame` and `zoom` fails the build).

```json
"hero": [
  { "file": "sources/hero-1.jpg", "aspect": "source",
    "view": { "hero-s": { "pos": "50% 13.9%", "frame": 1.141 }, "hero": "50% 18%" } }
]
```

### The closing tiles (≥1024)

When the `close` slot has 3 or more sources, screens 1024 px and up show it as a row of three square tiles in the
text column (16 px gaps) instead of the full-width strip (`src/ui/PhotoTiles.tsx`). Tile _k_ shows source _k_ and
crossfades to source _k_ + 3 (1↔4, 2↔5, 3↔6), all three on one timer with one Pause/Play toggle. Each source is
framed in its tile by its `close-tile` view. Below 1024 px the strip stays as it is (`close-s`, `close-m`), and each
layout's images are only fetched on the screens that show it.

The build writes the views to `src/ui/photo-views.json` (committed as `{}`; numbers only), and `<PhotoSlot>` puts
each source's own `--p-<key>` / `--f-<key>` on its `<img>`, slides included. A key a source doesn't name falls back
to the slot's `pos`, then `50% 50%`. A manifest without `aspect`/`view` builds and renders exactly as before.

## After a private build

The swap rewrites files in `public/img` (and, for a slideshow, adds `<slot>-<n>-<w>.webp` files) and, with `text`,
`pos` or slideshow overrides, `src/content/menu.ts` and `src/ui/photo-slots.ts` (and, with views, `src/ui/photo-views.json`). The unit tests pin the committed stand-ins byte for byte
(`tests/unit/ui/public-img-allowlist.test.ts`) and the public copy, so if you run the swap locally, restore with
`git checkout -- public/img src/content/menu.ts src/ui/photo-slots.ts src/ui/photo-views.json && git clean -f public/img` before running the
tests, and never commit the swapped files.

## Stand-in sources (Unsplash License)

| Slot          | Photographer          | Source                                  |
| ------------- | --------------------- | --------------------------------------- |
| hero          | Ronan                 | https://unsplash.com/photos/PCE0T5i4pDI |
| why           | Filipe Freitas        | https://unsplash.com/photos/CzmTua8Rex4 |
| close         | Sergey Pesterev       | https://unsplash.com/photos/jWD3o-Ht8ZA |
| flat-white    | L.D.I.A               | https://unsplash.com/photos/dQdyO9jsixA |
| first-round   | Giovanna Gomes        | https://unsplash.com/photos/Qy2KMPRV3X4 |
| long-distance | Nguyen Dang Hoang Nhu | https://unsplash.com/photos/SjqrtZOd9Uc |
| long-lunch    | Keesha’s Kitchen      | https://unsplash.com/photos/KRbF_wsztBE |
| old-haunt     | Beren Tuncer          | https://unsplash.com/photos/E3PbQ93H5qY |
| encore        | Yvette de Wit         | https://unsplash.com/photos/NYrVisodQ2M |
| double-date   | Scott Warman          | https://unsplash.com/photos/rrYF1RfotSM |
| family-hang   | Ian Shoemaker         | https://unsplash.com/photos/LWgN-KMs6xM |
| shore-ride    | Artem Balashevsky     | https://unsplash.com/photos/3_6apD3ZTL0 |
| catch-release | Alex Moliski          | https://unsplash.com/photos/6ZHxwJU2CdU |
| grind         | Jake Goossen          | https://unsplash.com/photos/cc7evCoAbr8 |
| day-trip      | Leo_Visions           | https://unsplash.com/photos/1rsCg_TVwlA |
| bluebird      | Abby Thompson         | https://unsplash.com/photos/Oyqrb6e31l0 |
| surprise-me   | Toa Heftiba           | https://unsplash.com/photos/DUXACn8tgp4 |
| pitch-me      | Ayla Meinberg         | https://unsplash.com/photos/xqV9QdGOSas |
| something-new | Vitaly Gariev         | https://unsplash.com/photos/BFBikYWtA9c |

The `why` and `close` stand-ins (below the fold on `/`, but close enough that a phone downloads them while the hero
paints) were re-encoded from the previous files at WebP quality 60, same pixel size and crop, no metadata (T4.6.04,
Jon 2026-10-03), so they stop slowing the hero; `why-1600.webp` is unchanged (re-encoding saved under 10%).
`scripts/build-real-photos.mjs` renders Jon's own photos for those two slots at q60 too (its `QUALITY` map); every
other slot stays at q80. Never lower the hero or a page's first photo: they are the Largest Contentful Paint.

The stand-ins' embedded ICC profile chunk was removed losslessly (pixels unchanged) so every committed image
meets the "no metadata" rule in `tests/unit/ui/public-img-metadata.test.ts`.
