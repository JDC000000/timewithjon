// src/features/email/templates/E13.tsx — T3.2.U2: E13 "New stories" / hourly digest (Jon-facing): one list item per
// entry, then the admin link as a button. The text part's entries start "- "; the list draws its own bullet, so the
// "- " is left out here (EML-09). An indented URL line under an entry is that entry's own page (the hourly digest's
// E2/E3/E12/E16, QA4b M2): the entry links to it. The daily digest opens Stories, the hourly one the inbox (EML-10).
// React escapes every name and subject: tag-like text shows as typed, never dropped.
import { copyFor, fill } from '@/content/emails';
import { ADMIN_SHELL } from '@/content/ui/foundation';
import { Button, INK, Layout } from './Layout';

type Vars = Record<string, string | number>;
const LINK = /^\s+(https?:\/\/\S+)$/;

/** "- subject\n  https://…" lines → entries, each with its own link when it has one. */
export function digestItems(lines: string): { text: string; href: string | null }[] {
  const items: { text: string; href: string | null }[] = [];
  for (const line of lines.split('\n')) {
    const link = LINK.exec(line)?.[1];
    if (link && items.length && !items.at(-1)!.href) items.at(-1)!.href = link;
    else if (line.trim()) items.push({ text: line.replace(/^- /, ''), href: null });
  }
  return items;
}

export function E13({ vars }: { vars: Vars }) {
  const items = digestItems(String(vars.lines ?? ''));
  const button = vars.digest === 'hourly' ? ADMIN_SHELL.nav.requests : ADMIN_SHELL.nav.stories;
  const href = String(vars.adminLink ?? '');
  return (
    <Layout title={fill(copyFor('E13', vars).subject, vars)} signOff={false}>
      <ul style={{ margin: 0, padding: '0 0 0 20px' }}>
        {items.map((it, i) => (
          <li key={i}>
            {it.href ? (
              <a href={it.href} style={{ color: INK, textDecoration: 'underline' }}>
                {it.text}
              </a>
            ) : (
              it.text
            )}
          </li>
        ))}
      </ul>
      {href && <Button href={href}>{button}</Button>}
    </Layout>
  );
}
