// src/app/_menu/Menu.tsx — S04 the activity menu page body (pack v2.2 s04 menu_block). Its own page (decision 37c):
// h1 the page name, h2 the courses, h3 the dishes. A bookable row is a link that opens its S05 sheet; the Bluebird
// (display-only while it's off) is a plain row. The course nav links to each course (`/menu#<section>`).
import { MENU_CAP, MENU_LABELS, MENU_SUBHEAD, MENU_TITLE } from '@/content';
import { KeepWhole, PhotoSlot } from '@/ui';
import type { BookGate } from '@/app/_landing/book-gate';
import { DishLink, DishSheets } from './DishSheets';
import type { DishRowModel, MenuModel } from './menu-model';

const DISH_SIZES = '(min-width: 1024px) 360px, (min-width: 640px) 45vw, 92vw';

function DishInner({ d }: { d: DishRowModel }) {
  return (
    <>
      <h3 className="dish-name">{d.name}</h3>
      <PhotoSlot slot={d.slot} kind="dish" sizes={DISH_SIZES} />
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

export function Menu({ model, gate }: { model: MenuModel; gate: BookGate }) {
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
                      <DishLink slug={d.slug} href={d.href}>
                        <DishInner d={d} />
                      </DishLink>
                    </li>
                  ) : (
                    <li className="dish dish--off" key={d.slug}>
                      <div className="dish-row">
                        <DishInner d={d} />
                      </div>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}
          <div className="menu-foot">
            <p>{model.foot[0]}</p>
            <p>{model.foot[1]}</p>
          </div>
        </div>
      </section>
    </DishSheets>
  );
}
