// src/features/email/templates/E16.tsx — T3.2.U2: E16 "Updated" (Jon-facing): the request page link is the E2 button.
import { E2_BUTTON } from './E2';
import { Mail } from './Mail';

export function E16({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E16" vars={vars} button={E2_BUTTON} />;
}
