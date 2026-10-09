// src/features/email/templates/E17.tsx — QA r2 M5 (T2.9): E17 "I’m booked on that day" (guest), sent when Jon
// cancels for the guest (A3); the guest's own cancel keeps E11. No link: the guest replies with other times.
import { GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

export function E17({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E17" vars={vars} button={GUEST_BUTTON.E17} />;
}
