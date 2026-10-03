// src/features/email/templates/E6.tsx — T3.2.U2: E6 "Stand-by" (guest): no link.
import { Mail } from './Mail';

export function E6({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E6" vars={vars} />;
}
