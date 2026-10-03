import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { connection } from 'next/server';
import { HEADLINE, OPEN_LINE } from '@/content/site';
import { SKIP_TO_CONTENT } from '@/content/ui/foundation';
import { getAppMode } from '@/config/env';
import { FocusRoot } from '@/ui';
import { LateItalic } from '@/ui/LateItalic';
import { StagingBanner } from '@/ui/StagingBanner';
import { newsreader, schibsted } from './fonts';
import '@/ui/tokens.css';
import '@/ui/site.css';

// AD-12 + creative v1.4 §6.7: static tags only, never a guest's name.
export const metadata: Metadata = {
  title: 'Time with Jon',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Time with Jon',
    description: `${OPEN_LINE} ${HEADLINE}`,
  },
};

// The pack's page shell: the skip link first, then the page (every page puts id="main" on its <main>), then the
// focus root (probe + live region). viewport-fit=cover comes from the viewport export below.
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' } as const;

// T4.1.05: every page renders per request, so Next can stamp the proxy's CSP nonce on its scripts.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en-CA" className={`${newsreader.variable} ${schibsted.variable}`}>
      <body>
        <a className="skip" href="#main">
          {SKIP_TO_CONTENT}
        </a>
        <StagingBanner mode={getAppMode()} />
        {children}
        <FocusRoot />
        <LateItalic />
      </body>
    </html>
  );
}
