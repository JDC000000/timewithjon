// src/features/email/templates/index.ts — T1.10.U1: the HTML part of the templates that have one (E1, E2 now;
// T3.2.U2 adds the rest here). The plain-text part stays renderText()'s (registry.ts).
import { createElement, type ReactElement } from 'react';
import { render } from '@react-email/render';
import type { TemplateId } from '@/content/emails';
import { E1 } from './E1';
import { E2 } from './E2';
import { REST_HTML } from './rest';

export interface HtmlContext {
  /** The P.S. tag link (site origin + ROUTES.tag). */
  tagUrl: string;
}
type Vars = Record<string, string | number>;

const HTML: Partial<Record<TemplateId, (vars: Vars, ctx: HtmlContext) => ReactElement>> = {
  E1: (vars, ctx) => createElement(E1, { vars, tagUrl: ctx.tagUrl }),
  E2: (vars) => createElement(E2, { vars }),
  ...REST_HTML,
};

export const HTML_TEMPLATES = Object.keys(HTML) as TemplateId[];

/** The HTML of a template, or undefined when it has none yet (it then goes out text-only, as before). */
export async function renderHtml(id: TemplateId, vars: Vars, ctx: HtmlContext): Promise<string | undefined> {
  const el = HTML[id]?.(vars, ctx);
  return el ? render(el) : undefined;
}
