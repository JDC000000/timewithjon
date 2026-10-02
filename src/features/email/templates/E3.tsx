// src/features/email/templates/E3.tsx — T3.2.U2: E3 "Still waiting" (Jon-facing): the request page link is the E2 button.
import { E2_BUTTON } from './E2';
import { Mail } from './Mail';

export function E3({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E3" vars={vars} button={E2_BUTTON} />;
}
