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
  "slots": { "grind": { "file": "sources/grind.jpg", "pos": "50% 40%" } },
  "text": { "<exact public wording>": "<private wording>" },
  "pos": { "grind": "50% 20%" }
}
```

- `prebuilt`: finished files, each copied over the stand-in of the same name. Each must already exist in
  `public/img`, be WebP at the same pixel size, be at most 200 KB and carry no metadata (no EXIF, XMP, IPTC or
  ICC). `sha256` pins are optional and checked when present.
- `slots`: source photos, downloaded to a temp folder and rendered by `scripts/build-real-photos.mjs` (same
  manifest format it has always taken: widths, aspect, focal point, all metadata stripped). The temp folder is
  deleted afterwards.
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
string not found exactly once, an unknown slot or a bad `pos`) **fails the build**, so a production deploy never
silently ships stand-ins or stand-in wording. The overrides are checked before any file is written. The token is
never logged.

Any https store that answers a plain GET works, e.g. a private Supabase Storage bucket
(`https://<ref>.supabase.co/storage/v1/object/authenticated/<bucket>/` with a read-only key as the token), a
private GitHub repo via `raw.githubusercontent.com` (fine-grained read-only token), or R2 behind a signed/protected
URL. Use a read-only credential scoped to that folder only.

Only set these variables on the Vercel projects that should show Jon's photos. Keep **Git Fork Protection** on, so
a fork's pull request never builds with them.

## After a private build

The swap rewrites files in `public/img` and, with `text` or `pos` overrides, `src/content/menu.ts` and
`src/ui/photo-slots.ts`. The unit tests pin the committed stand-ins byte for byte
(`tests/unit/ui/public-img-allowlist.test.ts`) and the public copy, so if you run the swap locally, restore with
`git checkout -- public/img src/content/menu.ts src/ui/photo-slots.ts` before running the tests, and never commit
the swapped files.

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
