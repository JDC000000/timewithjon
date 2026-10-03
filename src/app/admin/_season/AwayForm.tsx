'use client';
// src/app/admin/_season/AwayForm.tsx — T2.5.U1: the A4c away pane (pack gen.py a4c). From / Back on, what guests see
// ("I’m away until May 3. I’ll confirm by May 5.": confirm-by = Back on + 2 days, ruling Q2) and what it does, live as
// Jon types. Errors follow the pack's form pattern (inline + "Things to fix", focus on the summary). FOC-04: arriving
// lands on the title, a failed submit on the summary, a save on the list's away card (ListLanding).
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ERRORS } from '@/content';
import { AWAY } from '@/content/ui/admin-season';
import type { SeasonBlock } from '@/features/admin/season-view';
import { vancouverDate } from '@/lib/time';
import { Button, Field, KeepWhole, TextButton } from '@/ui';
import { announce, moveFocus, useLandingFocus } from '@/ui/focus';
import {
  addBlock,
  confirmBlock,
  previewBlock,
  removeBlock,
  type Affected,
  type ApiResult,
  type BlockRange,
} from './api';
import { awayErrors, awaySummary, type AwayError, type AwayField } from './away-model';
import { BlockConfirm } from './BlockConfirm';
import { dateLabel } from './model';
import { SEASON_PATH } from './paths';

const ids: Record<AwayField, string> = { from: 'aw-from', to: 'aw-to' };
const SAVE_ID = 'aw-save';
const dayOf = (b: Affected) => dateLabel(vancouverDate(new Date(b.startsAt)), 'EEE MMM d');
const sameBookings = (ids: string[], bs: Affected[]) =>
  ids.length === bs.length && bs.every((b) => ids.includes(b.id));

/** A save over locked bookings Jon hasn't been shown yet: asked in place (wf09 state-block, ruling Q3). */
interface Pending {
  range: BlockRange;
  affected: Affected[];
  underWay: Affected[];
}

