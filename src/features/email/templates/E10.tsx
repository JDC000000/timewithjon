// src/features/email/templates/E10.tsx — T3.2.U2: E10 "Weather call" (guest): the pick link.
import { Mail } from './Mail';

export function E10({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E10" vars={vars} />;
}
