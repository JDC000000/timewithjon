// src/features/email/templates/E2.tsx — T1.10.U1: E2 "New request" (Jon-facing, from admin@: no sign-off, as the
// text part). The admin link is a button that opens the request page (N2).
import { EMAIL_COPY, fill } from '@/content/emails';
import { Body, Layout } from './Layout';

export const E2_BUTTON = 'Open the request';

export function E2({ vars }: { vars: Record<string, string | number> }) {
  return (
    <Layout title={fill(EMAIL_COPY.E2.subject, vars)} signOff={false}>
      <Body copy={EMAIL_COPY.E2.body} vars={vars} buttons={{ adminLink: E2_BUTTON }} />
    </Layout>
  );
}
