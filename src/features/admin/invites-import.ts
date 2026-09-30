// src/features/admin/invites-import.ts — T5.1.02 (TSD T5.1 AC2): Jon's optional CSV invite import.
// Header `name,email,dish` (email and dish optional, any order). Each row becomes one CreateInviteBody input, so
// it goes through the same checks as a hand-made invite (name rules, email shape, bookable dish). The import
// never touches our_things: an `our_things` (or any other extra) column is refused, and every row gets
// ourThings = [] — Jon types those himself in A5. All-or-nothing: any error means no rows (the caller writes none).
import 'server-only';
import { CreateInviteBody, type CreateInviteInput } from './invites';

/** One problem, by 1-based physical line of the file (line 1 is the header). */
export interface ImportError {
  line: number;
  reason: string;
}
export interface ParsedImport {
  rows: CreateInviteInput[];
  errors: ImportError[];
}

const COLUMNS = ['name', 'email', 'dish'] as const;
type Column = (typeof COLUMNS)[number];
/** A hand-kept guest list, not a mailing list. */
export const IMPORT_MAX_ROWS = 500;

interface Rec {
  line: number;
  fields: string[];
}

/**
 * RFC 4180 records: comma-separated, `"` quotes a field, `""` is a literal quote, a quoted field may hold commas
 * and newlines. CRLF or LF. Each record carries the line it starts on. A quote left open is an error.
 */
function records(text: string): { recs: Rec[]; error?: ImportError } {
  const recs: Rec[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  let i = 0;
  const endRecord = () => {
    fields.push(field);
    recs.push({ line: start, fields });
    fields = [];
    field = '';
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      fields.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else field += ch;
    i++;
  }
  if (quoted) return { recs, error: { line: start, reason: 'unclosed_quote' } };
  if (field !== '' || fields.length > 0) endRecord();
  return { recs };
}

/** Zod paths back to the CSV's own column names, so Jon sees `dish:not_bookable` on the line he wrote. */
const FIELD_TO_COLUMN: Record<string, Column> = { name: 'name', prefillEmail: 'email', pickedDish: 'dish' };

const blank = (r: Rec) => r.fields.every((f) => f.trim() === '');

export function parseInviteCsv(text: string): ParsedImport {
  const { recs, error } = records(text.replace(/^﻿/, ''));
  if (error) return { rows: [], errors: [error] };
  const nonBlank = recs.filter((r) => !blank(r));
  const header = nonBlank[0];
  if (!header) return { rows: [], errors: [{ line: 1, reason: 'empty_file' }] };

  const errors: ImportError[] = [];
  const cols = header.fields.map((h) => h.trim().toLowerCase());
  const index = new Map<Column, number>();
  cols.forEach((c, i) => {
    if (!(COLUMNS as readonly string[]).includes(c)) {
      errors.push({ line: header.line, reason: `unknown_column:${c || '(blank)'}` });
    } else if (index.has(c as Column)) {
      errors.push({ line: header.line, reason: `duplicate_column:${c}` });
    } else index.set(c as Column, i);
  });
  if (!index.has('name')) errors.push({ line: header.line, reason: 'missing_column:name' });
  if (errors.length) return { rows: [], errors };

  const data = nonBlank.slice(1);
  if (data.length === 0) return { rows: [], errors: [{ line: header.line, reason: 'no_rows' }] };
  if (data.length > IMPORT_MAX_ROWS) {
    return {
      rows: [],
      errors: [{ line: data[IMPORT_MAX_ROWS]!.line, reason: `too_many_rows:${IMPORT_MAX_ROWS}` }],
    };
  }

  const rows: CreateInviteInput[] = [];
  for (const rec of data) {
    if (rec.fields.length !== cols.length) {
      errors.push({ line: rec.line, reason: 'wrong_column_count' });
      continue;
    }
    const get = (c: Column) => {
      const i = index.get(c);
      const v = i === undefined ? '' : rec.fields[i]!.trim();
      return v === '' ? null : v;
    };
    const parsed = CreateInviteBody.safeParse({
      name: get('name') ?? '',
      prefillEmail: get('email'),
      pickedDish: get('dish'),
      ourThings: [], // never from the file (AC2)
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const col = FIELD_TO_COLUMN[String(issue.path[0])] ?? 'row';
        errors.push({ line: rec.line, reason: `${col}:${issue.message}` });
      }
    } else rows.push(parsed.data);
  }
  return errors.length ? { rows: [], errors } : { rows, errors };
}
