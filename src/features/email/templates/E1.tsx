// src/features/email/templates/E1.tsx — T1.10.U1: E1 "Got it" (guest). The body, "Jon", then the no-gifts P.S.
import { E1_NO_TIMES_BODY, EMAIL_COPY, POSTSCRIPT, fill } from '@/content/emails';
import { Body, Layout } from './Layout';

export function E1({ vars, tagUrl }: { vars: Record<string, string | number>; tagUrl: string }) {
  // An E1 queued without {times} (before option A) keeps the old body, as the text part does.
  const copy = vars.times ? EMAIL_COPY.E1.body : E1_NO_TIMES_BODY;
  const ps = POSTSCRIPT.E1!;
  return (
    <Layout
      title={fill(EMAIL_COPY.E1.subject, vars)}
      signOff
      ps={{ mark: ps.mark, text: ps.text, linkLabel: ps.printTag, href: tagUrl }}
    >
      <Body copy={copy} vars={vars} lists={['times']} />
    </Layout>
  );
}
