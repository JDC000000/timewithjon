// src/content/menu-helpers.ts — T1.3 non-UI: which dishes show, and where Book goes.
import { vancouverDate } from '@/lib/time';
import { DISHES } from './menu';
import type { Dish } from './types';

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
