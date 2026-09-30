// src/app/_menu/menu-model.ts — S04 /menu + S05 sheets view model (pack v2.2 s04/s05). Pure; the page renders it.
// Courses in SECTIONS order (a course with no visible dish is dropped); each row carries its pack card (photo slot,
// detail lines) and, when the dish can be booked, its sheet (course caption, facts, next line, Book {dish}).
import { DISH_CARDS, MENU_FOOTER, PERSONAL, SECTIONS, menuLine } from '@/content';
import type { Dish, DishSlug, Section } from '@/content';
import { bookHref, isBookable, visibleDishes } from '@/content/menu-helpers';

export interface DishSheetModel {
  cap: string; // the course title
  facts: readonly (readonly [string, string])[];
  next: string | null;
  book: { label: string; href: string };
}
export interface DishRowModel {
  slug: DishSlug;
  name: string;
  line: string;
  slot: string;
  detail: readonly string[];
  href: string | null; // null = display-only (the Bluebird while it's off): no link, no sheet
  sheet: DishSheetModel | null;
}
export interface CourseModel {
  id: Section;
  title: string;
  intro: string | null;
  dishes: DishRowModel[];
}
export interface MenuModel {
  courses: CourseModel[];
  foot: [string, string]; // pack s04: line 1, then lines 2 + 3 as one paragraph
  /** every photo slot the page shows, in page order (each one must be filled: menu-model.test.ts) */
  photos: string[];
}

function dishRow(d: Dish, courseTitle: string, now: Date): DishRowModel {
  const card = DISH_CARDS[d.slug];
  const base = { slug: d.slug, name: d.name, line: menuLine(d), slot: card.slot, detail: card.detail };
  if (!isBookable(d, now)) return { ...base, href: null, sheet: null };
  const href = bookHref(d);
  return {
    ...base,
    href,
    sheet: {
      cap: courseTitle,
      facts: card.facts,
      next: card.next,
      book: { label: PERSONAL.book(d.name), href },
    },
  };
}

export function menuModel(now = new Date(), dishes: readonly Dish[] = visibleDishes(now)): MenuModel {
  const courses = SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
    intro: s.intro ?? null,
    dishes: dishes.filter((d) => d.section === s.id).map((d) => dishRow(d, s.title, now)),
  })).filter((c) => c.dishes.length > 0);
  const [first = '', ...rest] = MENU_FOOTER;
  const photos = [...courses.flatMap((c) => c.dishes.map((d) => d.slot)), 'close'];
  return { courses, foot: [first, rest.join(' ')], photos };
}
