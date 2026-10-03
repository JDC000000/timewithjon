// src/features/email/templates/Mail.tsx — T3.2.U2: one template's HTML on the #107 Layout. The copy is the text
// part's (EMAIL_COPY, src/content); Jon-facing templates have no "Jon" sign-off, as the text part. The closing
// `{…Link}` line is a Button when a label for its page already exists in src/content (no new copy), otherwise a
// plain link that shows the URL, as the text part does. An empty link var (E5b with no offer) draws nothing.
import { EMAIL_COPY, JON_FACING, fill, type TemplateId } from '@/content/emails';
import { Body, Button, INK, Layout } from './Layout';

type Vars = Record<string, string | number>;
const LINK_LINE = /^\{(\w+Link)\}$/;

export function Mail({
  id,
  vars,
  copy = EMAIL_COPY[id].body,
  lists = [],
  button,
}: {
  id: TemplateId;
  vars: Vars;
  /** The body copy; defaults to EMAIL_COPY[id].body (E5b passes it with its times drawn as a list). */
  copy?: string;
  lists?: string[];
  /** The button label for the link line; none = a plain link. */
  button?: string;
}) {
  const lines = copy.split('\n');
  const linkVar = LINK_LINE.exec(lines.at(-1)!.trim())?.[1];
  const href = linkVar ? String(vars[linkVar] ?? '') : '';
  const body = linkVar ? lines.slice(0, -1).join('\n') : copy;
  return (
    <Layout title={fill(EMAIL_COPY[id].subject, vars)} signOff={!JON_FACING.includes(id)}>
      <Body copy={body} vars={vars} lists={lists} />
      {href &&
        (button ? (
          <Button href={href}>{button}</Button>
        ) : (
          <p style={{ margin: '16px 0 0', wordBreak: 'break-all' }}>
            <a href={href} style={{ color: INK, textDecoration: 'underline' }}>
              {href}
            </a>
          </p>
        ))}
    </Layout>
  );
}
