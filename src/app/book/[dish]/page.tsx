// /book/[dish] (T1.5.U1): every Book button lands here (bookHref). Looks up the dish (404 if it isn't on the menu
// or can't be booked), checks the invite, then renders the dish's flow from the C3 output: the S6 picker, Surprise
// Me (S8), the S7 month grid (dates dishes, the Old Haunt on weekends), or Pitch Me (T1.6).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ROUTES, SiteFooter, SiteHeader } from '@/ui';
import { ERRORS, FLOW, type Dish } from '@/content';
import { bookHref, dishBySlug, isBookable } from '@/content/menu-helpers';
import { DATES, FLOW_UI, OLD_HAUNT, PITCH, SURPRISE } from '@/content/ui/booking';
import { getEnv } from '@/config/env';
import { getInviteSession } from '@/features/invites/session';
import { BookingFlow } from './BookingFlow';
import { DatesFlow } from './DatesFlow';
import { PitchFlow } from './PitchFlow';
import { calMonths } from './_lib/date-grid';
import {
  dishPhotoSlot,
  dishView,
  flowNotices,
  guestView,
  pageTitle,
  pickerHeading,
  type DishView,
} from './_lib/flow-view';
import { loadDishAvailability } from './_lib/load';
import { pickerMonths } from './_lib/picker-model';

export const dynamic = 'force-dynamic';

type Params = {
  params: Promise<{ dish: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The Old Haunt's weekend mode (T1.6.U6): a plain link, so Back and reload keep the mode (FOC-02). */
const WEEKEND = 'weekend';

function bookableDish(slug: string) {
  const dish = dishBySlug(slug);
  return dish && isBookable(dish) ? dish : null;
}

function weekendMode(dish: Dish, search: Record<string, string | string[] | undefined>): boolean {
  return dish.flow === 'old-haunt' && search.when === WEEKEND;
}

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const dish = bookableDish((await params).dish);
  if (!dish) return {};
  const view = dishView(dish);
  const title =
    dish.flow === 'surprise'
      ? SURPRISE.pageTitle
      : dish.flow === 'pitch'
        ? PITCH.pageTitle
        : dish.flow === 'dates' || weekendMode(dish, await searchParams)
          ? DATES.pageTitle(view.name)
          : pageTitle(view);
  return { title: { absolute: title } };
}

export default async function BookPage({ params, searchParams }: Params) {
  const dish = bookableDish((await params).dish);
  if (!dish) notFound();
  const view = dishView(dish);
  const session = await getInviteSession();

  let body: React.ReactNode;
  /** the dish thumb shows (DatesFlow, BookingFlow bar Surprise Me): its stand-in is credited in the footer */
  let thumb = false;
  if (session.state !== 'valid') {
    body = <OnlyLine dish={view} line={session.state === 'stale' ? ERRORS.stale : ERRORS.noInvite} />;
  } else {
    const { engine, season } = await loadDishAvailability(dish, session.invite.kind);
    const notices = flowNotices(engine);
    const guest = guestView(session.invite, getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY);
    const weekend = weekendMode(dish, await searchParams);
    const months = pickerMonths(engine.weeks);
    const weekendDates = () => (
      <DatesFlow
        dish={view}
        months={calMonths(season, engine.unavailableDates, 'weekend')}
        notices={notices}
        guest={guest}
        weekendsOnly
        // With no Thu/Fri times left there is nothing to switch back to.
        switchTo={months.length ? { href: bookHref(dish), label: OLD_HAUNT.toTimes } : undefined}
      />
    );
    if (notices.opensOn) body = <OnlyLine dish={view} line={notices.opensOn} />;
    else if (dish.flow === 'dates') {
      thumb = true;
      body = (
        <DatesFlow
          dish={view}
          months={calMonths(season, engine.unavailableDates, view.dateRule)}
          notices={notices}
          guest={guest}
        />
      );
    } else if (dish.flow === 'pitch') body = <PitchFlow dish={view} notices={notices} guest={guest} />;
    else if (dish.flow === 'old-haunt' && (weekend || !months.length)) {
      thumb = true;
      body = weekendDates();
    } else if (!months.length)
      // pr76 F4: nothing left to pick this season (every week past or spoken for): the existing run line only.
      body = <OnlyLine dish={view} line={FLOW.spokenForRun} />;
    else {
      thumb = dish.flow !== 'surprise';
      body = (
        <BookingFlow
          dish={view}
          months={months}
          notices={notices}
          guest={guest}
          surprise={dish.flow === 'surprise'}
          switchTo={
            dish.flow === 'old-haunt'
              ? { href: `${bookHref(dish)}?when=${WEEKEND}`, label: OLD_HAUNT.toWeekend }
              : undefined
          }
        />
      );
    }
  }

  return (
    <>
      <SiteHeader back={{ href: ROUTES.menu, label: FLOW_UI.backToMenu }} />
      <main id="main">{body}</main>
      <SiteFooter photos={thumb ? [dishPhotoSlot(dish.slug)] : []} />
    </>
  );
}

/** No invite, a stale link, or booking not open yet: the dish header and one line (wireframe 04-C, copy only). */
function OnlyLine({ dish, line }: { dish: DishView; line: string }) {
  return (
    <div className="wrap">
      <div className="flow-top">
        <p className="cap">{`${dish.course} · ${dish.name}`}</p>
        <h1 className="h1">{pickerHeading()}</h1>
        <p className="notice" role="note">
          {line}
        </p>
      </div>
    </div>
  );
}
