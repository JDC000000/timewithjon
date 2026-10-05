// src/ui/SiteChrome.tsx (T1.1a.U1): the guest header and footer (pack s01 header() / FOOT).
import Link from 'next/link';
import { FOOTER_LINE } from '@/content';
import { ADMIN_SHELL, MARK, SITE_NAV } from '@/content/ui/foundation';
import type { ReactNode } from 'react';
import { ROUTES } from './routes';

/** Home variant: wordmark + nav. With `back`: the ‹ back link + wordmark (pack flow pages). */
export function SiteHeader({ back }: { back?: { href: string; label: string } }) {
  return (
    <header className="site-h">
      <div className="wrap">
        {back ? (
          <>
            <Link className="back" href={back.href}>
              <span aria-hidden="true">‹</span> {back.label}
            </Link>
            <Link className="mark" href={ROUTES.home}>
              {MARK}
            </Link>
          </>
        ) : (
          <>
            <Link className="mark" href={ROUTES.home}>
              {MARK}
            </Link>
            <nav className="nav" aria-label="Site">
              <Link href={ROUTES.menu}>{SITE_NAV.menu}</Link>
              <Link className="d-only" href={ROUTES.story}>
                {SITE_NAV.story}
              </Link>
            </nav>
          </>
        )}
      </div>
    </header>
  );
}

/**
 * The footer line. Jon's menu polish: the photo credits line is gone from every page (the one stand-in left,
 * something-new, is under the Unsplash License, which asks for no attribution); Jon (2026-10-05): so is "Time with
 * Jon · North Shore, BC", and /menu has no footer line at all (`bare`, nothing renders). `photos` is still accepted
 * so the pages that pass it keep compiling; it renders nothing. TODO: drop it from the callers.
 */
export const SiteFooter: (props: { photos?: readonly string[]; bare?: boolean }) => ReactNode = ({ bare }) =>
  bare ? null : (
    <footer className="site-f">
      <div className="wrap">
        <p>{FOOTER_LINE}</p>
      </div>
    </footer>
  );

/** The admin sign-in pages' frame (pack a1* solo()): wordmark + "Admin", then one centred box. Outside AdminShell. */
export function AdminSolo({ children }: { children: ReactNode }) {
  return (
    <div className="solo">
      <header className="site-h">
        <div className="wrap">
          <span className="mark">{MARK}</span>
          <span className="ui muted">{ADMIN_SHELL.soloTag}</span>
        </div>
      </header>
      <main id="main">
        <div className="box">{children}</div>
      </main>
    </div>
  );
}
