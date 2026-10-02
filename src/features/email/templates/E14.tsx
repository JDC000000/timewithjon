// src/features/email/templates/E14.tsx — T3.2.U2: E14 "Google connection problem" (Jon-facing): the Settings link is a button with the admin shell label.
import { ADMIN_SHELL } from '@/content/ui/foundation';
import { Mail } from './Mail';

export function E14({ vars }: { vars: Record<string, string | number> }) {
  return <Mail id="E14" vars={vars} button={ADMIN_SHELL.settings} />;
}
