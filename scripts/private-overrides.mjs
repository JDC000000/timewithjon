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

/** The copy sits inside single-quoted TS strings and the pack sets quotes typographically (’ “ ”): a replacement
 *  may not hold markup, a template or string delimiter, an escape or a line break. */
const UNSAFE_REPLACEMENT = /[<`'"\\\r\n\u2028\u2029]/;

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
    if (UNSAFE_REPLACEMENT.test(replace)) fail(`text #${i + 1}: replace holds a forbidden character`);
    return { file, find, replace };
  });
}

function countOf(haystack, needle) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

/**
 * Applies the overrides in order to `sources` ({ [file]: contents }), returning the changed files only. Each find
 * string must occur exactly once in its file (as the file stands after the earlier overrides).
 */
export function applyTextOverrides(sources, overrides) {
  const out = {};
  overrides.forEach(({ file, find, replace }, i) => {
    const src = out[file] ?? sources[file];
    if (typeof src !== 'string') fail(`text #${i + 1}: ${file} was not read`);
    const n = countOf(src, find);
    if (n !== 1) fail(`text #${i + 1}: find string occurs ${n} times in ${file} (expected exactly 1)`);
    const at = src.indexOf(find);
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
 * Sets each slot's `pos:` in photo-slots.ts source (replacing an existing one, or adding one after `file:`).
 * The slot must already exist as a top-level entry of PHOTO_SLOTS, exactly once.
 */
export function applyPosOverrides(source, overrides) {
  let src = source;
  for (const [slot, value] of overrides) {
    if (!/^[a-z0-9-]+$/.test(slot)) fail(`pos "${slot}": not a slot name`);
    const key = new RegExp(`^ {2}(?:'${escapeRe(slot)}'|${escapeRe(slot)}): \\{$`, 'gm');
    const starts = [...src.matchAll(key)];
    if (starts.length !== 1) fail(`pos "${slot}": no such slot in ${PHOTO_SLOTS_FILE}`);
    const begin = starts[0].index + starts[0][0].length;
    const end = src.indexOf('\n  },', begin);
    if (end === -1) fail(`pos "${slot}": entry in ${PHOTO_SLOTS_FILE} is not closed`);
    const block = src.slice(begin, end);
    const line = `    pos: '${value}',`;
    let next;
    if (/^ {4}pos: '[^'\n]*',$/m.test(block)) next = block.replace(/^ {4}pos: '[^'\n]*',$/m, line);
    else if (/^ {4}file: '[^'\n]*',$/m.test(block))
      next = block.replace(/^( {4}file: '[^'\n]*',)$/m, `$1\n${line}`);
    else fail(`pos "${slot}": entry in ${PHOTO_SLOTS_FILE} has no file line`);
    src = src.slice(0, begin) + next + src.slice(end);
  }
  return src;
}
