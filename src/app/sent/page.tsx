// src/app/sent/page.tsx — T1.8.U1 S11 After Send: "Sent." (or "On stand-by"), the reply promise, a receipt with
// "Sent to {email}", then the story form. Stand-by: the approved status label, the s17b promise, and a receipt of the
// dish plus "stand-by, {Thu–Fri}" (Jon decision 49, line 9). The request comes only from twj_req (C2); none → the
// stale line (AC3).
// The before-60 field reaches the DOM only when settings.before60_enabled (AC4). Never cached, never indexed.
// v2.2 pack (G1 signed, Jon decisions 46-47): the photo slot under the stamp, and the no-gifts P.S. at the foot under
// the hairline (decision 45), rendered from the one NO_GIFTS_PS source; its link goes to the printable tag.
import type { Metadata } from 'next';
import Link from 'next/link';
import { AFTER_SEND, GUEST_LABEL, NO_GIFTS_PS } from '@/content';
import { AFTER_SEND_STANDBY, SENT_UI } from '@/content/ui/guest-after';
import { readRequestCapability } from '@/features/invites/capability';
import { MAX_PHOTOS } from '@/features/photos/limits';
import { KeepWhole, PhotoSlot, ROUTES, SiteFooter, SiteHeader } from '@/ui';
import { NARROW } from '../_guest/layout';
import { StaleState } from '../_guest/stale';
import { StoryForm } from '../_guest/story-form';
import { loadSentModel, type SentModel } from './model';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sent · Time with Jon' };

const NO_TARGET = {};
const SENT_PHOTO_SIZES = '(min-width: 768px) 736px, 100vw';

export default async function SentPage() {
  const model = await loadSentModel(await readRequestCapability());
  return (
    <>
      <SiteHeader back={{ href: ROUTES.home, label: SENT_UI.backHome }} />
      {model.kind === 'stale' ? <StaleState /> : <Sent model={model} />}
      <SiteFooter />
    </>
  );
}

function Sent({ model }: { model: Extract<SentModel, { kind: 'sent' }> }) {
  const standby = model.standby;
  return (
    <main id="main">
      <div className="wrap" style={NARROW}>
        <div className="flow-top">
          <h1 className="display">
            <span className="swipe">{standby ? GUEST_LABEL.standby : AFTER_SEND.stamp}</span>
          </h1>
          <p className="lead intro" style={{ marginTop: 'var(--s5)' }}>
            {standby
              ? AFTER_SEND_STANDBY.promise(standby.week)
              : model.emailComing
                ? AFTER_SEND.promise(model.fromAddress)
                : AFTER_SEND.promiseNoEmail}
          </p>
        </div>
        <PhotoSlot slot="hero" kind="sent" sizes={SENT_PHOTO_SIZES} priority="hero" />
        <div className="receipt">
          <p className="dish-name">{model.dishName}</p>
          <ul>
            {standby ? (
              <li>
                <KeepWhole text={AFTER_SEND_STANDBY.receiptLine(standby.days)} />
              </li>
            ) : (
              model.lines.map((line) => (
                <li key={line}>
                  <KeepWhole text={line} />
                </li>
              ))
            )}
          </ul>
          <p className="sentto">{AFTER_SEND.sentTo(model.sentTo)}</p>
        </div>
        <StoryForm
          endpoint="/api/stories"
          target={NO_TARGET}
          maxPhotos={MAX_PHOTOS.after_send}
          before60={model.before60}
          skipHref="/"
        />
        <aside className="ps" aria-label={NO_GIFTS_PS.mark}>
          <p>
            <span className="ps-mark">{NO_GIFTS_PS.mark}</span> {NO_GIFTS_PS.text}{' '}
            <Link href={ROUTES.tag}>{NO_GIFTS_PS.printTag}</Link>
          </p>
        </aside>
      </div>
    </main>
  );
}
