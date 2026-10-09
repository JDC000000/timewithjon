// src/features/email/templates/E7.tsx — T3.2.U2: E7 "Just opened up" (guest): the take link, as a button (EML-03).
import { GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

export function E7({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E7" vars={vars} button={GUEST_BUTTON.E7} />;
}
