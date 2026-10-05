// src/app/not-found.tsx (U1, T1.2.U4, S15): the 404 page, wireframe 01 state D: the header, one line, a way back to
// the menu, the footer.
import type { Metadata } from 'next';
import { NOT_FOUND } from '@/content';
import { NOT_FOUND_TITLE } from '@/content/ui/foundation';
import { Button, ROUTES, SiteFooter, SiteHeader } from '@/ui';

export const metadata: Metadata = { title: NOT_FOUND_TITLE };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="wrap" style={{ paddingBlock: 'var(--s8)' }}>
          <h1 className="h1">{NOT_FOUND.line}</h1>
          <p style={{ marginTop: 'var(--s5)' }}>
            <Button href={ROUTES.menu}>{NOT_FOUND.back}</Button>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
