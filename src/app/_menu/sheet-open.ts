// src/app/_menu/sheet-open.ts — when a click on a dish row opens its sheet, and which sheet a URL deep-links to.

/** A plain primary click opens the sheet; a new-tab/window click (modifier or middle button) follows the link. */
export function opensSheet(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

/** `/menu#the-long-lunch` opens that dish's sheet on load; a course (`#big-days`) or anything else opens nothing. */
export function slugFromHash<T extends string>(hash: string, slugs: readonly T[]): T | null {
  let s: string;
  try {
    s = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return null; // a malformed %-escape in a hand-typed URL
  }
  return (slugs as readonly string[]).includes(s) ? (s as T) : null;
}
