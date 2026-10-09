// src/app/dev/slides/page.dev.tsx: the photo slideshow (src/ui/Slideshow.tsx) on a fixture slot registry, for
// tests/e2e/ui/slideshow.spec.ts. Public builds have no slideshow (`slides` is written only by a private build), so
// this bench is the only place one renders from the repo. Photos 2..n of the fixture are not on disk: the spec serves
// committed stand-ins for them. Prototype build only; the twj_dev cookie like every /dev page. Dev-only labels.
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { DishPhotoScope } from '@/app/_menu/Menu';
import { DEV_COOKIE, devCookieOk } from '@/features/dev/guard';
import { PhotoSlot, SiteHeader, type PhotoSlots } from '@/ui';
import type { PhotoViews } from '@/ui/photo-slots';

export const dynamic = 'force-dynamic';

/** a test-only photo-slots registry: two committed stand-ins, each shown as a 3-photo slideshow */
const FIXTURE: PhotoSlots = {
  show: { file: 'hero', w: [480, 800, 1200, 1600], alt: '', slides: 3 },
  card: { file: 'catch-release', w: [480, 800, 1200], alt: '', slides: 3 },
};

/** test-only framing (photo-views.json shape): photo 1 framed at both band breakpoints, slide 2 positioned only */
const FIXTURE_VIEWS: PhotoViews = {
  show: [
    { band: { pos: '50% 20%', frame: 1.2 }, 'band-l': { pos: '50% 30%', frame: 0.9 } },
    { band: '30% 40%' },
    {},
  ],
  card: [{ dish: { pos: '50% 25%', frame: 1 } }, {}, {}],
};

export default async function SlidesPage() {
  if (!devCookieOk((await cookies()).get(DEV_COOKIE)?.value)) notFound();
  return (
    <>
      <SiteHeader />
      <main id="main" className="photo-led">
        <div className="wrap">
          <h1 className="h1">Slideshow</h1>
          <PhotoSlot slot="show" kind="band" priority="hero" slots={FIXTURE} views={FIXTURE_VIEWS} />
          <section className="menu" aria-label="Sample card">
            <ul>
              <li className="dish">
                <DishPhotoScope slot="card" slots={FIXTURE} label="Sample card">
                  <a className="dish-row" href="#card">
                    <h2 className="dish-name">Sample card</h2>
                    <PhotoSlot
                      slot="card"
                      kind="dish"
                      controls="outside"
                      slots={FIXTURE}
                      views={FIXTURE_VIEWS}
                    />
                  </a>
                </DishPhotoScope>
              </li>
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
