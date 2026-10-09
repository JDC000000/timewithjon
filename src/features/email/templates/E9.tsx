// src/features/email/templates/E9.tsx — T3.2.U2: E9 "About your pitch", no (guest): the menu link, as a button (EML-03).
import { GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

export function E9({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E9" vars={vars} button={GUEST_BUTTON.E9} />;
}
