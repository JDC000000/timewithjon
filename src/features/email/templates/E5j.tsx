// src/features/email/templates/E5j.tsx — T3.2.U2: E5j "About {dish}" (joined guest): never names the host; the
// manage link as a "Change or cancel" button, "Or just call me." under it (r6 Q4).
import { GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

export function E5j({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E5j" vars={vars} button={GUEST_BUTTON.E5j} />;
}