export function AwayForm({
  away,
  lockedNow,
  back,
}: {
  away: SeasonBlock | null;
  /** The saved range's locked bookings, read on the server, so the line is there from the first paint. */
  lockedNow: number | null;
  back: ReactNode;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [from, setFrom] = useState(away?.startDate ?? '');
  const [to, setTo] = useState(away?.endDate ?? '');
  const [errors, setErrors] = useState<AwayError[]>([]);
  const [tries, setTries] = useState(0);
  // `ids` = the bookings the count stands for (null: the server's first-paint count, which never drives a save)
  const [preview, setPreview] = useState<{ range: string; locked: number; ids: string[] | null } | null>(
    away && lockedNow !== null
      ? { range: `${away.startDate}|${away.endDate}`, locked: lockedNow, ids: null }
      : null,
  );
  const [previewFailed, setPreviewFailed] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const inFlight = useRef(false);
  // the range already added when removing the old one failed (F6): Save again only removes the old one
  const added = useRef<string | null>(null);

  useLandingFocus(heading, []);
  useEffect(() => {
    if (tries > 0) moveFocus(summaryRef.current);
  }, [tries]);

  const summary = awaySummary(from, to);
  // the locked bookings in the range, read as Jon types (T2.5.02 preview)
  const range = summary ? `${from}|${to}` : null;
  useEffect(() => {
    if (!range) return;
    let live = true;
    const [a, b] = range.split('|');
    previewBlock(a ?? '', b ?? '').then((p) => {
      if (!live) return;
      if (p) setPreview({ range, locked: p.affected.length, ids: p.affected.map((x) => x.id) });
      else setPreviewFailed(range);
    });
    return () => {
      live = false;
    };
  }, [range]);
  // INT-06: while a new range's count loads, the line keeps its place (hidden), so nothing below it moves under a
  // pending click
  const fresh = preview !== null && preview.range === range;
  const unchanged = Boolean(away && away.startDate === from && away.endDate === to);
  // pr78-review F1: no Save while the count for a new range is on its way, so Jon never saves past an unread count.
  // If the count can't be had, Save works but asks before moving anyone (settle).
  const loading = Boolean(summary) && !unchanged && !fresh && previewFailed !== range;

  const errorFor = (f: AwayField) => errors.find((e) => e.field === f) ?? null;
  const clear = (f: AwayField) => setErrors((es) => es.filter((e) => e.field !== f));

  function fail(text: string) {
    setFailed(text);
    announce(text);
    return false;
  }

  /** After the new range is in: take the old one away, then back to the list. */
  async function replaceOld(key: string) {
    added.current = key;
    if (away && !(await removeBlock(away.id)).ok) return fail(AWAY.oldStill);
    router.push(`${SEASON_PATH}?saved=away`);
    return true;
  }

  /** The block call's answer: in → replace the old range; locked bookings → confirm or ask; else it failed. */
  async function settle(
    key: string,
    range: BlockRange,
    res: ApiResult,
    confirmed: boolean,
  ): Promise<boolean> {
    if (!res.ok && res.locked && res.affected.length > 0) {
      // pr78-review F1: move them without asking ONLY when the count Jon just read right above Save stands for
      // exactly these bookings; anything else (count failed, a booking locked since, a confirm that found more) asks
      const seen = !confirmed && fresh && preview.ids !== null && sameBookings(preview.ids, res.affected);
      if (!seen) {
        setPending({ range, affected: res.affected, underWay: res.underWay });
        return false;
      }
      return settle(key, range, await confirmBlock(range, res.affected), true);
    }
    // a 409 with none left (F4): they were already moved, so the block is in
    if (res.ok || res.locked) return replaceOld(key);
    return fail(ERRORS.generic);
  }

  /** One job at a time, however fast the clicks come (busy lands a render later). */
  async function run(job: () => Promise<boolean>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(null);
    const left = await job();
    inFlight.current = false;
    if (!left) setBusy(false);
  }

  function save() {
    if (loading) return;
    const errs = awayErrors(from, to);
    setErrors(errs);
    setFailed(null);
    if (errs.length > 0 || !summary) {
      setTries((n) => n + 1);
      return;
    }
    if (unchanged) {
      router.push(`${SEASON_PATH}?saved=away`);
      return;
    }
    const key = `${from}|${to}`;
    const range: BlockRange = { startDate: from, endDate: to, kind: 'away', confirmBy: summary.confirmBy };
    setPending(null);
    void run(async () =>
      added.current === key ? replaceOld(key) : settle(key, range, await addBlock(range), false),
    );
  }

  function confirm() {
    const p = pending;
    if (!p) return;
    void run(async () => {
      const res = await confirmBlock(p.range, p.affected);
      if (res.ok || !res.locked || res.affected.length === 0) setPending(null);
      return settle(`${p.range.startDate}|${p.range.endDate}`, p.range, res, true);
    });
  }

  function keep() {
    setPending(null);
    moveFocus(document.getElementById(SAVE_ID));
  }

  function turnOff() {
    if (!away) return;
    void run(async () => {
      if (!(await removeBlock(away.id)).ok) return fail(ERRORS.generic);
      router.push(`${SEASON_PATH}?saved=off`);
      return true;
    });
  }

  function field(f: AwayField, label: string, value: string, set: (v: string) => void) {
    return (
      <Field
        id={ids[f]}
        label={label}
        error={errorFor(f)?.inline ?? null}
        type="date"
        required
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          set(e.currentTarget.value);
          clear(f);
        }}
      />
    );
  }

  return (
    <>
      {back}
      <form
        method="post"
        className="pane-pad"
        style={{ paddingTop: 'var(--s4)' }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="cap muted">{AWAY.cap}</p>
        <h2 className="h1" style={{ marginTop: 'var(--s2)' }} tabIndex={-1} ref={heading}>
          {AWAY.title}
        </h2>
        <div
          className="errsum"
          tabIndex={-1}
          hidden={errors.length === 0}
          aria-labelledby="es-h"
          ref={summaryRef}
        >
          <h2 id="es-h">{AWAY.toFix(errors.length)}</h2>
          <ul>
            {errors.map((e) => (
              <li key={e.field}>
                <a
                  href={`#${ids[e.field]}`}
                  onClick={(ev) => {
                    ev.preventDefault();
                    moveFocus(document.getElementById(ids[e.field]));
                  }}
                >
                  {e.summary}
                </a>
              </li>
            ))}
          </ul>
        </div>
        {field('from', AWAY.from, from, setFrom)}
        {field('to', AWAY.backOn, to, setTo)}
        {summary ? (
          <>
            <h3 className="sec-h">{AWAY.whatGuestsSee}</h3>
            <p className="notice" style={{ marginTop: 'var(--s4)' }}>
              <KeepWhole text={summary.notice} />
            </p>
            <h3 className="sec-h">{AWAY.whatItDoes}</h3>
            <ul
              className="ui"
              style={{ marginTop: 'var(--s3)', color: 'var(--c-ink)', display: 'grid', gap: 'var(--s2)' }}
            >
              <li>
                <KeepWhole text={summary.hides} />
              </li>
              <li style={fresh ? undefined : { visibility: 'hidden' }} aria-hidden={fresh ? undefined : true}>
                {AWAY.locked(preview?.locked ?? 0)}
              </li>
              <li>
                <KeepWhole text={summary.requests} />
              </li>
            </ul>
          </>
        ) : null}
        {pending ? (
          <BlockConfirm
            id="block-away"
            affected={pending.affected}
            underWay={pending.underWay}
            when={dayOf}
            busy={busy}
            onConfirm={confirm}
            onKeep={keep}
          />
        ) : null}
        {failed ? (
          <p className="err" style={{ marginTop: 'var(--s4)' }}>
            {failed}
          </p>
        ) : null}
        <p className="send">
          <Button
            id={SAVE_ID}
            variant="commit"
            type="submit"
            disabled={loading}
            busy={busy ? AWAY.saving : undefined}
          >
            {AWAY.save}
          </Button>
          {away ? <TextButton onClick={turnOff}>{AWAY.turnOff}</TextButton> : null}
        </p>
      </form>
    </>
  );
}
