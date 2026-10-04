// src/app/offer/frame.tsx — T2.4.U2 the S18 page frame shared by /offer and /new-date (the S17 manage layout:
// status pill, "{label}: {dish}" heading, the narrow column). Server-only markup; the one POST lives in the client
// forms. 'current' (a spent link, or an offer that has gone) shows the loader's line: "You're locked in for …",
// "Already cancelled. No guilt." or "Looks like that one went. I'll send you more."; with no line (the guest's own
// new times are with Jon, QA r2 M1) it shows what they sent, as /manage does.
import type { ReactNode } from 'react';
import { MANAGE_UI } from '@/content/manage';
import { SENT_UI } from '@/content/ui/guest-after';
import type { RequestView } from '@/features/invites/manage-model';
import { ROUTES, SiteFooter, SiteHeader } from '@/ui';
import { loadRequestLines } from '../sent/model';
import { NARROW } from '../_guest/layout';
import { SentReceipt } from '../_guest/sent-receipt';
import { StaleState } from '../_guest/stale';

export function S18Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader back={{ href: ROUTES.home, label: SENT_UI.backHome }} />
      {children}
      <SiteFooter photos={[]} />
    </>
  );
}

/** Expired (ERRORS.stale): the S16 / s17b "text me" frame. */
export const S18Expired = StaleState;

export function S18Page(p: {
  page: 'offer' | 'new-date';
  view: RequestView;
  state: string;
  children: ReactNode;
}) {
  return (
    <main id="main" data-s18={p.page} data-s18-state={p.state}>
      <div className="wrap" style={NARROW}>
        <div className="flow-top">
          <p className="status-pill">{p.view.label || MANAGE_UI.title}</p>
          <h1 className="h1" style={{ marginTop: 'var(--s4)' }}>
            {p.view.label ? MANAGE_UI.heading(p.view.label, p.view.dish.name) : p.view.dish.name}
          </h1>
        </div>
        {p.children}
      </div>
    </main>
  );
}

/** 'current': the request as it is now: its one line, or (no line) the receipt of what the guest sent. */
export async function S18Current({ message, requestId }: { message: string | null; requestId: string }) {
  if (message === null) return <SentReceipt lines={await loadRequestLines(requestId)} />;
  return (
    <p className="lead intro s18-line" role="status">
      {message}
    </p>
  );
}
