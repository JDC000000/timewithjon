// src/lib/bidi.ts — QA4 L9: bidi control characters (embeddings, overrides, isolates and the invisible marks) let a
// name re-order the text around it: "RTL" typed after U+202E reads "LTR" in admin. Invite names already refuse them
// (features/admin/invites.ts BAD_NAME_CHAR); a guest's own name box drops them as typed and the API refuses them.
// Emoji joiners (U+200D) are not bidi controls and stay.
export const BIDI_CONTROL = /[؜‎‏‪-‮⁦-⁩]/u;
const BIDI_CONTROL_ALL = new RegExp(BIDI_CONTROL.source, 'gu');

export function hasBidiControl(s: string): boolean {
  return BIDI_CONTROL.test(s);
}

export function stripBidiControls(s: string): string {
  return s.replace(BIDI_CONTROL_ALL, '');
}
