// src/features/invites/landing-model.ts — T1.2 non-UI: S1/S2/S16 view model. The page renders this; no logic in JSX.
import { dishBySlug, inSentence, isBookable, bookHref } from '@/content/menu-helpers';
import { BOOK_A_TIME, OPEN_LINE, PERSONAL } from '@/content/site';
import type { InviteSession } from '@/features/invites/session';
import { ROUTES } from '@/ui/routes';

export type LandingModel =
  | { variant: 'open'; stale: boolean; heroLine: string; cta: Cta }
  | {
      variant: 'personal';
      name: string;
      heroLine: string; // the one hero line, the same for everyone (Jon, 2026-10-05)
      pickedLine: string | null;
      cta: Cta;
      secondary: { label: string; href: string };
    };

/** A landing's main button. `gold`: the menu call to action (Jon's H2, 2026-10-09): the gold "Book a Time with Jon". */
export interface Cta {
  label: string;
  href: string;
  gold?: boolean;
}

export function landingModel(s: InviteSession, now = new Date()): LandingModel {
  if (s.state !== 'valid' || s.invite.kind !== 'personal') {
    return {
      variant: 'open',
      stale: s.state === 'stale',
      heroLine: OPEN_LINE,
      cta: { label: BOOK_A_TIME, href: ROUTES.menu, gold: true },
    };
  }
  const inv = s.invite;
  const dish = inv.picked_dish ? dishBySlug(inv.picked_dish) : undefined;
  const bookable = dish ? isBookable(dish, now) : false;
  return {
    variant: 'personal',
    name: inv.display_name ?? inv.name_slug,
    heroLine: OPEN_LINE, // Jon (2026-10-05): the same line as everyone, whatever the invite's things
    pickedLine: dish ? PERSONAL.pickedLine(inSentence(dish)) : null,
    // R6-M1: when the main button is the menu (no picked dish, or one that can't be booked now), it is the same gold
    // "Book a Time with Jon" as the open landing; a bookable picked dish keeps "Book {dish}" and the menu link
    cta:
      dish && bookable
        ? { label: PERSONAL.book(inSentence(dish)), href: bookHref(dish) }
        : { label: BOOK_A_TIME, href: ROUTES.menu, gold: true },
    secondary: { label: PERSONAL.seeWholeMenu, href: ROUTES.menu },
  };
}
