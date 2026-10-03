// src/features/email/templates/E12.tsx — T3.2.U2: E12 "Cancelled" (Jon-facing): the request page link is the E2 button.
import { E2_BUTTON } from './E2';
import { Mail } from './Mail';

export function E12({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E12" vars={vars} button={E2_BUTTON} />;
}
