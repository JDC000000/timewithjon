// src/features/email/templates/E4.tsx — T3.2.U2: E4 "Locked in" (guest): the manage link as "Change or cancel", then
// "Jon" and the no-gifts P.S. with its "Print the tag" link (moved here from E1, r6 fix 4).
import { GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';
import { postScriptFor } from './Layout';

export function E4({ vars, tagUrl }: { vars: Record<string, string | number>; tagUrl: string }) {
  return <Mail id="E4" vars={vars} button={GUEST_BUTTON.E4} ps={postScriptFor('E4', tagUrl)} />;
}
