// docs/PHOTOS.md: the private build's text and focal-point overrides (scripts/private-overrides.mjs, applied by
// scripts/fetch-real-photos.mjs). Dummy strings only: the real private values never enter the repo.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyPosOverrides,
  applyTextOverrides,
  DEFAULT_TEXT_FILE,
  parsePosOverrides,
  parseTextOverrides,
  singleQuotedSpans,
  TEXT_FILES,
} from '../../scripts/private-overrides.mjs';
import { PHOTO_SLOTS } from '../../src/ui/photo-slots';

const MENU = 'src/content/menu.ts';
const SLOTS_SRC = readFileSync(new URL('../../src/ui/photo-slots.ts', import.meta.url), 'utf8');
const MENU_SRC = readFileSync(new URL('../../src/content/menu.ts', import.meta.url), 'utf8');

describe('text overrides', () => {
  it('allow-lists the menu copy only', () => {
    expect(TEXT_FILES).toEqual([MENU]);
    expect(DEFAULT_TEXT_FILE).toBe(MENU);
  });

  it('takes the object form (the menu) and the list form', () => {
    expect(parseTextOverrides({ Alpha: 'Beta' })).toEqual([{ file: MENU, find: 'Alpha', replace: 'Beta' }]);
    expect(parseTextOverrides([{ file: MENU, find: 'Alpha', replace: 'Beta' }])).toEqual([
      { file: MENU, find: 'Alpha', replace: 'Beta' },
    ]);
    expect(parseTextOverrides(undefined)).toEqual([]);
  });

  it('replaces an exact string that occurs exactly once, and touches nothing else', () => {
    const src = { [MENU]: "line: 'Alpha and me.',\nother: 'Gamma',\n" };
    const out = applyTextOverrides(src, parseTextOverrides({ Alpha: 'Beta' }));
    expect(out).toEqual({ [MENU]: "line: 'Beta and me.',\nother: 'Gamma',\n" });
  });

  it('applies several overrides in order to the same file', () => {
    const src = { [MENU]: "a: 'Alpha Gamma'," };
    const out = applyTextOverrides(src, parseTextOverrides({ Alpha: 'Beta', Gamma: 'Delta' }));
    expect(out[MENU]).toBe("a: 'Beta Delta',");
  });

  it.each([
    ['missing', "a: 'Gamma Gamma',", 'Alpha', /occurs 0 times/],
    ['twice', "a: 'Alpha and Alpha',", 'Alpha', /occurs 2 times/],
    ['case-different', "a: 'alpha',", 'Alpha', /occurs 0 times/],
  ])('fails closed when the find string is %s', (_, file, find, err) => {
    expect(() => applyTextOverrides({ [MENU]: file }, parseTextOverrides({ [find]: 'Beta' }))).toThrow(err);
  });

  it('refuses a file outside the allow-list', () => {
    for (const file of ['src/content/landing.ts', '../menu.ts', 'next.config.ts', '/etc/passwd', undefined])
      expect(() => parseTextOverrides([{ file, find: 'Alpha', replace: 'Beta' }])).toThrow(/allow-list/);
  });

  it.each([
    '<b>Beta</b>',
    'Be>ta',
    'Be`ta',
    "Be'ta",
    'Be"ta',
    'Be\\ta',
    'Be\nta',
    'Be\rta',
    'Be\u2028ta',
    'Be\tta',
    '${Beta}',
    'Beta{}',
    'Be/ta',
    'Beta=1',
    'Beta+Gamma',
    'Be[t]a',
    'Beta & Gamma',
    'Beta#',
  ])('refuses a replacement holding %j', (replace) => {
    expect(() => parseTextOverrides({ Alpha: replace })).toThrow(/replace holds a forbidden character/);
  });

  it.each(["Al'pha", 'Al"pha', 'Al<pha', 'Al\\pha', 'Al${pha}', 'Al\npha'])(
    'refuses a find holding %j',
    (find) => {
      expect(() => parseTextOverrides({ [find]: 'Beta' })).toThrow(/find holds a forbidden character/);
    },
  );

  it('accepts plain copy: letters, accents, digits and the copy punctuation', () => {
    const copy = 'Zoë, Renée and me (2 of us): one more… “Yes!” – right? Jon’s ‘best’ — fine; ok-ish.';
    expect(parseTextOverrides({ Alpha: copy })[0]!.replace).toBe(copy);
  });

  it('accepts typographic quotes in a replacement', () => {
    expect(parseTextOverrides({ Alpha: 'Beta’s “Gamma”' })[0]!.replace).toBe('Beta’s “Gamma”');
  });

  it('a find at the start of a longer menu line works on the real menu file, and only that string changes', () => {
    const find = 'Jane Doe and me, you and yours.';
    const out = applyTextOverrides(
      { [MENU]: MENU_SRC },
      parseTextOverrides({ [find]: 'Sam and me, you and yours.' }),
    );
    const changed = out[MENU]!.split('\n');
    const before = MENU_SRC.split('\n');
    const diff = changed.filter((l, i) => l !== before[i]);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatch(/^ +line: 'Sam and me, you and yours\. A table for four/);
  });

  it.each([
    ['code, not a string', "const Alpha = 1;\na: 'Gamma',", 'Alpha'],
    ['a key name', "Alpha: 'Gamma',", 'Alpha'],
    ['a double-quoted string', 'a: "Alpha",', 'Alpha'],
    ['a template literal', 'a: `Alpha`,', 'Alpha'],
    ['a line comment', "a: 'Gamma', // Alpha", 'Alpha'],
    ['a block comment', "/* Alpha */ a: 'Gamma',", 'Alpha'],
    ['an unclosed string', "a: 'Alpha", 'Alpha'],
  ])('fails closed when the find string is in %s', (_, file, find) => {
    expect(() => applyTextOverrides({ [MENU]: file }, parseTextOverrides({ [find]: 'Beta' }))).toThrow(
      /inside one quoted string|forbidden character/,
    );
  });

  it('reads the single-quoted strings of a line', () => {
    expect(singleQuotedSpans("a: 'Al', b: 'Be\\'ta', // 'x'")).toEqual([
      [4, 6],
      [13, 19],
    ]);
    expect(singleQuotedSpans('a: "Al"')).toEqual([]);
    expect(singleQuotedSpans("a: 'Al")).toBeNull();
    expect(singleQuotedSpans('a: `Al`')).toBeNull();
    expect(singleQuotedSpans("a: x / 2, 'Al'")).toBeNull();
  });

  it('refuses malformed entries', () => {
    expect(() => parseTextOverrides('Alpha')).toThrow(/object or a list/);
    expect(() => parseTextOverrides({ Alpha: 42 })).toThrow(/replace/);
    expect(() => parseTextOverrides({ Alpha: '' })).toThrow(/replace/);
    expect(() => parseTextOverrides([{ file: MENU, find: '', replace: 'Beta' }])).toThrow(/find/);
    expect(() => parseTextOverrides(['Alpha'])).toThrow(/must be an object/);
  });

  it('never puts the replacement text in an error', () => {
    const secret = 'Zeta-private-words';
    try {
      applyTextOverrides({ [MENU]: 'nothing here' }, parseTextOverrides({ Alpha: secret }));
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(secret);
    }
  });
});

describe('focal-point (pos) overrides', () => {
  it('validates the value: two whole percents, 0 to 100', () => {
    expect(parsePosOverrides({ grind: '50% 20%', hero: '0% 100%' })).toEqual([
      ['grind', '50% 20%'],
      ['hero', '0% 100%'],
    ]);
    for (const bad of [
      '50%',
      '50% 20',
      'center top',
      '50%  20%',
      '50.5% 20%',
      '1000% 0%',
      '101% 0%',
      '-5% 0%',
      3,
    ])
      expect(() => parsePosOverrides({ grind: bad })).toThrow(/x% y%/);
    expect(() => parsePosOverrides(['grind'])).toThrow(/object/);
    expect(parsePosOverrides(undefined)).toEqual([]);
  });

  it('adds a pos to an existing slot, quoted and unquoted keys alike, and nothing else changes', () => {
    const out = applyPosOverrides(
      SLOTS_SRC,
      parsePosOverrides({ 'first-round': '50% 20%', grind: '40% 0%' }),
    );
    expect(out).toContain("  'first-round': {\n    file: 'first-round',\n    pos: '50% 20%',\n");
    expect(out).toContain("  grind: {\n    file: 'grind',\n    pos: '40% 0%',\n");
    const added = out.split('\n').filter((l) => !SLOTS_SRC.split('\n').includes(l));
    expect(added).toEqual(["    pos: '50% 20%',", "    pos: '40% 0%',"]);
  });

  it('replaces a pos that is already set', () => {
    const once = applyPosOverrides(SLOTS_SRC, [['encore', '10% 10%']]);
    const twice = applyPosOverrides(once, [['encore', '60% 30%']]);
    expect(twice).toContain("  encore: {\n    file: 'encore',\n    pos: '60% 30%',\n");
    expect(twice).not.toContain('10% 10%');
  });

  it('fails closed on a slot that does not exist', () => {
    for (const slot of ['no-such-slot', 'first', 'Hero', 'file', '__proto__'])
      expect(() => applyPosOverrides(SLOTS_SRC, [[slot, '50% 50%']])).toThrow(/no such slot|not a slot name/);
  });

  it('every slot in PHOTO_SLOTS can take a pos', () => {
    const all = Object.keys(PHOTO_SLOTS).map((s) => [s, '50% 50%'] as const);
    const out = applyPosOverrides(SLOTS_SRC, all);
    expect(out.match(/^ {4}pos: '50% 50%',$/gm)).toHaveLength(all.length);
  });
});
