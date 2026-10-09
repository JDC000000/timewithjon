// src/app/admin/(app)/page.tsx — T2.2.U1: A2 the requests inbox (pack a2-requests). Phone: the list only; desktop:
// the list and an empty detail pane ("Pick a request."). requireAdmin() runs here too (AGENTS.md rule 4).
import type { Metadata } from 'next';
import { CHECK, INBOX } from '@/content/ui/admin-requests';
import { requireAdmin } from '@/features/admin/auth';
import { notAllowed } from '../_requests/guard';
import { ListPane } from '../_requests/ListPane';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return { title: (await searchParams).check === '1' ? CHECK.pageTitle : INBOX.pageTitle };
}

export default async function RequestsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return notAllowed(admin);
  const check = (await searchParams).check === '1'; // pr77-review F6: only ?check=1 opens Check these
  return (
    <>
      <section className="adm-list" aria-label={INBOX.listLabel}>
        <ListPane check={check} />
      </section>
      <section className="adm-detail d-pane" aria-label={INBOX.detailLabel}>
        <div className="empty-pane">
          <h2 className="h2">{INBOX.pickTitle}</h2>
          <p className="ui" style={{ marginTop: 'var(--s2)' }}>
            {INBOX.pickLine}
          </p>
        </div>
      </section>
    </>
  );
}
