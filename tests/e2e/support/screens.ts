// The route map: every screen a T4.3.09 / T4.3.02 case visits, in the pack mock and in the real app.
// E2E_TARGET=pack (local only) runs the cases against the v1.12 mocks (designs/final, served by pack-server.mjs);
// the default, `app`, runs them against the prototype build. A screen whose real route is not on main yet has
// `app: null` and its cases are `test.fixme` naming the owner lane; set `app` when that lane's PR merges.
import type { Page } from '@playwright/test';
import { DISHES } from '../../../src/content';
import { isBookable } from '../../../src/content/menu-helpers';
import { signInAs, type Visitor } from './sessions';

export type Target = 'app' | 'pack';
export type Lane = 'U2' | 'U3' | 'U4' | 'U5' | 'U6' | 'U7';

/**
 * `app`: the real route (null = not reachable on main yet: `why` says what is missing, `owner` who delivers it).
 * `as`: who opens it (support/sessions.ts); default: an anonymous visitor.
 */
type Screen = { pack: string; app: string | null; owner: Lane; as?: Visitor; why?: string };

/** The picker screen on the app = the first bookable picker dish on the menu (src/content). */
const PICKER_DISH = DISHES.find((d) => d.flow === 'picker' && isBookable(d))?.slug ?? 'no-picker-dish';
/** The Surprise Me screen on the app = the menu's surprise dish. */
const SURPRISE_DISH = DISHES.find((d) => d.flow === 'surprise' && isBookable(d))?.slug ?? 'no-surprise-dish';
/** A week of the seeded season (supabase/seed.sql: weeks from 2027-03-29). */
const SEED_WEEK = '2027-04-05';
const NEEDS_REQUEST =
  'needs a lockable guest request: the S10 send (U3) or the T4.3.02 journey seed (U7 PR3)';
const FLOW_STATE = 'a state reached inside the flow, not a URL: driven by the T4.3.02 journey (U7 PR3)';

export const SCREENS = {
  'a1-sign-in': { pack: 'a1-sign-in', app: '/admin/sign-in', owner: 'U5' },
  'a1b-sign-in-code': { pack: 'a1b-sign-in-code', app: null, owner: 'U7', why: FLOW_STATE },
  'a1c-sign-in-confirm': { pack: 'a1c-sign-in-confirm', app: null, owner: 'U7', why: FLOW_STATE },
  'a1d-sign-in-email': { pack: 'a1d-sign-in-email', app: null, owner: 'U7', why: FLOW_STATE },
  'a2-requests': { pack: 'a2-requests', app: '/admin', owner: 'U5', as: 'admin' },
  'a3-request-detail': { pack: 'a3-request-detail', app: null, owner: 'U7', why: NEEDS_REQUEST },
  'a3b-lock-undo': { pack: 'a3b-lock-undo', app: null, owner: 'U7', why: NEEDS_REQUEST },
  'a3c-more-sheet': { pack: 'a3c-more-sheet', app: null, owner: 'U7', why: NEEDS_REQUEST },
  'a4-season': { pack: 'a4-season', app: '/admin/season', owner: 'U6', as: 'admin' },
  'a4b-week': { pack: 'a4b-week', app: `/admin/season/week/${SEED_WEEK}`, owner: 'U6', as: 'admin' },
  'a4c-away': { pack: 'a4c-away', app: '/admin/season/away', owner: 'U6', as: 'admin' },
  's01-landing': { pack: 's01-landing', app: '/', owner: 'U2' },
  's02-personal-link': { pack: 's02-personal-link', app: '/', owner: 'U2', as: 'guest' },
  's04-menu': { pack: 's04-menu', app: '/menu', owner: 'U2' },
  's05-dish-sheet': { pack: 's05-dish-sheet', app: '/menu#the-long-lunch', owner: 'U2' },
  's06-picker-open': { pack: 's06-picker-open', app: `/book/${PICKER_DISH}`, owner: 'U3', as: 'guest' },
  's06-picker-spoken-for': {
    pack: 's06-picker-spoken-for',
    app: null,
    owner: 'U7',
    why: 'needs a fully booked seed week (U7 PR3 seed)',
  },
  's06-picker-away': {
    pack: 's06-picker-away',
    app: null,
    owner: 'U7',
    why: 'needs an away range in view (U7 PR3 seed)',
  },
  's07-date-request': { pack: 's07-date-request', app: null, owner: 'U3' },
  's08-surprise-me': { pack: 's08-surprise-me', app: `/book/${SURPRISE_DISH}`, owner: 'U3', as: 'guest' },
  's10-details-send': { pack: 's10-details-send', app: null, owner: 'U3' },
  's10b-send-errors': { pack: 's10b-send-errors', app: null, owner: 'U3' },
  's11-after-send': { pack: 's11-after-send', app: null, owner: 'U4' },
  's12-no-gifts': { pack: 's12-no-gifts', app: null, owner: 'U2' },
  's12b-wine-tag': { pack: 's12b-wine-tag', app: null, owner: 'U2' },
  's17-manage-booking': { pack: 's17-manage-booking', app: null, owner: 'U4' },
  's17b-manage-states': { pack: 's17b-manage-states', app: null, owner: 'U4' },
} as const satisfies Record<string, Screen>;

export type ScreenKey = keyof typeof SCREENS;

export function targetFromEnv(value: string | undefined): Target {
  if (value === undefined || value === '' || value === 'app') return 'app';
  if (value === 'pack') return 'pack';
  throw new Error(`E2E_TARGET must be "app" or "pack", got "${value}"`);
}

export const TARGET = targetFromEnv(process.env.E2E_TARGET);
/** Same as playwright.config.ts's baseURL. */
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? 3300}`;

/** Why a screen can't be visited on this target (for test.fixme), or null when it can. */
export function unavailable(key: ScreenKey, target: Target = TARGET): string | null {
  const screen: Screen = SCREENS[key];
  if (target === 'pack' || screen.app !== null) return null;
  return `${key}: ${screen.why ?? 'the real route is not on main yet'} (owner lane ${screen.owner})`;
}

/**
 * The URL of a screen. The pack has one responsive design per screen in two review files (their only difference
 * is where their links point), so the -desktop file is used from 1024 px up, like the pack's own review widths.
 */
export function screenPath(key: ScreenKey, viewportWidth: number, target: Target = TARGET): string {
  const screen: Screen = SCREENS[key];
  if (target === 'pack') {
    return `/final/${screen.pack}-design-${viewportWidth >= 1024 ? 'desktop' : 'mobile'}.html`;
  }
  if (screen.app === null) throw new Error(unavailable(key, target) ?? key);
  return screen.app;
}

export async function gotoScreen(page: Page, key: ScreenKey): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  const screen: Screen = SCREENS[key];
  if (TARGET === 'app' && screen.as) await signInAs(page.context(), screen.as, BASE_URL);
  await page.goto(screenPath(key, width));
}

/** test.fixme for every screen a case visits whose real route has not landed yet (names the owner lane). */
export function fixmeUnlessLanded(
  fixme: (condition: boolean, reason: string) => void,
  keys: ScreenKey[],
): void {
  for (const key of keys) {
    const reason = unavailable(key);
    fixme(reason !== null, reason ?? '');
  }
}
