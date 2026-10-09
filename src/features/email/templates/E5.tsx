// src/features/email/templates/E5.tsx — T3.2.U2: E5 "Another time" (guest): the open times as a list, then the take link as a button (EML-03).
import { GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

export function E5({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E5" vars={vars} lists={['times']} button={GUEST_BUTTON.E5} />;
}
