// src/app/privacy/page.tsx — the public privacy page (Google needs its URL to publish the calendar app). Open to
// everyone: no invite needed (src/proxy.ts gates nothing; this page reads no session), the site's header and footer,
// no photos. The words are Jon's (src/content/ui/privacy.ts).
import type { Metadata } from 'next';
import { PRIVACY } from '@/content/ui/privacy';
import { SiteFooter, SiteHeader } from '@/ui';

export const metadata: Metadata = { title: PRIVACY.pageTitle };

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="wrap" style={{ paddingBlock: 'var(--s8)' }}>
          <h1 className="h1">{PRIVACY.heading}</h1>
          <p className="body measure" style={{ marginTop: 'var(--s5)' }}>
            {PRIVACY.body}
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
