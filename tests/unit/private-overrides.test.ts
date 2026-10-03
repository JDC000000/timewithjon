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
  TEXT_FILES,
} from '../../scripts/private-overrides.mjs';
import { PHOTO_SLOTS } from '../../src/ui/photo-slots';

const MENU = 'src/content/menu.ts';
const SLOTS_SRC = readFileSync(new URL('../../src/ui/photo-slots.ts', import.meta.url), 'utf8');

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
    const src = { [MENU]: 'Alpha Gamma' };
    const out = applyTextOverrides(src, parseTextOverrides({ Alpha: 'Beta', Gamma: 'Delta' }));
    expect(out[MENU]).toBe('Beta Delta');
  });

  it.each([
    ['missing', 'Gamma Gamma', 'Alpha', /occurs 0 times/],
    ['twice', 'Alpha and Alpha', 'Alpha', /occurs 2 times/],
    ['case-different', 'alpha', 'Alpha', /occurs 0 times/],
  ])('fails closed when the find string is %s', (_, file, find, err) => {
    expect(() => applyTextOverrides({ [MENU]: file }, parseTextOverrides({ [find]: 'Beta' }))).toThrow(err);
  });

  it('refuses a file outside the allow-list', () => {
    for (const file of ['src/content/landing.ts', '../menu.ts', 'next.config.ts', '/etc/passwd', undefined])
      expect(() => parseTextOverrides([{ file, find: 'Alpha', replace: 'Beta' }])).toThrow(/allow-list/);
  });

  it.each(['<b>Beta</b>', 'Be`ta', "Be'ta", 'Be"ta', 'Be\\ta', 'Be\nta', 'Be\rta', 'Be\u2028ta'])(
    'refuses a replacement holding %j',
    (replace) => {
      expect(() => parseTextOverrides({ Alpha: replace })).toThrow(/forbidden character/);
    },
  );

  it('accepts typographic quotes in a replacement', () => {
    expect(parseTextOverrides({ Alpha: 'Beta’s “Gamma”' })[0]!.replace).toBe('Beta’s “Gamma”');
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
