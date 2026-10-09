// src/features/email/templates/E13.tsx — T3.2.U2: E13 "New stories" / hourly digest (Jon-facing): one list item per
// line, then the admin link as a button. The text part's lines start "- "; the list draws its own bullet, so the
// "- " is left out here (EML-09). The daily digest opens Stories, the hourly one the requests inbox (EML-10).
import { ADMIN_SHELL } from '@/content/ui/foundation';
import { Mail } from './Mail';

export function E13({ vars }: { vars: Record<string, string | number> }) {
  const lines = String(vars.lines ?? '')
    .split('\n')
    .map((l) => l.replace(/^- /, ''))
    .join('\n');
  const button = vars.digest === 'hourly' ? ADMIN_SHELL.nav.requests : ADMIN_SHELL.nav.stories;
  return <Mail id="E13" vars={{ ...vars, lines }} lists={['lines']} button={button} />;
}
