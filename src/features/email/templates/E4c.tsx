// src/features/email/templates/E4c.tsx — T3.2.U2: E4c "Calendar update" (guest): the .ics lead line; the .ics is an attachment, not a link.
import { Mail } from './Mail';

export function E4c({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E4c" vars={vars} />;
}
