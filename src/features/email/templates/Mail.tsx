// src/features/email/templates/Mail.tsx — T3.2.U2: one template's HTML on the #107 Layout. The copy is the text
// part's (copyFor, src/content); Jon-facing templates have no "Jon" sign-off, as the text part. The closing
// `{…Link}` line is a Button with its label from src/content (EML-03: a guest's long token URL is never shown
// bare; the text part keeps the URL on its own line). An empty link var (E5b with no offer) draws nothing. A line
// after the link line (E6's and E5j's "Or just call me.", r6 Q4) is a small note under the button.
import { JON_FACING, copyFor, fill, type TemplateId } from '@/content/emails';
import { Body, Button, INK_2, Layout, type PostScript } from './Layout';

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
  ps,
}: {
  id: TemplateId;
  vars: Vars;
  /** The body copy; defaults to copyFor(id, vars).body (E5b passes it with its times drawn as a list). */
  copy?: string;
  lists?: string[];
  /** The button label for the link line (required when the copy ends in one). */
  button?: string;
  /** A P.S. under the sign-off (E4's no-gifts P.S. with the tag link, r6 fix 4). */
  ps?: PostScript;
}) {
  const lines = copy.split('\n');
  const at = lines.map((l) => LINK_LINE.test(l.trim())).lastIndexOf(true);
  const linkVar = at >= 0 ? LINK_LINE.exec(lines[at]!.trim())?.[1] : undefined;
  const href = linkVar ? String(vars[linkVar] ?? '') : '';
  const body = at >= 0 ? lines.slice(0, at).join('\n') : copy;
  const notes = at >= 0 ? lines.slice(at + 1).filter((l) => l.trim()) : [];
  if (href && !button) throw new MissingButtonLabelError(id);
  const guest = !JON_FACING.includes(id); // every guest email is a personal note (r6 fix 3); Jon's keep the card
  return (
    <Layout title={fill(copyFor(id, vars).subject, vars)} signOff={guest} note={guest} ps={ps}>
      <Body copy={body} vars={vars} lists={lists} note={guest} />
      {href && (
        <Button href={href} note={guest}>
          {button}
        </Button>
      )}
      {href &&
        notes.map((note, i) => (
          <p key={i} style={{ margin: '8px 0 0', fontSize: 15, color: INK_2 }}>
            {fill(note, vars)}
          </p>
        ))}
    </Layout>
  );
}
