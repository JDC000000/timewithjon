import { describe, expect, it } from 'vitest';
import { splitWhole } from '@/ui/keep-whole';

describe('splitWhole (VD5-03, VD7-07)', () => {
  it('keeps a week caption and a time whole, with a break before a date that follows a space', () => {
    expect(splitWhole('Apr 1–2')).toEqual([{ text: 'Apr 1–2', whole: true }]);
    expect(splitWhole('2 hr · Thu/Fri, noon–2 pm · serves 1–15')).toEqual([
      { text: '2 hr · Thu/Fri, ', whole: false },
      { text: 'noon–2 pm', whole: true, wbr: true },
      { text: ' · serves ', whole: false },
      { text: '1–15', whole: true, wbr: true },
    ]);
  });
  it('pr73 F7: am/pm on both ends, a comma after the weekday, "Sept", and a bare range stay whole', () => {
    expect(splitWhole('11 am–2 pm')).toEqual([{ text: '11 am–2 pm', whole: true }]);
    expect(splitWhole('7:30–9 pm')).toEqual([{ text: '7:30–9 pm', whole: true }]);
    expect(splitWhole('Fri, May 14')).toEqual([{ text: 'May 14', whole: true, weekday: 'Fri, ' }]);
    expect(splitWhole('Sept 14')).toEqual([{ text: 'Sept 14', whole: true }]);
    expect(splitWhole('Sep 14')).toEqual([{ text: 'Sep 14', whole: true }]);
    // INT-04 (#86): the dish detail "Thu/Fri, 12–2" broke after the dash in WebKit at 320 px / 200 %
    expect(splitWhole('Thu/Fri, 12–2')).toEqual([
      { text: 'Thu/Fri, ', whole: false },
      { text: '12–2', whole: true, wbr: true },
    ]);
  });
  it('a bare range is not glued to longer numbers, and am/pm ranges win over the bare form', () => {
    expect(splitWhole('2026–2027').every((p) => !p.whole)).toBe(true);
    expect(splitWhole('from 12–2 pm on')).toEqual([
      { text: 'from ', whole: false },
      { text: '12–2 pm', whole: true, wbr: true },
      { text: ' on', whole: false },
    ]);
    expect(splitWhole('at 7 pm')).toEqual([
      { text: 'at ', whole: false },
      { text: '7 pm', whole: true, wbr: true },
    ]);
  });
  it('lets only the weekday part from its date', () => {
    expect(splitWhole('Thu May 6 · 7 pm')).toEqual([
      { text: 'May 6', whole: true, weekday: 'Thu ' },
      { text: ' · ', whole: false },
      { text: '7 pm', whole: true, wbr: true },
    ]);
  });
  it('keeps a run caption as two whole ranges, and a range across months whole', () => {
    expect(
      splitWhole('Jun 3–4 to Jun 17–18')
        .filter((p) => p.whole)
        .map((p) => p.text),
    ).toEqual(['Jun 3–4', 'Jun 17–18']);
    expect(splitWhole('Apr 29–May 1')).toEqual([{ text: 'Apr 29–May 1', whole: true }]);
  });
  it('leaves text without dates alone', () => {
    expect(splitWhole("That week's spoken for.")).toEqual([
      { text: "That week's spoken for.", whole: false },
    ]);
    expect(splitWhole('')).toEqual([]);
  });
});
