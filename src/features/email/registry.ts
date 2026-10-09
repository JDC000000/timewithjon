// src/features/email/registry.ts — the text part of every template (renderText) and the full email with its HTML
// part (renderEmail; the React Email templates are in ./templates, T1.10.U1). E1 carries a P.S. (Jon decisions 45 + 47a).
import { JON_FACING, POSTSCRIPT, SIGN_OFF, copyFor, fill, type TemplateId } from '@/content/emails';
import { getEnv } from '@/config/env';
import { ROUTES } from '@/ui/routes';
import { renderHtml } from './templates';

export interface Rendered {
  subject: string;
  text: string;
  html?: string;
  fromLocal: 'jon' | 'admin';
}
/** A template var nobody filled: the email is never sent with a literal "{manageLink}" in it (pr28 review M2). */
export class UnfilledPlaceholderError extends Error {
  override name = 'UnfilledPlaceholderError';
}
const TOKEN = /\{(\w+)\}/g;

export interface RenderOptions {
  /** The site origin the P.S. link points at; defaults to NEXT_PUBLIC_SITE_URL (no trailing slash, env.ts). */
  siteUrl?: string;
}

const tagUrl = (opts: RenderOptions) => `${opts.siteUrl ?? getEnv().NEXT_PUBLIC_SITE_URL}${ROUTES.tag}`;

export function renderText(
  id: TemplateId,
  vars: Record<string, string | number>,
  opts: RenderOptions = {},
): Rendered {
  // E1 queued without {times} (before option A, or an empty list) keeps the old body rather than failing closed;
  // E12 with no week and the hourly E13 have their own variants (copyFor, EML-15 / EML-10).
  const c = copyFor(id, vars);
  const jonFacing = JON_FACING.includes(id);
  const subject = fill(c.subject, vars);
  // A link var left empty (E5b with no offer, E9 after a revoked invite) leaves no blank line before the sign-off.
  const body = fill(c.body, vars).replace(/\n+$/, '');
  // Fail closed on a template token with no var. The TEMPLATE is checked, not the filled text: a guest may type
  // braces ('Sam {Jr}'), and that must still send (pr28-verify M3). Only the template id goes into the error.
  if ([...`${c.subject}\n${c.body}`.matchAll(TOKEN)].some((m) => !(m[1]! in vars))) {
    throw new UnfilledPlaceholderError(id);
  }
  const ps = POSTSCRIPT[id];
  if (ps) {
    const text = `${body}\n\n${SIGN_OFF}\n\n${ps.mark} ${ps.text}\n${ps.printTag}: ${tagUrl(opts)}\n`;
    return { subject, text, fromLocal: jonFacing ? 'admin' : 'jon' };
  }
  const text = `${body}\n\n${jonFacing ? '' : `${SIGN_OFF}\n`}`.trimEnd() + '\n';
  return { subject, text, fromLocal: jonFacing ? 'admin' : 'jon' };
}

/** renderText() plus the HTML part (T1.10.U1, @react-email/render) for the templates that have one. The mailers
 *  send both parts; a template with no HTML yet goes out text-only. */
export async function renderEmail(
  id: TemplateId,
  vars: Record<string, string | number>,
  opts: RenderOptions = {},
): Promise<Rendered> {
  const r = renderText(id, vars, opts); // fails closed on an unfilled placeholder before any HTML is drawn
  const html = await renderHtml(id, vars, { tagUrl: tagUrl(opts) });
  return html ? { ...r, html } : r;
}
