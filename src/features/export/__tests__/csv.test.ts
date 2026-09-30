// T3.10 AC3: stories.csv is UTF-8 with a BOM, RFC 4180 quoted, CRLF; formula-looking cells are defused.
import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../csv';

describe('stories.csv', () => {
  it('starts with the UTF-8 BOM and ends rows with CRLF', () => {
    const csv = toCsv(['a', 'b'], [['x', 1]]);
    expect(Buffer.from(csv, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(csv.slice(1)).toBe('a,b\r\nx,1\r\n');
  });
  it.each([
    ['plain', 'plain'],
    ['a, b', '"a, b"'],
    ['she said "hi"', '"she said ""hi"""'],
    ['two\nlines', '"two\nlines"'],
    ['Zoë & Chloé', 'Zoë & Chloé'],
    [null, ''],
    [true, 'true'],
  ])('%j → %j', (v, want) => expect(csvCell(v)).toBe(want));
  it.each(['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)', '\tx', '\rx'])('defuses the formula %j', (v) => {
    expect(csvCell(v).replace(/^"/, '')).toMatch(/^'/);
  });
  it('leaves a formula character in the middle alone', () => expect(csvCell('a=b')).toBe('a=b'));
});
