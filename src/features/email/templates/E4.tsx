// src/features/email/templates/E4.tsx — T3.2.U2: E4 "Locked in" (guest): the manage link, as a button (EML-03).
import { GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

export function E4({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E4" vars={vars} button={GUEST_BUTTON.E4} />;
}
