// src/features/email/templates/E13.tsx — T3.2.U2: E13 "New stories" / hourly digest (Jon-facing): one list item per subject, then the admin link.
import { Mail } from './Mail';

export function E13({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E13" vars={vars} lists={['lines']} />;
}
