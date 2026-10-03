// src/features/email/templates/E9.tsx — T3.2.U2: E9 "About your pitch", no (guest): the menu link.
import { Mail } from './Mail';

export function E9({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E9" vars={vars} />;
}
