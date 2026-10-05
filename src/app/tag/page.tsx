// src/app/tag/page.tsx — U2 PR3 S12b: the printable wine tag, pack v2.2 (G1 signed, Jon decisions 46-47). Reached only
// from the no-gifts P.S. (S11 "Sent." and the E1 email, decision 45); no nav or landing link to it (NOGIFTSPS). The
// back link returns to S11. The sheet is one Letter page of four tags, scaled as one unit to the column (.sheet-fit);
// print CSS (src/ui/site.css) drops the chrome and prints it at 8.5 x 11 in. Static: no request data, no photos.
import type { Metadata } from 'next';
import { WINE_TAG } from '@/content';
import { TAG_UI } from '@/content/ui/tag';
import { ROUTES, SiteFooter, SiteHeader } from '@/ui';
import { noWidow } from '../_landing/text';
import { PrintButton } from './print-button';

export const metadata: Metadata = { title: 'Wine tag · Time with Jon' };

/** Four to a page (the pack's Letter sheet): fixed cells, fixed keys. The pack keeps "my&nbsp;51st" whole (noWidow). */
const CELLS = ['a', 'b', 'c', 'd'] as const;

export default function TagPage() {
  return (
    <>
      <SiteHeader back={{ href: ROUTES.sent, label: TAG_UI.back }} />
      <main id="main">
        <div className="wrap">
          <div className="flow-top no-print">
            <h1 className="h1">{TAG_UI.title}</h1>
            <p className="lead intro">{TAG_UI.intro}</p>
            <p className="send">
              <PrintButton>{TAG_UI.print}</PrintButton>
              <span className="ui muted">{TAG_UI.printAlt}</span>
            </p>
          </div>
          <div
            className="sheet-fit"
            style={{ marginTop: 'var(--s7)' }}
            role="img"
            aria-label={TAG_UI.sheetLabel}
            aria-describedby="tag-words"
          >
            <div className="sheet-letter">
              {CELLS.map((c) => (
                <div className="cell" key={c}>
                  <div className="tag">
                    <p className="cap">{WINE_TAG.forJon}</p>
                    <p className="ln">{WINE_TAG.openOn}</p>
                    <p className="ln">{WINE_TAG.from}</p>
                    <p className="fine">{noWidow(WINE_TAG.noDate)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="ui muted no-print" id="tag-words" style={{ marginTop: 'var(--s3)' }}>
            {noWidow(TAG_UI.words)}
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
