// src/features/email/templates/E1.tsx — T1.10.U1: E1 "Got it" (guest). The body, "Jon", then the no-gifts P.S.
import { GUEST_BUTTON, POSTSCRIPT, copyFor, fill } from '@/content/emails';
import { Body, Layout } from './Layout';

export function E1({ vars, tagUrl }: { vars: Record<string, string | number>; tagUrl: string }) {
  // An E1 queued without {times} (before option A) keeps the old body, as the text part does. UX-09: the manage
  // link is a "Change or cancel" button (F20); a row queued before it had one has none.
  const copy = copyFor('E1', vars);
  const ps = POSTSCRIPT.E1!;
  return (
    <Layout
      title={fill(copy.subject, vars)}
      signOff
      ps={{ mark: ps.mark, text: ps.text, linkLabel: ps.printTag, href: tagUrl }}
    >
      <Body copy={copy.body} vars={vars} lists={['times']} buttons={{ manageLink: GUEST_BUTTON.E1 }} />
    </Layout>
  );
}
