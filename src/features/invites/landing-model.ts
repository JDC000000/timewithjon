// src/features/invites/landing-model.ts — T1.2 non-UI: S1/S2/S16 view model. The page renders this; no logic in JSX.
import { dishBySlug, isBookable, bookHref } from '@/content/menu-helpers';
import { OPEN_LINE, PERSONAL, SEE_THE_MENU } from '@/content/site';
import type { InviteSession } from '@/features/invites/session';
import { ROUTES } from '@/ui/routes';

export type LandingModel =
  | { variant: 'open'; stale: boolean; heroLine: string; cta: { label: string; href: string } }
  | {
      variant: 'personal';
      name: string;
      heroLine: string; // "We keep saying we should do {their things} or that epic trip." or the open line
      pickedLine: string | null;
      cta: { label: string; href: string };
      secondary: { label: string; href: string };
    };

export function landingModel(s: InviteSession, now = new Date()): LandingModel {
  if (s.state !== 'valid' || s.invite.kind !== 'personal') {
    return {
      variant: 'open',
      stale: s.state === 'stale',
      heroLine: OPEN_LINE,
      cta: { label: SEE_THE_MENU, href: ROUTES.menu },
    };
  }
  const inv = s.invite;
  const dish = inv.picked_dish ? dishBySlug(inv.picked_dish) : undefined;
  const bookable = dish ? isBookable(dish, now) : false;
  return {
    variant: 'personal',
    name: inv.display_name ?? inv.name_slug,
    heroLine: PERSONAL.ourThingsLine(inv.our_things),
    pickedLine: dish ? PERSONAL.pickedLine(dish.name) : null,
    cta:
      dish && bookable
        ? { label: PERSONAL.book(dish.name), href: bookHref(dish) }
        : { label: PERSONAL.seeWholeMenu, href: ROUTES.menu },
    secondary: { label: PERSONAL.seeWholeMenu, href: ROUTES.menu },
  };
}
