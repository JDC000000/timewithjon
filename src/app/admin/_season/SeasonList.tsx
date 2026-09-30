// src/app/admin/_season/SeasonList.tsx — T2.5.U1 / T3.5.U1: the A4 list pane (pack gen.py season_list): the title,
// the Big Day meter, the away card and one row per season week with its notes (busy markers included). Server.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { KeepWhole, Vh } from '@/ui';
import { AWAY, PANES, SEASON } from '@/content/ui/admin-season';
import type { SeasonPage } from './data';
import { dateLabel, type WeekNote } from './model';
import { AWAY_PATH, SEASON_PATH, weekPath } from './paths';

/** One note as the pack words it: "Fri Apr 16 · noon–2 pm blocked", "Big Day Sat Apr 17 (Wes)". */
export function noteText(n: WeekNote): string {
  return [n.lead, n.day && n.time ? `${n.day} · ${n.time}` : n.day, n.text].filter(Boolean).join(' ');
}

export function SeasonList({ page, current }: { page: SeasonPage; current?: string }) {
  const { meter, away, rows } = page;
  return (
    <>
      <div className="pane-pad">
        <h1 className="h1">{SEASON.title}</h1>
        <p className="meter">
          <span>{SEASON.meter(meter.count, meter.target)}</span>
          <span className="muted">{SEASON.range}</span>
        </p>
        <div className="card">
          <span>
            <strong>{SEASON.awayCard}</strong>
            {' · '}
            {away ? (
              <>
                <KeepWhole
                  text={`${dateLabel(away.startDate, 'EEE MMM d')} – ${dateLabel(away.endDate, 'EEE MMM d')}`}
                />
              </>
            ) : (
              AWAY.off
            )}
          </span>
          <Link className="textbtn" href={AWAY_PATH}>
            {SEASON.awayEdit}
            <Vh>{SEASON.awayEditVh}</Vh>
          </Link>
        </div>
      </div>
      <ul className="rows">
        {rows.map((r) => (
          <li key={r.weekStart}>
            <Link
              className={r.away ? 'wk wk--away' : 'wk'}
              href={weekPath(r.weekStart)}
              aria-current={current === r.weekStart ? 'page' : undefined}
            >
              <span className="w">
                <KeepWhole text={`${SEASON.weekOf} ${r.label}`} />
              </span>
              <span className="vh">, </span> <span className="c">{r.count}</span>
              {r.notes.length > 0 ? (
                <>
                  <span className="vh">, </span>
                  <span className="n">
                    <KeepWhole text={r.notes.map(noteText).join(' · ')} />
                  </span>
                </>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The pack's adm_page panes: on a phone only one shows (`d-pane` hides the other below the split). */
export function Panes({
  list,
  detail,
  phoneShows,
}: {
  list: ReactNode;
  detail: ReactNode;
  phoneShows: 'list' | 'detail';
}) {
  return (
    <>
      <section className={phoneShows === 'detail' ? 'adm-list d-pane' : 'adm-list'} aria-label={PANES.list}>
        {list}
      </section>
      <section
        className={phoneShows === 'list' ? 'adm-detail d-pane' : 'adm-detail'}
        aria-label={PANES.detail}
      >
        {detail}
      </section>
    </>
  );
}

/** The phone's "‹ Season" row (A6/A7 pass their own list: "‹ Stories", "‹ Settings"). */
export function BackRow({ href = SEASON_PATH, label = PANES.back }: { href?: string; label?: string }) {
  return (
    <p className="back-row m-only">
      <Link className="back" href={href}>
        <span aria-hidden="true">‹</span> {label}
      </Link>
    </p>
  );
}
