// src/content/menu-helpers.ts — T1.3 non-UI: which dishes show, and where Book goes.
import { vancouverDate } from '@/lib/time';
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
  const today = vancouverDate(now);
  return DISHES.filter((d) => !d.availableUntil || today <= d.availableUntil);
}
export function isBookable(d: Dish, now = new Date()): boolean {
  return d.bookable && (!d.availableUntil || vancouverDate(now) <= d.availableUntil);
}
/** Route contract for the UI: every Book button goes to /book/{slug}; the page picks the flow from dish.flow. */
export function bookHref(d: Dish): string {
  return `/book/${d.slug}`;
}
