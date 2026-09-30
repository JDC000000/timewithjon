// src/features/export/csv.ts — T3.10 AC3: stories.csv is UTF-8 with a BOM (so Excel on Windows reads accents),
// RFC 4180 quoting and CRLF rows. Guests typed these cells, so one that starts like a spreadsheet formula gets a
// leading apostrophe (OWASP CSV injection): Jon opens this file in Excel or Numbers.
export const CSV_BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvValue = string | number | boolean | null;

export function csvCell(value: CsvValue): string {
  let s = value === null ? '' : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  return CSV_BOM + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
