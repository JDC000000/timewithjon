'use client';
// src/app/admin/_season/WeekEditor.tsx — T2.5.U1: the A4b week pane (pack gen.py week_editor). One Open/Blocked choice
// per date (ruling Q1) with its windows listed under it; a block over a locked booking asks in place first (wf09
// state-block, ruling Q3) and names the bookings under way it leaves to finish (T2.5.05). Focus only through
// @/ui/focus (decision 29); rows keep stable keys, so a refresh never rebuilds the control under the pointer (INT-06).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ERRORS } from '@/content';
import { SEASON, WEEK, underWayLine } from '@/content/ui/admin-season';
import { vancouverDate } from '@/lib/time';
import { Button, KeepWhole, Vh } from '@/ui';
import { announce, moveFocus, useLandingFocus } from '@/ui/focus';
import {
  addBlock,
  confirmBlock,
  offerStandby,
  previewBlock,
  removeBlock,
  setCap,
  type Affected,
  type ApiResult,
  type BlockRange,
} from './api';
import { BlockConfirm } from './BlockConfirm';
import { dateLabel } from './model';
import { LAST_WEEK_KEY } from './paths';
import type { DateRow, WeekDetail, WindowLine } from './week-model';

const CK = (
  <svg className="ck" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path d="M1.5 6.5l3 3 6-7.5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);
const LEGEND = { display: 'block', width: '100%' } as const;

/** What is waiting on Jon's answer: a block over locked bookings. `scope` = a date, or 'week'. */
interface Pending {
  scope: string;
  range: BlockRange;
  affected: Affected[];
  underWay: Affected[];
}
interface Flash {
  scope: string;
  text: string;
  err: boolean;
}

/** A free window's note, following Jon's choice before the server confirms it. */
function noteFor(w: WindowLine, d: DateRow, blocked: boolean): string {
  if (!d.editable) return w.note;
  if (blocked) return WEEK.blockedByYou;
  return w.note === WEEK.blockedByYou ? WEEK.open : w.note;
}

/** "Thu May 13 · noon–2 pm": the window's own label from this week, else the day. */
function whenOf(b: Affected, dates: DateRow[]): string {
  for (const d of dates) {
    const w = d.windows.find((x) => x.booking?.id === b.id);
    if (w) return `${d.label} · ${w.time}`;
  }
  return dateLabel(vancouverDate(new Date(b.startsAt)), 'EEE MMM d');
}

export function WeekEditor({ week, back }: { week: WeekDetail; back: ReactNode }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useLandingFocus(heading, []); // FOC-04: arriving on the week (navigation, Back, reload) lands on its title
  useEffect(() => {
    try {
      sessionStorage.setItem(LAST_WEEK_KEY, week.weekStart);
    } catch {
      /* private mode: the list simply doesn't land on the row */
    }
  }, [week.weekStart]);
  // fresh server data after a change: the optimistic choices have landed
  const [shown, setShown] = useState(week);
  if (shown !== week) {
    setShown(week);
    setChoice({});
  }

  const focusKey = (key: string) => moveFocus(document.getElementById(`wk-${key}`));

  function done(scope: string, res: ApiResult, after?: () => void) {
    if (res.ok) {
      const line = underWayLine(res.underWay.length);
      setFlash(line ? { scope, text: line, err: false } : null);
      if (line) announce(line);
      after?.();
      router.refresh();
      return;
    }
    setChoice((c) => {
      const next = { ...c };
      delete next[scope];
      return next;
    });
    setFlash({ scope, text: ERRORS.generic, err: true });
    announce(ERRORS.generic);
  }

  /** Block a date or the week: straight in when nothing locked is there, else ask first (wf09 state-block). */
  async function block(scope: string, range: BlockRange) {
    setBusy(true);
    setFlash(null);
    setChoice((c) => ({ ...c, [scope]: true }));
    const preview = await previewBlock(range.startDate, range.endDate);
    if (preview && preview.affected.length > 0) {
      setPending({ scope, range, ...preview });
      setBusy(false);
      return;
    }
    const res = await addBlock(range);
    if (!res.ok && res.locked) setPending({ scope, range, affected: res.affected, underWay: res.underWay });
    else done(scope, res);
    setBusy(false);
  }

  async function unblock(scope: string, blockId: string | null) {
    if (!blockId) return;
    setBusy(true);
    setFlash(null);
    setChoice((c) => ({ ...c, [scope]: false }));
    done(scope, await removeBlock(blockId));
    setBusy(false);
  }

  async function confirm() {
    // one POST per click, however fast the clicks come (the busy state lands a render later)
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const res = await confirmBlock(pending.range, pending.affected);
    if (!res.ok && res.locked && res.affected.length > 0) {
      // the bookings changed since the preview: ask again with the new list
      setPending({ ...pending, affected: res.affected, underWay: res.underWay });
    } else {
      const { scope } = pending;
      setPending(null);
      // 409 with none left: they were already moved (a retry, another tab), so the block is in: done, no empty ask
      const out: ApiResult = !res.ok && res.locked ? { ok: true, underWay: res.underWay } : res;
      done(scope, out, () => focusKey(scope === 'week' ? 'week' : `${scope}-blocked`));
    }
    inFlight.current = false;
    setBusy(false);
  }

  function keep() {
    if (!pending) return;
    const { scope } = pending;
    setPending(null);
    setChoice((c) => ({ ...c, [scope]: false }));
    focusKey(scope === 'week' ? 'week' : `${scope}-open`);
  }

  const blockedNow = (d: DateRow) => choice[d.date] ?? d.state === 'blocked';
  const flashFor = (scope: string) =>
    flash?.scope === scope ? (
      <p className={flash.err ? 'err' : 'ui muted'} style={{ marginTop: 'var(--s2)' }}>
        {flash.text}
      </p>
    ) : null;
  const confirmFor = (scope: string) =>
    pending?.scope === scope ? (
      <BlockConfirm
        id={`block-${scope}`}
        affected={pending.affected}
        underWay={pending.underWay}
        when={(b) => whenOf(b, week.dates)}
        busy={busy}
        onConfirm={confirm}
        onKeep={keep}
      />
    ) : null;

  return (
    <>
      {back}
      <div className="pane-pad" style={{ paddingTop: 'var(--s4)' }}>
        <p className="cap muted">
          {SEASON.weekOf} {week.label} · {week.count}
        </p>
        <h2 className="h1" style={{ marginTop: 'var(--s2)' }} tabIndex={-1} ref={heading}>
          <KeepWhole text={week.heading} />
        </h2>
        <fieldset>
          <legend className="sec-h" style={LEGEND}>
            {WEEK.openToGuests}
          </legend>
          {week.dates.map((d) => {
            const free = d.windows.filter((w) => !w.booking);
            const booked = d.windows.filter((w) => w.booking);
            const isBlocked = blockedNow(d);
            return (
              <div key={d.date}>
                <div className="winrow">
                  <p>
                    <span className="t">
                      <KeepWhole text={d.label} />
                    </span>
                    {free.map((w) => (
                      <span className="m" key={w.key}>
                        <KeepWhole text={[w.time, noteFor(w, d, isBlocked)].filter(Boolean).join(' · ')} />
                      </span>
                    ))}
                  </p>
                  {d.editable ? (
                    <div className="seg" role="radiogroup" aria-label={d.label}>
                      <label>
                        <input
                          type="radio"
                          name={`d-${d.date}`}
                          id={`wk-${d.date}-open`}
                          checked={!isBlocked}
                          onChange={() => !busy && unblock(d.date, d.blockId)}
                        />
                        {CK}
                        {WEEK.open}
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`d-${d.date}`}
                          id={`wk-${d.date}-blocked`}
                          checked={isBlocked}
                          onChange={() =>
                            !busy && block(d.date, { startDate: d.date, endDate: d.date, kind: 'blocked' })
                          }
                        />
                        {CK}
                        {WEEK.blocked}
                      </label>
                    </div>
                  ) : null}
                </div>
                {booked.map((w) => (
                  <div className="winrow" key={w.key}>
                    <p>
                      <span className="t">
                        <KeepWhole text={`${d.label} · ${w.time}`} />
                      </span>
                      <span className="m">{w.note}</span>
                    </p>
                    <Link className="textbtn" href={`/admin/requests/${w.booking!.id}`}>
                      <span>
                        {WEEK.openBooking} <span aria-hidden="true">›</span>
                      </span>
                      <Vh>{WEEK.openBookingVh(w.booking!.name)}</Vh>
                    </Link>
                  </div>
                ))}
                {flashFor(d.date)}
                {confirmFor(d.date)}
              </div>
            );
          })}
        </fieldset>
        <fieldset>
          <legend className="sec-h" style={LEGEND}>
            {WEEK.thisWeek}
          </legend>
          <label className="check">
            <input
              type="checkbox"
              id="wk-week"
              checked={choice.week ?? week.wholeWeek.blocked}
              disabled={!week.wholeWeek.editable}
              onChange={(e) => {
                if (busy) return;
                if (e.currentTarget.checked) {
                  block('week', { startDate: week.weekStart, endDate: week.weekEnd, kind: 'blocked' });
                } else unblock('week', week.wholeWeek.blockId);
              }}
            />
            <span>{WEEK.blockWholeWeek}</span>
          </label>
          {flashFor('week')}
          {confirmFor('week')}
          <label className="check">
            <input
              type="checkbox"
              checked={choice.cap ?? week.allowThird}
              onChange={async (e) => {
                if (busy) return;
                const on = e.currentTarget.checked;
                setBusy(true);
                setFlash(null);
                setChoice((c) => ({ ...c, cap: on }));
                done('cap', await setCap(week.weekStart, on ? 3 : null));
                setBusy(false);
              }}
            />
            <span>{WEEK.allowThird}</span>
          </label>
          {flashFor('cap')}
        </fieldset>
        {week.standby.length > 0 ? (
          <>
            <h3 className="sec-h">{WEEK.onStandby}</h3>
            {week.standby.map((s) => (
              <div key={s.id}>
                <div className="sb-row">
                  <p>
                    <span className="t">{s.who}</span>
                    <span className="m">{WEEK.since(s.since)}</span>
                  </p>
                  {s.offer ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        if (!s.offer) return;
                        setBusy(true);
                        setFlash(null);
                        done(s.id, await offerStandby(s.id, s.offer.slotId));
                        setBusy(false);
                      }}
                    >
                      {WEEK.offer(s.offer.label)}
                      <Vh>{WEEK.offerVh(s.name)}</Vh>
                    </Button>
                  ) : null}
                </div>
                {flashFor(s.id)}
              </div>
            ))}
          </>
        ) : null}
      </div>
    </>
  );
}
