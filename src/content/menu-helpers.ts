// src/content/menu-helpers.ts — T1.3 non-UI: which dishes show, and where Book goes.
import { civilDateIn } from '@/lib/civil';
import { TZ } from '@/lib/tz';
import { DISHES } from './menu';
import type { Dish } from './types';

/** A dish's name inside a sentence (Jon, 2026-10-05: "I was thinking a hike or nature moment"); titles keep `name`. */
export function inSentence(d: Pick<Dish, 'name' | 'inSentence'>): string {
  return d.inSentence ?? d.name;
}

/** The sentence form by slug, for emails' {dish} (an unknown slug reads as itself). */
export function dishInSentence(slug: string): string {
  const d = dishBySlug(slug);
  return d ? inSentence(d) : slug;
}

/** After a possessive ("Cancel Sam’s …", "Lock in Sam’s …"): the sentence form without its article ("Long Lunch",
 *  "hike or nature moment"). */
export function dishAfterPossessive(slug: string): string {
  return dishInSentence(slug).replace(/^(The|a|an) /, '');
}

export function dishBySlug(slug: string): Dish | undefined {
  return DISHES.find((d) => d.slug === slug);
}
/** Hide a dish after its available_until date (Vancouver). */
export function visibleDishes(now = new Date()): Dish[] {
  const today = civilDateIn(now, TZ);
  return DISHES.filter((d) => !d.availableUntil || today <= d.availableUntil);
}
export function isBookable(d: Dish, now = new Date()): boolean {
  return d.bookable && (!d.availableUntil || civilDateIn(now, TZ) <= d.availableUntil);
}
/**
 * How many may come, the guest included (Q9, approved: Jon 2026-10-09): 1 (or the dish's servesMin) up to the
 * servesMax the menu shows. min = max is a fixed size: the booking screens don't ask and send that number.
 */
export interface CrewRange {
  min: number;
  max: number;
}
export function crewRange(d: Pick<Dish, 'servesMin' | 'servesMax'>): CrewRange {
  const max = Math.max(1, d.servesMax);
  return { min: Math.min(Math.max(1, d.servesMin ?? 1), max), max };
}
/** Route contract for the UI: every Book button goes to /book/{slug}; the page picks the flow from dish.flow. */
export function bookHref(d: Dish): string {
  return `/book/${d.slug}`;
}
