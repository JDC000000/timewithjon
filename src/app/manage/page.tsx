// src/app/manage/page.tsx — T2.7.U1 S17 "Manage my booking" at /manage?t=<token> (pack v2.2 s17 / s17b).
// A Server Component that ONLY reads (loadManageModel): a GET, a HEAD or a link scanner's prefetch changes nothing
// (T2.7 AC1). A tampered token is a 404 (AC4); an expired one the friendly "text me" frame (AC3); a spent or reused
// link simply shows the request as it is now (AC2). The actions (Cancel, Ask for another time, Add a story) are
// POSTs from ./actions.tsx on a tap, with the raw token in the x-twj-manage header, never the body or the URL.
// Referrer: next.config gives this path no-referrer, under which browsers send `Origin: null` on a same-origin POST
// and the manage APIs' Origin check refuses it (see SIGN_IN_LINK_PAGE there). strict-origin keeps the token out of
// every Referer (origin only) and lets the Origin header through.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MANAGE_UI } from '@/content/manage';
import { dishBySlug } from '@/content/menu-helpers';
import { SENT_UI, STALE } from '@/content/ui/guest-after';
import { loadManageModel, type ManageModel } from '@/features/invites/manage-model';
import { MANAGE_HEADER } from '@/features/invites/require';
import { MAX_PHOTOS } from '@/features/photos/limits';
import { KeepWhole, PhotoSlot, ROUTES, SiteFooter, SiteHeader } from '@/ui';
import { NARROW } from '../_guest/layout';
import { SentReceipt } from '../_guest/sent-receipt';
import { dishPhotoSlot, dishView } from '../book/[dish]/_lib/flow-view';
import { loadRequestLines } from '../sent/model';
import { ManageActions } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: `${MANAGE_UI.title} · Time with Jon`,
  referrer: 'strict-origin',
  robots: { index: false, follow: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ManagePage({ searchParams }: { searchParams: Search }) {
  const t = (await searchParams).t;
  const token = typeof t === 'string' ? t : null;
  const model = await loadManageModel(token);
  if (model.kind === 'not_found') notFound();
  return (
    <>
      <SiteHeader back={{ href: ROUTES.home, label: SENT_UI.backHome }} />
      {model.kind === 'expired' ? (
        <Expired message={model.message} />
      ) : (
        <Manage model={model} token={token!} sent={await sentLines(model)} />
      )}
      <SiteFooter />
    </>
  );
}

/** s17b "Link expired": model.message is ERRORS.stale, set as the pack sets it (heading, then the "text me" line). */
function Expired({ message }: { message: string }) {
  const split = message.startsWith(STALE.title);
  return (
    <main id="main" data-manage="expired">
      <div className="wrap" style={NARROW}>
        <div className="flow-top">
          <p className="status-pill">{STALE.pill}</p>
          <h1 className="h1" style={{ marginTop: 'var(--s4)' }}>
            {split ? STALE.title : message}
          </h1>
          {split && <p className="lead intro">{message.slice(STALE.title.length).trim()}</p>}
        </div>
        <div className="actions">
          <Link href={ROUTES.menu}>
            <span>{MANAGE_UI.backToMenu}</span>
            <span aria-hidden="true">›</span>
          </Link>
        </div>
      </div>
    </main>
  );
}

type Open = Extract<ManageModel, { kind: 'manage' }>;

/** QA L7: while nothing is locked, the times (or dates, window, stand-by days) the guest sent, as /sent lists them. */
async function sentLines(model: Open): Promise<string[]> {
  const waiting = ['requested', 'needs_new_time', 'standby'].includes(model.status);
  return !model.when && waiting ? loadRequestLines(model.requestId) : [];
}

function Manage({ model, token, sent }: { model: Open; token: string; sent: string[] }) {
  const dish = dishBySlug(model.dish.slug);
  const locked = model.status === 'locked';
  return (
    <main id="main" data-manage={model.status}>
      <div className="wrap" style={NARROW}>
        <div className="flow-top">
          <p className="status-pill">{model.label}</p>
          <h1 className="h1" style={{ marginTop: 'var(--s4)' }}>
            {MANAGE_UI.heading(model.label, model.dish.name)}
          </h1>
        </div>
        {dish?.flow !== 'surprise' && (
          <PhotoSlot slot={dishPhotoSlot(model.dish.slug)} kind="sent" priority="hero" />
        )}
        {model.when && (
          <div className="receipt">
            <dl className="facts" style={{ marginTop: 0, border: 0, padding: 0 }}>
              <dt>{MANAGE_UI.when}</dt>
              <dd>
                <KeepWhole text={model.when} />
                {model.where && (
                  <>
                    <br />
                    <span className="muted">{model.where}</span>
                  </>
                )}
              </dd>
            </dl>
            {locked && (
              <p className="sentto" style={{ color: 'var(--c-ink)' }}>
                {MANAGE_UI.calendarInvite}
              </p>
            )}
          </div>
        )}
        {!model.when && <SentReceipt lines={sent} />}
        {model.ownPlan && (
          <>
            <p className="cap muted" style={{ marginTop: 'var(--s4)' }}>
              {MANAGE_UI.ownPlan}
            </p>
            <p className="quote" style={{ marginTop: 'var(--s2)' }}>
              {model.ownPlan}
            </p>
          </>
        )}
        <ManageActions
          token={token}
          header={MANAGE_HEADER}
          dish={dishView(dish!)}
          form={dish?.flow === 'dates' ? 'dates' : dish?.flow === 'pitch' ? 'pitch' : 'slots'}
          pitch={model.ownPitch}
          maxPhotos={MAX_PHOTOS.after_send}
          frees={locked && model.when ? MANAGE_UI.frees(model.when) : null}
          canCancel={model.canCancel}
          canAskAnother={model.canAskAnother}
          canAddStory={model.canAddStory}
        />
      </div>
    </main>
  );
}
