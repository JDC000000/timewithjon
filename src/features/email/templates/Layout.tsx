// src/features/email/templates/Layout.tsx — T1.10.U1: the shared React Email layout. Two looks:
// - card (Jon-facing mail): the v2.2b look, design pack v22proto2/email/e1-got-it.html: a paper card on the canvas,
//   the TIME WITH JON mark, a dark button. Tables + inline CSS only; every colour is a src/ui/tokens.css value.
// - note (every guest email, r6 fix 3, approved: Jon 2026-10-09): a personal note: plain left-aligned text in the
//   system font, no canvas, no card, no mark; the action is an underlined text link with the same words; the italic
//   "Jon" stays. (A designed, branded template is what Gmail files under Promotions.)
import type { ReactNode } from 'react';
import { MARK } from '@/content/ui/foundation';
import { POSTSCRIPT, SIGN_OFF, fill, type TemplateId } from '@/content/emails';

export const INK = '#1f1f1f'; // --c-ink
export const INK_2 = '#34312c'; // --c-ink-2
export const INK_3 = '#595449'; // --c-ink-3
export const CANVAS = '#e9e6de'; // --c-canvas
export const PAPER = '#f4f2ec'; // --c-paper
const UI = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const VOICE = "Georgia,'Times New Roman',serif";

export interface PostScript {
  mark: string;
  text: string;
  /** The P.S. link (E4's "Print the tag"); none = the words alone (E1, r6 fix 4). */
  link?: { label: string; href: string };
}

/** A template's P.S. (POSTSCRIPT): the words, and the "Print the tag" link where it carries one (E4). */
export function postScriptFor(id: TemplateId, tagUrl: string): PostScript | undefined {
  const ps = POSTSCRIPT[id];
  if (!ps) return undefined;
  return {
    mark: ps.words.mark,
    text: ps.words.text,
    ...(ps.tagLink ? { link: { label: ps.words.printTag, href: tagUrl } } : {}),
  };
}

export interface LayoutProps {
  /** The subject: the <title> of the document. */
  title: string;
  children: ReactNode;
  /** Guest emails sign off "Jon" on its own line; Jon-facing ones don't (as the text part). */
  signOff: boolean;
  ps?: PostScript;
  /** A guest email: the personal-note look. */
  note?: boolean;
}

function SignOffAndPs({ signOff, ps }: Pick<LayoutProps, 'signOff' | 'ps'>) {
  return (
    <>
      {signOff && (
        <p style={{ margin: '24px 0 0', font: `italic 20px/1.3 ${VOICE}`, color: INK }}>{SIGN_OFF}</p>
      )}
      {ps && (
        <p style={{ margin: '20px 0 0', font: `400 15px/1.55 ${UI}`, color: INK_2 }}>
          <span style={{ font: `italic 17px/1 ${VOICE}`, color: INK }}>{ps.mark}</span> {ps.text}
          {ps.link && (
            <>
              {' '}
              <a href={ps.link.href} style={{ color: INK, textDecoration: 'underline' }}>
                {ps.link.label}
              </a>
            </>
          )}
        </p>
      )}
    </>
  );
}

function Head({ title }: { title: string }) {
  return (
    // an email document, not a Next page
    // eslint-disable-next-line @next/next/no-head-element
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta name="color-scheme" content="light" />
      <meta name="supported-color-schemes" content="light" />
      <title>{title}</title>
    </head>
  );
}

export function Layout({ title, children, signOff, ps, note = false }: LayoutProps) {
  if (note)
    return (
      <html lang="en">
        <Head title={title} />
        <body style={{ margin: 0, padding: 0 }}>
          {/* EML-17: a long unbroken name or word wraps, never widens the email. */}
          <div
            style={{
              maxWidth: 600,
              padding: '16px',
              textAlign: 'left',
              font: `400 16px/1.5 ${UI}`,
              color: INK,
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            {children}
            <SignOffAndPs signOff={signOff} ps={ps} />
          </div>
        </body>
      </html>
    );
  return (
    <html lang="en">
      <Head title={title} />
      <body style={{ margin: 0, padding: 0, background: CANVAS }}>
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{ background: CANVAS }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: '24px 12px' }}>
                <table
                  role="presentation"
                  width={600}
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  style={{ width: '100%', maxWidth: 600, background: PAPER }}
                >
                  <tbody>
                    <tr>
                      {/* EML-17: a long unbroken name or word wraps inside the card at 320 px, never widens it. */}
                      <td
                        style={{
                          padding: '32px 40px 40px',
                          font: `400 17px/1.55 ${UI}`,
                          color: INK,
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        }}
                      >
                        <p
                          style={{
                            margin: '0 0 20px',
                            font: `600 12px/1.4 ${UI}`,
                            letterSpacing: '.08em',
                            textTransform: 'uppercase',
                            color: INK_3,
                          }}
                        >
                          {MARK}
                        </p>
                        {children}
                        <SignOffAndPs signOff={signOff} ps={ps} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

/**
 * A button is a plain link to a page (N2): the page does the work on its own POST, never the GET. In a note (a guest
 * email, `note`) it is an underlined text link with the same words; in a card (Jon-facing) the dark button. (The look
 * is passed down, not read from a React context: these templates also render inside server modules.)
 */
export function Button({
  href,
  children,
  note = false,
}: {
  href: string;
  children: ReactNode;
  note?: boolean;
}) {
  if (note)
    return (
      <p style={{ margin: '20px 0 0' }}>
        <a href={href} style={{ color: INK, textDecoration: 'underline' }}>
          {children}
        </a>
      </p>
    );
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={{ margin: '24px 0 0' }}>
      <tbody>
        <tr>
          <td style={{ background: INK, borderRadius: 4 }}>
            <a
              href={href}
              style={{
                display: 'inline-block',
                padding: '12px 22px',
                font: `600 16px/1.2 ${UI}`,
                color: PAPER,
                textDecoration: 'none',
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export interface BodyOptions {
  /** Vars whose line in the body is a list: one item per '\n'-separated value (E1 {times}). */
  lists?: string[];
  /** Vars whose line in the body is a URL: drawn as a Button with this label (E2 {adminLink}). */
  buttons?: Record<string, string>;
  /** A guest email's note look: its button lines are text links. */
  note?: boolean;
}

/**
 * The body copy (src/content/emails.ts, the same string as the text part) as blocks: one paragraph per line,
 * a line that is exactly `{list var}` becomes a <ul>, a line that is exactly `{button var}` becomes a Button.
 * The copy stays single-sourced; React escapes every guest-supplied value.
 */
export function Body({
  copy,
  vars,
  lists = [],
  buttons = {},
  note = false,
}: { copy: string; vars: Record<string, string | number> } & BodyOptions) {
  const lines = copy.split('\n').filter((line) => fill(line, vars).trim());
  return (
    <>
      {lines.map((line, i) => {
        const only = /^\{(\w+)\}$/.exec(line.trim())?.[1];
        if (only && lists.includes(only)) {
          const items = String(vars[only]).split('\n').filter(Boolean);
          return (
            <ul key={i} style={{ margin: i ? '4px 0 0' : '0', padding: '0 0 0 20px' }}>
              {items.map((it, j) => (
                <li key={j}>{it}</li>
              ))}
            </ul>
          );
        }
        if (only && buttons[only]) {
          return (
            <Button key={i} href={String(vars[only])} note={note}>
              {buttons[only]}
            </Button>
          );
        }
        return (
          <p key={i} style={{ margin: i ? '16px 0 0' : '0' }}>
            {fill(line, vars)}
          </p>
        );
      })}
    </>
  );
}
