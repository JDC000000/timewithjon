// src/app/admin/(app)/requests/[id]/page.tsx — T2.2.U2: A3 one request (pack a3-request-detail). Phone: the detail
// only (pushed); desktop: the list with this row current, and the detail. requireAdmin() runs here too (AGENTS.md
// rule 4). The sealed plan never reaches this page: getRequestDetail never selects it (C4).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { INBOX } from '@/content/ui/admin-requests';
import { getRequestDetail } from '@/features/admin/detail';
import { requestOptions } from '@/features/admin/options';
import { failedEmails } from '@/features/email/status';
import { loadSettings } from '@/lib/settings';
import { DetailPane } from '../../../_requests/DetailPane';
import { detailView } from '../../../_requests/detail-view';
import { requireAdmin } from '@/features/admin/auth';
import { notAllowed } from '../../../_requests/guard';
import { ListPane } from '../../../_requests/ListPane';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** One read per render: the title and the page share it. */
const load = cache(async (id: string) => (UUID.test(id) ? getRequestDetail(id) : null));

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const admin = await requireAdmin();
  if (admin instanceof Response) return notAllowed(admin);
  const d = await load((await params).id);
  return { title: d ? detailView(d, new Date()).pageTitle : INBOX.pageTitle };
}

export default async function RequestPage({ params }: Props) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return notAllowed(admin);
  const { id } = await params;
  const d = await load(id);
  if (!d) notFound();
  const now = new Date();
  const failed = (await failedEmails()).filter((e) => e.requestId === d.id);
  const view = detailView(
    d,
    now,
    failed.map((e) => ({ id: e.id, resendable: e.resendable })),
  );
  // The sheets' choices (open times, weeks, join hosts) only matter while it's open or locked.
  const [options, settings] = await Promise.all([
    view.open || view.filter === 'locked' ? requestOptions(d.id, now) : Promise.resolve(null),
    loadSettings(),
  ]);
  return (
    <>
      <section className="adm-list d-pane" aria-label={INBOX.listLabel}>
        <ListPane current={d.id} initial={view.filter} check={view.spam} />
      </section>
      <section className="adm-detail" aria-label={INBOX.detailLabel}>
        <DetailPane
          key={d.id}
          requestId={d.id}
          email={d.contact.email}
          dish={d.dish}
          dishName={d.dishName ?? d.dish}
          season={{ start: settings.season_start, end: settings.season_end }}
          phone={d.contact.phone}
          pitchLength=""
          options={options}
          view={view}
          notes={{ before60: d.before60Note ?? '', jon: d.jonNote ?? '' }}
        />
      </section>
    </>
  );
}
