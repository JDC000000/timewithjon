// src/features/email/templates/E7.tsx — T3.2.U2: E7 "Just opened up" (guest): the take link.
import { Mail } from './Mail';

export function E7({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E7" vars={vars} />;
}
