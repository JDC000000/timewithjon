// src/app/admin/_requests/ListPane.tsx — the A2 list pane (pack a2 req_list): the h1, the Big Day meter, the
// "Check these" line when there's possible spam, the six filters with their counts, and each filter's rows. The
// A3 detail renders it too (desktop shows both panes), with the open request's row marked current.
import 'server-only';
import Link from 'next/link';
import { CheckLanding } from '../(app)/requests/_check/CheckLanding';
import { CHECK_CAPTION_ID } from '../(app)/requests/_check/landing';
import { Fragment } from 'react';
import { CHECK, INBOX, MAIL } from '@/content/ui/admin-requests';
import { INBOX_LIMIT, listRequests } from '@/features/admin/inbox';
import { bigDayMeter } from '@/features/admin/meter';
import { emailLimit, failedEmails } from '@/features/email/status';
import { clockLabel } from './format';
import { FilterTabs } from './FilterTabs';
import { FILTERS, type FilterKey, rowView, type RowView } from './rows';
import { KeepWhole } from '@/ui';

function Rows({ rows, current, empty }: { rows: RowView[]; current?: string; empty: string }) {
  if (rows.length === 0) {
    return (
      <ul className="rows">
        <li className="pane-pad ui muted" style={{ paddingBlock: 'var(--s5)' }}>
          {empty}
        </li>
      </ul>
    );
  }
  return (
    <ul className="rows">
      {rows.map((r) => {
        const [head, tail] = splitLast(r.meta);
        return (
          <li key={r.id}>
            <Link
              className="req"
              href={`/admin/requests/${r.id}`}
              aria-current={r.id === current ? 'page' : undefined}
            >
              <span className="who">{r.who}</span>
              <span className="age">
                <KeepWhole text={r.age} />
              </span>
              <span className="meta">
                <KeepWhole text={head} />
                {tail !== null ? (
                  <bdi>
                    <KeepWhole text={tail} />
                  </bdi>
                ) : null}
                {r.flags.map((f) => (
                  <Fragment key={f}>
                    <br />
                    <span className="flag">{f}</span>
                  </Fragment>
                ))}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The pack's bdi_last: the meta's last part is isolated (a name or date can't reorder the line). */
function splitLast(meta: string): [string, string | null] {
  const at = meta.lastIndexOf(' · ');
  return at < 0 ? [meta, null] : [meta.slice(0, at + 3), meta.slice(at + 3)];
}

/**
 * `check`: the "Check these" list (wireframe 09 A2b) instead of the filters: possible spam only, oldest first.
 */
export async function ListPane({
  current,
  initial = 'needs',
  check = false,
}: {
  current?: string;
  initial?: FilterKey;
  check?: boolean;
}) {
  const now = new Date();
  if (check) {
    const [{ cards }, meter] = await Promise.all([listRequests('check', now), bigDayMeter()]);
    const rows = cards.map((c) => ({
      ...rowView(c, 'needs', now),
      who: c.contactName.trim() || CHECK.noName,
    }));
    return (
      <>
        <div className="pane-pad">
          <h1 className="h1">{INBOX.title}</h1>
          <p className="meter">
            <span>{INBOX.meter(meter.count, meter.target)}</span>
          </p>
          <p id={CHECK_CAPTION_ID} tabIndex={-1} className="cap muted" style={{ marginTop: 'var(--s4)' }}>
            {CHECK.listCaption}
          </p>
        </div>
        <Rows rows={rows} current={current} empty={INBOX.emptyFilter} />
        <CheckLanding />
      </>
    );
  }
  const [lists, spam, meter, limit, failed] = await Promise.all([
    Promise.all(FILTERS.map((f) => listRequests(f.tab, now))),
    listRequests('check', now),
    bigDayMeter(),
    emailLimit(now),
    failedEmails(),
  ]);
  const failedFor = new Set(failed.map((e) => e.requestId).filter(Boolean));
  const allEmpty = lists.every((l) => l.cards.length === 0);
  const tabs = FILTERS.map((f, i) => {
    const { cards, truncated } = lists[i]!;
    const empty = f.key === 'done' ? INBOX.emptyDone : allEmpty ? INBOX.emptyAll : INBOX.emptyFilter;
    return {
      key: f.key,
      label: INBOX.filters[f.key],
      count: cards.length,
      panel: (
        <>
          <Rows
            rows={cards.map((c) => rowView(c, f.key, now, failedFor.has(c.id)))}
            current={current}
            empty={empty}
          />
          {truncated ? <p className="pane-pad ui muted">{INBOX.truncated(INBOX_LIMIT)}</p> : null}
        </>
      ),
    };
  });

  const head = (
    <>
      {limit.reached && limit.resumesAt ? (
        <p className="notice" role="status">
          <KeepWhole text={MAIL.limit(clockLabel(new Date(limit.resumesAt)))} />
        </p>
      ) : null}
      <h1 className="h1">{INBOX.title}</h1>
      <p className="meter">
        <span>{INBOX.meter(meter.count, meter.target)}</span>
      </p>
      {spam.cards.length > 0 ? (
        <Link className="spam" href="/admin?check=1">
          <span>
            <b>{INBOX.checkThese}</b> · {INBOX.possibleSpam(spam.cards.length)}
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      ) : null}
    </>
  );
  return <FilterTabs head={head} tabs={tabs} label={INBOX.filtersLabel} initial={initial} />;
}
