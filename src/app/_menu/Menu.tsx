// src/app/_menu/Menu.tsx — S04 the activity menu page body (pack v2.2 s04 menu_block). Its own page (decision 37c):
// h1 the page name, h2 the courses, h3 the dishes. A bookable row is a link that opens its S05 sheet; a dish that
// can't be booked would be a plain row. The course nav links to each course (`/menu#<section>`). Jon (2026-10-05):
// no menu foot (its lines and the closing line are gone).
import { MENU_CAP, MENU_LABELS, MENU_SUBHEAD, MENU_TITLE } from '@/content';
import type { ReactNode } from 'react';
import { KeepWhole, PhotoSlot, SlideshowScope, SlideshowToggle, slideCount, type PhotoSlots } from '@/ui';
import type { BookGate } from '@/app/_landing/book-gate';
import { DishLink, DishSheets } from './DishSheets';
import type { DishRowModel, MenuModel } from './menu-model';

const DISH_SIZES = '(min-width: 1024px) 360px, (min-width: 640px) 45vw, 92vw';

// T4.6.04: the first dish's photo is in the first viewport on a phone (the page's largest paint): fetched first, not lazy.
function DishInner({ d, first }: { d: DishRowModel; first: boolean }) {
  return (
    <>
      <h3 className="dish-name">{d.name}</h3>
      <PhotoSlot
        slot={d.slot}
        kind="dish"
        sizes={DISH_SIZES}
        priority={first ? 'hero' : undefined}
        controls={slideCount(d.slot) > 1 ? 'outside' : 'inside'}
      />
      {d.caption ? <p className="detail ph-cap">{d.caption}</p> : null}
      <p className="dish-desc">{d.line}</p>
      <p className="dish-detail detail">
        {d.detail.map((l) => (
          <span className="dl" key={l}>
            <KeepWhole text={l} />
          </span>
        ))}
      </p>
    </>
  );
}

/**
 * A card whose photo is a slideshow: the photo sits inside the card's link, and a button can't nest in an <a>, so its
 * Pause/Play toggle is the link's sibling, laid over the photo's bottom-right (.ph-ctl: the photo's box). A still
 * photo: the card as it was.
 */
export function DishPhotoScope({
  slot,
  slots,
  children,
}: {
  slot: string;
  slots?: PhotoSlots;
  children: ReactNode;
}) {
  const count = slideCount(slot, slots);
  if (count < 2) return children;
  return (
    <SlideshowScope count={count}>
      {children}
      <div className="ph-ctl">
        <SlideshowToggle />
      </div>
    </SlideshowScope>
  );
}

export function Menu({ model, gate }: { model: MenuModel; gate: BookGate }) {
  const firstSlug = model.courses[0]?.dishes[0]?.slug;
  return (
    <DishSheets dishes={model.courses.flatMap((c) => c.dishes)} gate={gate}>
      <section className="menu" id="menu" aria-labelledby="menu-h">
        <div className="wrap">
          <div className="menu-head">
            <p className="cap">{MENU_CAP}</p>
            <h1 className="h1" id="menu-h">
              {MENU_TITLE}
            </h1>
            <p className="lead">{MENU_SUBHEAD}</p>
          </div>
          <nav aria-label={MENU_LABELS.courses}>
            <ul className="course-nav">
              {model.courses.map((c) => (
                <li key={c.id}>
                  <a href={`#${c.id}`}>{c.title}</a>
                </li>
              ))}
            </ul>
          </nav>
          {model.courses.map((c) => (
            <section className="course" id={c.id} aria-labelledby={`${c.id}-h`} key={c.id}>
              <div className="course-h">
                <h2 className="c" id={`${c.id}-h`}>
                  {c.title}
                </h2>
              </div>
              {c.intro ? <p className="course-note">{c.intro}</p> : null}
              <ul>
                {c.dishes.map((d) =>
                  d.href ? (
                    <li className="dish" key={d.slug}>
                      <DishPhotoScope slot={d.slot}>
                        <DishLink slug={d.slug} href={d.href}>
                          <DishInner d={d} first={d.slug === firstSlug} />
                        </DishLink>
                      </DishPhotoScope>
                    </li>
                  ) : (
                    <li className="dish dish--off" key={d.slug}>
                      <DishPhotoScope slot={d.slot}>
                        <div className="dish-row">
                          <DishInner d={d} first={d.slug === firstSlug} />
                        </div>
                      </DishPhotoScope>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </DishSheets>
  );
}
