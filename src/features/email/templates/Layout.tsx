// src/features/email/templates/Layout.tsx — T1.10.U1: the shared React Email layout (the v2.2b look,
// design pack v22proto2/email/e1-got-it.html). Tables + inline CSS only; every colour is a
// src/ui/tokens.css value (email clients can't read CSS variables). T3.2.U2 builds the other templates on this.
// The header photo band (a private photo slot) is not drawn here yet.
import type { ReactNode } from 'react';
import { MARK } from '@/content/ui/foundation';
import { SIGN_OFF, fill } from '@/content/emails';

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
  linkLabel: string;
  href: string;
}

export interface LayoutProps {
  /** The subject: the <title> of the document. */
  title: string;
  children: ReactNode;
  /** Guest emails sign off "Jon" on its own line; Jon-facing ones don't (as the text part). */
  signOff: boolean;
  ps?: PostScript;
}

export function Layout({ title, children, signOff, ps }: LayoutProps) {
  return (
    <html lang="en">
      {/* an email document, not a Next page */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{title}</title>
      </head>
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
                        {signOff && (
                          <p style={{ margin: '24px 0 0', font: `italic 20px/1.3 ${VOICE}`, color: INK }}>
                            {SIGN_OFF}
                          </p>
                        )}
                        {ps && (
                          <p style={{ margin: '20px 0 0', font: `400 15px/1.55 ${UI}`, color: INK_2 }}>
                            <span style={{ font: `italic 17px/1 ${VOICE}`, color: INK }}>{ps.mark}</span>{' '}
                            {ps.text}{' '}
                            <a href={ps.href} style={{ color: INK, textDecoration: 'underline' }}>
                              {ps.linkLabel}
                            </a>
                          </p>
                        )}
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

/** A button is a plain link to a page (N2): the page does the work on its own POST, never the GET. */
export function Button({ href, children }: { href: string; children: ReactNode }) {
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
            <Button key={i} href={String(vars[only])}>
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
