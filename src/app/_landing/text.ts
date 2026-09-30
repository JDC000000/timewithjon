// src/app/_landing/text.ts — small text helpers for guest copy (the pack's gen.py no-widow rule; dates use KeepWhole).
const NBSP = ' ';

/** Joins the last two words with a no-break space, so the last line never holds one word ("any&nbsp;length"). */
export function noWidow(text: string): string {
  const i = text.lastIndexOf(' ');
  return i < 0 ? text : text.slice(0, i) + NBSP + text.slice(i + 1);
}

/** Splits a sentence around one inner phrase: [before, after], or null when the phrase is not in it. */
export function around(text: string, phrase: string): [string, string] | null {
  const i = phrase ? text.indexOf(phrase) : -1;
  return i < 0 ? null : [text.slice(0, i), text.slice(i + phrase.length)];
}
