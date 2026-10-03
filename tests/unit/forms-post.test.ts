// QA L5: a form whose submit is handled in script had no method, so a tap on Send before the page was ready (slow
// first load, or script blocked) did the browser's own GET submit: the page reloaded empty and the typed name and
// email went into the URL (/book/the-long-lunch?name=…&email=…), and so into history and request logs. Every such
// form is method="post": an early submit re-renders the page and the fields stay out of every URL (no Server
// Action: the POST lands on the page itself, which only renders).
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

/** The opening <form …> tag from `at` (JSX attributes may hold `{…}` with arrows, so track brace depth). */
function openingTag(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

const forms = globSync('src/**/*.tsx', { cwd: ROOT })
  .filter((f) => !/\.test\.tsx$/.test(f))
  .flatMap((f) => {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    return [...src.matchAll(/<form\b/g)]
      .filter((m) => !src.slice(src.lastIndexOf('\n', m.index) + 1, m.index).includes('//')) // a comment
      .map((m) => ({ file: f, tag: openingTag(src, m.index) }));
  });

describe('forms never submit by GET (QA L5)', () => {
  it('finds the guest and admin forms', () => {
    expect(forms.length).toBeGreaterThan(10);
  });
  it('every form is method="post"', () => {
    expect(
      forms.filter((x) => !/\bmethod="post"/.test(x.tag)).map((x) => `${x.file}: ${x.tag.slice(0, 60)}`),
    ).toEqual([]);
  });
});
