// src/features/email/templates/E6.tsx — T3.2.U2: E6 "Stand-by" (guest): the manage link as a "Change or cancel"
// button, "Or just call me." under it (r6 Q4).
import { GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

export function E6({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E6" vars={vars} button={GUEST_BUTTON.E6} />;
}
