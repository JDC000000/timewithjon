// Private text and focal-point overrides for the private build (docs/PHOTOS.md), applied by
// scripts/fetch-real-photos.mjs from the private manifest.json. Pure functions: they take file contents and return
// new contents, so the unit tests drive them with dummy strings (tests/unit/private-overrides.test.ts).
// Fail closed: any bad entry throws, and the caller fails the build. Errors and logs never carry replacement text.

/** The only files a text override may touch (repo-relative). Extend deliberately, one file at a time. */
export const TEXT_FILES = Object.freeze(['src/content/menu.ts']);
/** The file the object form (`"text": { "<find>": "<replace>" }`) applies to. */
export const DEFAULT_TEXT_FILE = 'src/content/menu.ts';
/** Where the photo slots (and their focal points) live. */
export const PHOTO_SLOTS_FILE = 'src/ui/photo-slots.ts';
/** A CSS object-position in whole percent, x then y: "50% 20%". */
export const POS_PATTERN = /^\d{1,3}% \d{1,3}%$/;

/**
 * Plain copy only, for both find and replace: letters (with the common accented Latin ones), digits, spaces and the
 * copy's punctuation (. , ! ? ’ ‘ “ ” – — … : ; ( ) -). The pack sets quotes typographically, so a straight quote,
 * markup, a template, `$`, braces, a slash, an escape or a line break is refused.
 */
export const PLAIN_TEXT =
  /^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F .,!?\u2019\u2018\u201C\u201D\u2013\u2014\u2026:;()-]+$/;

function fail(msg) {
  throw new Error(`private-overrides: ${msg}`);
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The manifest's `text` as a list of { file, find, replace }. Accepts the object form (applies to
 * DEFAULT_TEXT_FILE) or a list. Validates shape, the file allow-list and the replacement guard; not the matches.
 */
export function parseTextOverrides(text) {
  if (text === undefined) return [];
  const list = Array.isArray(text)
    ? text
    : isObject(text)
      ? Object.entries(text).map(([find, replace]) => ({ file: DEFAULT_TEXT_FILE, find, replace }))
      : fail('"text" must be an object or a list');
  return list.map((e, i) => {
    if (!isObject(e)) fail(`text #${i + 1} must be an object`);
    const { file, find, replace } = e;
    if (!TEXT_FILES.includes(file)) fail(`text #${i + 1}: file is not in the allow-list`);
    if (typeof find !== 'string' || find.length === 0)
      fail(`text #${i + 1}: find must be a non-empty string`);
    if (typeof replace !== 'string' || replace.length === 0)
      fail(`text #${i + 1}: replace must be a non-empty string`);
    if (!PLAIN_TEXT.test(find)) fail(`text #${i + 1}: find holds a forbidden character`);
    if (!PLAIN_TEXT.test(replace)) fail(`text #${i + 1}: replace holds a forbidden character`);
    return { file, find, replace };
  });
}

function countOf(haystack, needle) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

/**
 * The [start, end) spans of the single-quoted string contents on one line of TS source. Null when the line can't be
 * read with certainty (a template literal, a block comment, a slash that is not a line comment, an unclosed string),
 * so the caller fails closed. A line comment ends the scan.
 */
export function singleQuotedSpans(line) {
  const spans = [];
  let quote = null;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) {
        if (quote === "'") spans.push([start, i]);
        quote = null;
      }
    } else if (c === "'" || c === '"') {
      quote = c;
      start = i + 1;
    } else if (c === '`') return null;
    else if (c === '/') {
      if (line[i + 1] === '/') break;
      return null;
    }
  }
  return quote ? null : spans;
}

/** True when [at, at + length) lies inside one single-quoted string on its line of `src`. */
function insideOneString(src, at, length) {
  const lineStart = src.lastIndexOf('\n', at - 1) + 1;
  const nl = src.indexOf('\n', at);
  const lineEnd = nl === -1 ? src.length : nl;
  if (at + length > lineEnd) return false;
  const spans = singleQuotedSpans(src.slice(lineStart, lineEnd));
  const from = at - lineStart;
  return spans !== null && spans.some(([s, e]) => from >= s && from + length <= e);
}

