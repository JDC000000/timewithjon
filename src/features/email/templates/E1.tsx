// src/features/email/templates/E1.tsx — T1.10.U1: E1 "Got it" (guest), a personal note (r6 fix 3): the body, the
// manage link as "Change or cancel" (UX-09 / F20), "Jon", then the no-gifts P.S. without its link (r6 fix 4: the
// "Print the tag" link is E4's now).
import { GUEST_BUTTON, copyFor, fill } from '@/content/emails';
import { Body, Layout, postScriptFor } from './Layout';

export function E1({ vars, tagUrl }: { vars: Record<string, string | number>; tagUrl: string }) {
  // An E1 queued without {times} (before option A) keeps the old body, as the text part does. A row queued before the
  // manage link existed has none.
  const copy = copyFor('E1', vars);
  return (
    <Layout title={fill(copy.subject, vars)} signOff note ps={postScriptFor('E1', tagUrl)}>
      <Body copy={copy.body} vars={vars} lists={['times']} buttons={{ manageLink: GUEST_BUTTON.E1 }} />
    </Layout>
  );
}
