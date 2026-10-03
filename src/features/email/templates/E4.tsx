// src/features/email/templates/E4.tsx — T3.2.U2: E4 "Locked in" (guest): the manage link, shown as the text part shows it.
import { Mail } from './Mail';

export function E4({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E4" vars={vars} />;
}
