'use client';
// src/ui/AdminNav.tsx (T1.1a.U1): the admin side bar (from 1024 px) and the phone tab bar (pack a2 adm_nav()).
// The current section is marked aria-current="page" from the path.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_SHELL, MARK } from '@/content/ui/foundation';
import { ROUTES } from './routes';

type Section = { key: string; label: string; href: string; badge?: number; match: (path: string) => boolean };

const A = ROUTES.admin;
const under = (base: string) => (p: string) => p === base || p.startsWith(`${base}/`);

export function adminSections(needs: number | null): Section[] {
  return [
    {
      key: 'requests',
      label: ADMIN_SHELL.nav.requests,
      href: A.requests,
      badge: needs ?? undefined,
      match: (p) => p === A.requests || under(A.requestsPrefix)(p),
    },
    { key: 'season', label: ADMIN_SHELL.nav.season, href: A.season, match: under(A.season) },
    { key: 'links', label: ADMIN_SHELL.nav.links, href: A.links, match: under(A.links) },
    { key: 'stories', label: ADMIN_SHELL.nav.stories, href: A.stories, match: under(A.stories) },
    { key: 'more', label: ADMIN_SHELL.nav.more, href: A.settings, match: under(A.settings) },
  ];
}

/** variant 'side' = the side bar (+ who's signed in); 'tabbar' = the phone tab bar (after .adm-shell, pack a2). */
export function AdminNav({
  variant,
  email,
  needs,
}: {
  variant: 'side' | 'tabbar';
  email?: string;
  needs: number | null;
}) {
  const path = usePathname() ?? '';
  const sections = adminSections(needs);
  const current = (s: Section) => (s.match(path) ? ('page' as const) : undefined);
  const count = (s: Section, cls: string) =>
    s.badge ? (
      <span className={cls} data-cnt="needs">
        {s.badge}
        <span className="vh">{ADMIN_SHELL.needReplyVh}</span>
      </span>
    ) : null;
  if (variant === 'tabbar') {
    return (
      <nav className="tabbar" aria-label="Admin">
        {sections.map((s) => (
          <Link key={s.key} href={s.href} aria-current={current(s)}>
            <span>{s.label}</span>
            {count(s, 'badge')}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="adm-side" aria-label="Admin">
      <span className="mark">{MARK}</span>
      {sections.map((s) => (
        <Link key={s.key} className="nv" href={s.href} aria-current={current(s)}>
          <span>{s.label}</span>
          {count(s, 'tnum')}
        </Link>
      ))}
      {email && (
        <p className="who-me">
          {ADMIN_SHELL.signedInAs} {email}
        </p>
      )}
    </nav>
  );
}
