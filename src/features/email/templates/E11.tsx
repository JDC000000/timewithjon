// src/features/email/templates/E11.tsx — T3.2.U2: E11 "Cancelled, no guilt" (guest): no link.
import { Mail } from './Mail';

export function E11({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E11" vars={vars} />;
}
