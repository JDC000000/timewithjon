// src/features/email/templates/E8.tsx — T3.2.U2: E8 "About your pitch", too long (guest): the manage link, as a button (EML-03).
import { GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

export function E8({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E8" vars={vars} button={GUEST_BUTTON.E8} />;
}
