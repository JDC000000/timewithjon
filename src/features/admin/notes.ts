// src/features/admin/notes.ts — T2.8.01: Jon's two private notes on a request (TSD T2.8, §6 request.before60_note,
// request.jon_note), autosaved from A3. Only the fields sent are written, so the two autosaves never overwrite
// each other. A note is not a reply to the guest, so it leaves awaiting_jon_since alone (the request stays in
// Needs a reply). Server-only; every caller has passed requireAdmin().
import 'server-only';
import { z } from 'zod';
import { q } from '@/lib/db';
import { CONTROL_EXCEPT_NEWLINES } from '@/features/requests/schema';

export const NOTE_MAX = 2000;

/** Blank (after trimming) clears the note: null in the database. A NUL or other control character (not tab/LF/CR)
 * is a 400 here: Postgres would refuse NUL in text with a 500 (pr45 R1). */
const Note = z
  .string()
  .max(NOTE_MAX)
  .refine((s) => !CONTROL_EXCEPT_NEWLINES.test(s), 'control_character')
  .transform((s) => (s.trim() === '' ? null : s))
  .nullable();

export const NotesPatch = z
  .strictObject({ before60Note: Note.optional(), jonNote: Note.optional() })
  .refine((p) => p.before60Note !== undefined || p.jonNote !== undefined);
export type NotesPatch = z.output<typeof NotesPatch>;

export interface RequestNotes {
  before60Note: string | null;
  jonNote: string | null;
}

const COLUMN = { before60Note: 'before60_note', jonNote: 'jon_note' } as const;

/** Returns the saved notes, or null when there is no such request. */
export async function updateNotes(id: string, patch: NotesPatch): Promise<RequestNotes | null> {
  const keys = (Object.keys(COLUMN) as (keyof typeof COLUMN)[]).filter((k) => patch[k] !== undefined);
  const [row] = await q<{ before60_note: string | null; jon_note: string | null }>(
    `update request set ${keys.map((k, i) => `${COLUMN[k]} = $${i + 2}`).join(', ')}
      where id = $1 returning before60_note, jon_note`,
    [id, ...keys.map((k) => patch[k])],
  );
  return row ? { before60Note: row.before60_note, jonNote: row.jon_note } : null;
}
