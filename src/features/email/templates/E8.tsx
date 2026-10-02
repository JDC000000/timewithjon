// src/features/email/templates/E8.tsx — T3.2.U2: E8 "About your pitch", too long (guest): the manage link.
import { Mail } from './Mail';

export function E8({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E8" vars={vars} />;
}
