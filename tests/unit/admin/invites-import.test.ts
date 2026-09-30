// T5.1.02 (TSD T5.1 AC2): parseInviteCsv. The import never touches our_things: an our_things column (or any other
// extra column) is refused, every row gets ourThings = [], and any bad row means no rows at all.
import '../../fixtures/unit-env';
import { describe, expect, it, vi } from 'vitest';
import { IMPORT_MAX_ROWS, parseInviteCsv } from '@/features/admin/invites-import';

vi.mock('@/lib/db', () => {
  const noDb = () => {
    throw new Error('no database in this test');
  };
  return { q: vi.fn(noDb), withTx: vi.fn(noDb), pool: vi.fn(noDb) };
});

describe('parseInviteCsv', () => {
  it('maps name, email and dish; email and dish are optional; our_things is always []', () => {
    const { rows, errors } = parseInviteCsv(
      'name,email,dish\r\nDave O\'Brien,dave@example.com,the-long-lunch\r\nZoë,,\r\n"Smith, Ann",ann@example.com,\r\n',
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      name: "Dave O'Brien",
      prefillEmail: 'dave@example.com',
      pickedDish: 'the-long-lunch',
      ourThings: [],
      hopedFor: true,
      isTest: false,
    });
    expect(rows[1]).toMatchObject({ name: 'Zoë', prefillEmail: null, pickedDish: null, ourThings: [] });
    expect(rows[2]).toMatchObject({ name: 'Smith, Ann', ourThings: [] });
    expect(rows.every((r) => r.ourThings.length === 0)).toBe(true);
  });

  it('accepts a name-only header, any column order, a BOM, and skips blank lines', () => {
    expect(parseInviteCsv('﻿name\nAl\n\nBo\n').rows.map((r) => r.name)).toEqual(['Al', 'Bo']);
    const { rows } = parseInviteCsv('Dish,NAME\nthe-flat-white,Cy');
    expect(rows[0]).toMatchObject({ name: 'Cy', pickedDish: 'the-flat-white' });
  });

  it('refuses an our_things column (AC2) and any other extra column, with no rows', () => {
    const r = parseInviteCsv('name,email,dish,our_things\nDave,,,"skiing, pints"\n');
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ line: 1, reason: 'unknown_column:our_things' }]);
    expect(parseInviteCsv('name,note\nDave,hi').errors).toEqual([{ line: 1, reason: 'unknown_column:note' }]);
    expect(parseInviteCsv('name,Our Things\nDave,x').errors[0]!.reason).toBe('unknown_column:our things');
  });

  it('refuses a header without name, or with a duplicate column', () => {
    expect(parseInviteCsv('email\na@example.com').errors).toEqual([
      { line: 1, reason: 'missing_column:name' },
    ]);
    expect(parseInviteCsv('name,name\nA,B').errors).toEqual([{ line: 1, reason: 'duplicate_column:name' }]);
  });

  it('is all-or-nothing: one bad dish means no rows, and the error names its line and column', () => {
    const r = parseInviteCsv('name,dish\nAl,the-long-lunch\nBo,no-such-dish\nCy,\n');
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ line: 3, reason: 'dish:not_bookable' }]);
  });

  it('reports a bad email, a blank name and a wrong column count by line', () => {
    const r = parseInviteCsv('name,email\nAl,not-an-email\n,b@example.com\nCy\nDi,d@example.com,extra\n');
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => [e.line, e.reason.split(':')[0]])).toEqual([
      [2, 'email'],
      [3, 'name'],
      [4, 'wrong_column_count'],
      [5, 'wrong_column_count'],
    ]);
  });

  it('counts lines inside quoted newlines, and refuses an unclosed quote', () => {
    // A newline in a name is a bad character (it would break the copy text's first line); the next record's
    // line number still counts the quoted newline.
    expect(parseInviteCsv('name,dish\n"A\nB",\nCy,nope\n').errors).toEqual([
      { line: 2, reason: 'name:bad_character' },
      { line: 4, reason: 'dish:not_bookable' },
    ]);
    expect(parseInviteCsv('name,dish\n"Al ""the pal""",\n').rows[0]!.name).toBe('Al "the pal"');
    expect(parseInviteCsv('name\n"Al\n').errors).toEqual([{ line: 2, reason: 'unclosed_quote' }]);
  });

  it('refuses an empty file, a header with no rows, and more than the row cap', () => {
    expect(parseInviteCsv('').errors).toEqual([{ line: 1, reason: 'empty_file' }]);
    expect(parseInviteCsv('name\n\n').errors).toEqual([{ line: 1, reason: 'no_rows' }]);
    const big = `name\n${Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `N${i}`).join('\n')}`;
    expect(parseInviteCsv(big)).toEqual({
      rows: [],
      errors: [{ line: IMPORT_MAX_ROWS + 2, reason: `too_many_rows:${IMPORT_MAX_ROWS}` }],
    });
  });
});