/**
 * Applies the overrides in order to `sources` ({ [file]: contents }), returning the changed files only. Each find
 * string must occur exactly once in its file (as the file stands after the earlier overrides), inside one
 * single-quoted string on one line, so the replacement only ever changes the words of a string, never code.
 */
export function applyTextOverrides(sources, overrides) {
  const out = {};
  overrides.forEach(({ file, find, replace }, i) => {
    const src = out[file] ?? sources[file];
    if (typeof src !== 'string') fail(`text #${i + 1}: ${file} was not read`);
    const n = countOf(src, find);
    if (n !== 1) fail(`text #${i + 1}: find string occurs ${n} times in ${file} (expected exactly 1)`);
    const at = src.indexOf(find);
    if (!insideOneString(src, at, find.length))
      fail(`text #${i + 1}: find string is not inside one quoted string in ${file}`);
    out[file] = src.slice(0, at) + replace + src.slice(at + find.length);
  });
  return out;
}

/** The manifest's `pos` as a list of [slot, value]; validates the value (two whole percents, each 0..100). */
export function parsePosOverrides(pos) {
  if (pos === undefined) return [];
  if (!isObject(pos)) fail('"pos" must be an object of slot -> "x% y%"');
  return Object.entries(pos).map(([slot, value]) => {
    if (
      typeof value !== 'string' ||
      !POS_PATTERN.test(value) ||
      value.split(' ').some((p) => parseInt(p, 10) > 100)
    )
      fail(`pos "${slot}": must be "x% y%" in whole percents 0-100`);
    return [slot, value];
  });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Sets `key: literal,` in one slot's entry of photo-slots.ts source (replacing an existing line, or adding one after
 * `file:`). The slot must already exist as a top-level entry of PHOTO_SLOTS, exactly once. `what` names the override
 * in errors.
 */
function setSlotField(src, slot, key, literal, what) {
  if (!/^[a-z0-9-]+$/.test(slot)) fail(`${what} "${slot}": not a slot name`);
  const head = new RegExp(`^ {2}(?:'${escapeRe(slot)}'|${escapeRe(slot)}): \\{$`, 'gm');
  const starts = [...src.matchAll(head)];
  if (starts.length !== 1) fail(`${what} "${slot}": no such slot in ${PHOTO_SLOTS_FILE}`);
  const begin = starts[0].index + starts[0][0].length;
  const end = src.indexOf('\n  },', begin);
  if (end === -1) fail(`${what} "${slot}": entry in ${PHOTO_SLOTS_FILE} is not closed`);
  const block = src.slice(begin, end);
  const line = `    ${key}: ${literal},`;
  const existing = new RegExp(`^ {4}${key}: [^\\n]*,$`, 'm');
  let next;
  if (existing.test(block)) next = block.replace(existing, line);
  else if (/^ {4}file: '[^'\n]*',$/m.test(block))
    next = block.replace(/^( {4}file: '[^'\n]*',)$/m, `$1\n${line}`);
  else fail(`${what} "${slot}": entry in ${PHOTO_SLOTS_FILE} has no file line`);
  return src.slice(0, begin) + next + src.slice(end);
}

/** Sets each slot's `pos:` in photo-slots.ts source (see setSlotField). */
export function applyPosOverrides(source, overrides) {
  return overrides.reduce(
    (src, [slot, value]) => setSlotField(src, slot, 'pos', `'${value}'`, 'pos'),
    source,
  );
}

/**
 * Sets each slot's `slides:` (how many photos it shows in turn) in photo-slots.ts source, for the slots the private
 * build rendered from a list of sources. A count of 1 is a still photo: nothing is written.
 */
export function applySlidesOverrides(source, counts) {
  return counts.reduce((src, [slot, n]) => {
    if (!Number.isInteger(n) || n < 1 || n > 6) fail(`slides "${slot}": must be a whole number 1-6`);
    return n === 1 ? src : setSlotField(src, slot, 'slides', String(n), 'slides');
  }, source);
}
