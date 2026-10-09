// QA4 L9: the bidi controls a guest's name may not carry (src/lib/bidi.ts).
import { describe, expect, it } from 'vitest';
import { hasBidiControl, stripBidiControls } from '../bidi';

describe('bidi controls', () => {
  it('finds overrides, embeddings, isolates and the invisible marks', () => {
    for (const c of ['‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩', '‎', '‏', '؜'])
      expect(hasBidiControl(`a${c}b`), c.codePointAt(0)!.toString(16)).toBe(true);
  });
  it('leaves plain names, other scripts and emoji joiners alone', () => {
    for (const ok of ['Zoë O’Brien', 'שרה', 'محمد', '李', '\u{1F468}‍\u{1F469}'])
      expect(hasBidiControl(ok), ok).toBe(false);
  });
  it('strips every one of them', () => {
    expect(stripBidiControls('Sam ‮RTL‬ ⁦x⁩')).toBe('Sam RTL x');
  });
});
