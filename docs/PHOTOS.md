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
  "slots": { "grind": { "file": "sources/grind.jpg", "pos": "50% 40%" } }
}
```

- `prebuilt`: finished files, each copied over the stand-in of the same name. Each must already exist in
  `public/img`, be WebP at the same pixel size, be at most 200 KB and carry no metadata (no EXIF, XMP, IPTC or
  ICC). `sha256` pins are optional and checked when present.
- `slots`: source photos, downloaded to a temp folder and rendered by `scripts/build-real-photos.mjs` (same
  manifest format it has always taken: widths, aspect, focal point, all metadata stripped). The temp folder is
  deleted afterwards.

When `PRIVATE_PHOTOS_BASE_URL` is set, any failure (HTTP error, wrong size, metadata, hash mismatch) **fails the
build**, so a production deploy never silently ships stand-ins. The token is never logged.

Any https store that answers a plain GET works, e.g. a private Supabase Storage bucket
(`https://<ref>.supabase.co/storage/v1/object/authenticated/<bucket>/` with a read-only key as the token), a
private GitHub repo via `raw.githubusercontent.com` (fine-grained read-only token), or R2 behind a signed/protected
URL. Use a read-only credential scoped to that folder only.

Only set these variables on the Vercel projects that should show Jon's photos. Keep **Git Fork Protection** on, so
a fork's pull request never builds with them.

## After a private build

The swap rewrites files in `public/img`. The unit tests pin the committed stand-ins byte for byte
(`tests/unit/ui/public-img-allowlist.test.ts`), so if you run the swap locally, restore the stand-ins with
`git checkout -- public/img` before running the tests, and never commit the swapped files.

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
