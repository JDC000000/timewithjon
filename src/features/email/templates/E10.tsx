// src/features/email/templates/E10.tsx — T3.2.U2: E10 "Weather call" (guest): the pick link, as a button (EML-03).
import { GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

export function E10({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E10" vars={vars} button={GUEST_BUTTON.E10} />;
}
