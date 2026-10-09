// src/features/email/templates/Mail.tsx — T3.2.U2: one template's HTML on the #107 Layout. The copy is the text
// part's (copyFor, src/content); Jon-facing templates have no "Jon" sign-off, as the text part. The closing
// `{…Link}` line is a Button with its label from src/content (EML-03: a guest's long token URL is never shown
// bare; the text part keeps the URL on its own line). An empty link var (E5b with no offer) draws nothing.
import { JON_FACING, copyFor, fill, type TemplateId } from '@/content/emails';
import { Body, Button, Layout } from './Layout';

type Vars = Record<string, string | number>;
const LINK_LINE = /^\{(\w+Link)\}$/;

/** A link line with no button label: a template bug, caught by the render tests, never a bare URL in the mail. */
export class MissingButtonLabelError extends Error {
  override name = 'MissingButtonLabelError';
}

export function Mail({
  id,
  vars,
  copy = copyFor(id, vars).body,
  lists = [],
  button,
}: {
  id: TemplateId;
  vars: Vars;
  /** The body copy; defaults to copyFor(id, vars).body (E5b passes it with its times drawn as a list). */
  copy?: string;
  lists?: string[];
  /** The button label for the link line (required when the copy ends in one). */
  button?: string;
}) {
  const lines = copy.split('\n');
  const linkVar = LINK_LINE.exec(lines.at(-1)!.trim())?.[1];
  const href = linkVar ? String(vars[linkVar] ?? '') : '';
  const body = linkVar ? lines.slice(0, -1).join('\n') : copy;
  if (href && !button) throw new MissingButtonLabelError(id);
  return (
    <Layout title={fill(copyFor(id, vars).subject, vars)} signOff={!JON_FACING.includes(id)}>
      <Body copy={body} vars={vars} lists={lists} />
      {href && <Button href={href}>{button}</Button>}
    </Layout>
  );
}
