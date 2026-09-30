// src/lib/honeypot.ts — AD-9: the one honeypot field every public form carries (T3.8.03).
// A filled honeypot is STORED as spam_suspect (quiet "Check these" tab, no emails), never refused: autofill can
// never silently turn a real guest away. The guest always sees the normal success answer.
import { z } from 'zod';

/** The JSON body key. The form input gets a nonsense name, autocomplete="off", tabindex="-1", aria-hidden. */
// Review F2: an oversize value is never a 400 (a bot would learn the field is checked): it parses as 'overflow',
// counts as filled and gets the same success answer.
export const honeypotField = z.string().max(200).optional().catch('overflow');

export function isHoneypotFilled(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}
