// src/features/email/templates/E5j.tsx — T3.2.U2: E5j "About {dish}" (joined guest): no link, never names the host.
import { Mail } from './Mail';

export function E5j({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E5j" vars={vars} />;
}
