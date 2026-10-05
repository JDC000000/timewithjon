'use client';
// src/app/admin/_requests/DetailPane.tsx — A3 one request (pack a3-request-detail, a3b-lock-undo, a3c-more-sheet;
// wireframe 09 A3d-A3q). T2.2.U2: caption, name, Jon-only flags, facts, their times (a radio group: the earliest
// open time is picked) and the sticky action bar (Lock in {time} · Suggest another time · ⋯: a menu from 600 px,
// a modal sheet below). T2.3.U1: Lock in opens the 10 s undo window (A3b; the POST goes when it ends, or at once
// if Jon leaves, reloads or hides the tab inside it: PR-G, pending-lock.ts; only Undo cancels), override ticks, the dates-mode Lock sheet. T2.4.U1:
// Suggest, Move to stand-by, About your pitch, Weather call sheets. T2.10.U1: Join / Close (handled in person) /
// Make {name} the host. A3l: Cancel for the guest, confirmed in the page. T2.8.U1: the autosaving notes.
// Focus never goes by hand: the focus helper moves it (after Undo, a refusal, the send, a confirm) and the bar
// never covers the focused control (site.css scroll-padding, FOC-05). The sealed plan is never here (C4).
import { useRouter } from 'next/navigation';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { Button, KeepWhole, Menu, Sheet, TextButton, Toast } from '@/ui';
import { announce, keepVisible, moveFocus } from '@/ui/focus';
import { JON_FLAGS } from '@/content';
import { ACTIONS, DETAIL, LOCK, LOCK_SHEET, MAIL, NOTES, ordinal, SHEETS } from '@/content/ui/admin-requests';
import type { RequestOptions } from '@/features/admin/options';
import { PitchSheet, StandbySheet, SuggestSheet, WeatherSheet } from './ActionSheets';
import { DateLockSheet, type DatesTarget } from './DateLockSheet';
import type { DetailView } from './detail-view';
import { whenLabel } from './format';
import { send } from './api';
import { type LockOutcome, type LockTicks, sendLock } from './lock-logic';
import { commitOnLeave, createPendingCommit } from './pending-lock';
import { NoteField } from './NoteField';
import { CheckActions } from '../(app)/requests/_check/CheckActions';
import { Tick } from './Tick';
import { useAction } from './useAction';

type MenuItem = ComponentProps<typeof Menu>['items'][number];

export interface DetailPaneProps {
  requestId: string;
  email: string;
  /** For "Text {name}" on the RSVP flag (T3.15.U1); private, admin only. */
  phone: string | null;
  dish: string;
  dishName: string;
  season: { start: string; end: string };
  joinedToRequestId: string | null;
  /** E8's length words, prefilled from the request (Q9). */
  pitchLength: string;
  view: DetailView;
  options: RequestOptions | null;
  notes: { before60: string; jon: string };
}

type SheetName = 'more' | 'suggest' | 'standby' | 'lock' | 'pitch' | 'weather' | null;
type Target = { slotId: string } | DatesTarget;

export function DetailPane(p: DetailPaneProps) {
  const { requestId, view, options } = p;
  const router = useRouter();
  const act = useAction();
  const firstPick = (view.times.find((t) => t.open) ?? view.times.find((t) => t.lockable))?.slotId ?? null;
  const [picked, setPicked] = useState<string | null>(firstPick);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [ticks, setTicks] = useState<LockTicks>({ overrideWeek: false, bookAnyway: false });
  // A3b: 'window' = the toast counts down; 'sending' = the POST is out; 'locked'/'undone'/'refused' = a line in
  // the page (a refusal is an alert and takes focus: never a silent no-op).
  const [phase, setPhase] = useState<'idle' | 'window' | 'sending' | 'locked' | 'undone' | 'refused'>('idle');
  const [lockedLine, setLockedLine] = useState<string | null>(null);
  // QA r3 L1: "Locked in. Invite sent." belongs to this lock only. Once the page has read the request as locked and
  // then reads it otherwise (Cancel for the guest, a Weather call), the line goes. Adjusted while rendering, as
  // React advises for state that follows props, so no stale frame shows it.
  const [sawLocked, setSawLocked] = useState(false);
  if (lockedLine && view.filter === 'locked' && !sawLocked) setSawLocked(true);
  if (lockedLine && sawLocked && view.filter !== 'locked') {
    setLockedLine(null);
    setSawLocked(false);
  }
  const [pending, setPending] = useState<{ target: Target; label: string } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const capRef = useRef<HTMLParagraphElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const copiedRef = useRef<HTMLParagraphElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const focusCapWhenLocked = useRef(false);
  const mounted = useRef(true);
  // The pending lock (PR-G): one commit per window, keepalive so a POST sent as the page goes still lands.
  const [lockCtl] = useState(() =>
    createPendingCommit((j: { requestId: string; target: Target; ticks: LockTicks }) =>
      sendLock(j.requestId, j.target, j.ticks, (m, u, b) => send(m, u, b, { keepalive: true })),
    ),
  );

  const pickedTime = view.times.find((t) => t.slotId === picked);
  const needsTick = pickedTime?.override ?? null;
  const canLockSlot = Boolean(pickedTime?.lockable) && (!needsTick || ticks[needsTick]);
  const datesMode = view.dateKeys.length > 0 || view.pitch;
  // Once the page reads it as locked, the window is over whatever the phase says (no state reset in an effect).
  const locking = view.open && (phase === 'window' || phase === 'sending');
  const close = () => setSheet(null);

  // A3b2: the page re-read the request as locked. Focus goes to the LOCKED IN caption only if it was on Undo when
  // the timer fired (wireframe 09 timing contract); otherwise it stays where Jon put it.
  useEffect(() => {
    if (view.open) return;
    if (focusCapWhenLocked.current) moveFocus(capRef.current, 'script');
    focusCapWhenLocked.current = false;
  }, [view.open]);
  useEffect(() => {
    if (phase === 'undone' || phase === 'refused') moveFocus(noteRef.current, 'script');
  }, [phase]);
  useEffect(() => {
    if (confirmCancel) moveFocus(questionRef.current, 'script');
  }, [confirmCancel]);

  const startWindow = (target: Target, label: string) => {
    if (locking || !lockCtl.start({ requestId, target, ticks })) return;
    setRefusal(null);
    setLockedLine(null);
    setPending({ target, label });
    setPhase('window');
  };
  const settle = (res: LockOutcome) => {
    if (!mounted.current) return; // left the page: the keepalive POST landed on its own
    if (res.ok) {
      setLockedLine(res.standbyOfferLive ? `${LOCK.sent} ${LOCK.standbyOfferLive}` : LOCK.sent);
      setPhase('locked');
    } else {
      focusCapWhenLocked.current = false;
      setRefusal(res.message);
      setPhase('refused');
    }
    router.refresh();
  };
  // The window ends (the count ran out), or Jon leaves / hides the tab inside it: the lock goes now, once.
  const commitLock = () => {
    const sent = lockCtl.commit();
    if (!sent) return;
    focusCapWhenLocked.current = Boolean(document.activeElement?.closest('.toast'));
    if (mounted.current) setPhase('sending');
    void sent.then(settle);
  };
  const commitRef = useRef(commitLock);
  useEffect(() => {
    commitRef.current = commitLock;
  });
  useEffect(() => {
    mounted.current = true;
    const off = commitOnLeave(() => commitRef.current());
    return () => {
      off();
      mounted.current = false;
      commitRef.current(); // unmounted mid-window (a link, Back, another request): still locks
    };
  }, []);

  const copyEmail = () => {
    void navigator.clipboard?.writeText(p.email).catch(() => undefined);
    setSheet(null);
    const line = ACTIONS.copied(p.email);
    setCopied(line);
    announce(line);
    // The same line shows in the pane, above the bar (pack VD3-14), brought into view.
    requestAnimationFrame(() => keepVisible(copiedRef.current));
  };

  const promote = () =>
    void act.run(
      'POST',
      `/api/admin/requests/${requestId}/promote`,
      {},
      {
        status: SHEETS.join.promoted(view.who),
      },
    );
  // The desktop ⋯ menu (APG); the phone sheet lists the same actions, with Suggest first (wireframe 09 A3c2).
  // A request already on stand-by can't be moved there again (the server refuses it): no such row.
  const canMoveToStandby = view.filter !== 'standby';
  const menuItems: MenuItem[] = [
    ...(canMoveToStandby
      ? [{ key: 'standby', label: ACTIONS.standby, onSelect: () => setSheet('standby') }]
      : []),
    { key: 'copy', label: ACTIONS.copyEmail, onSelect: () => copyEmail() },
    ...(p.joinedToRequestId
      ? [{ key: 'promote', label: SHEETS.join.promote(view.who), onSelect: () => promote() }]
      : []),
  ];

  const lockWhen = datesMode ? (view.dates[0] ?? '') : (pickedTime?.label ?? '');

  return (
    <>
      {phase === 'window' && pending ? (
        <Toast
          message={LOCK.toast(view.who, pending.label)}
          sub={(sec) => LOCK.countdown(sec)}
          pausedText={LOCK.paused}
          undoLabel={LOCK.undo}
          undoVh={LOCK.undoFor(view.who)}
          onUndo={() => {
            if (lockCtl.undo()) setPhase('undone');
          }}
          onExpire={commitLock}
        />
      ) : null}
      <p className="back-row m-only">
        <a className="back" href={view.back.href}>
          <span aria-hidden="true">‹</span> {view.back.label}
        </a>
      </p>
      <form
        method="post"
        className="pane-pad a3-form"
        style={{ paddingTop: 'var(--s4)' }}
        onSubmit={(e) => e.preventDefault()}
      >
        {phase === 'undone' || (phase === 'refused' && refusal) ? (
          <p
            className="notice undone"
            tabIndex={-1}
            ref={noteRef}
            role={phase === 'refused' ? 'alert' : undefined}
          >
            {phase === 'undone' ? LOCK.undone(view.who) : refusal}
          </p>
        ) : null}
        {/* The lock's own words, spoken politely as they change: the window opening, Sending…, then Locked in
            (shown: Jon's confirmation stays on the page). */}
        <div role="status" data-lock-status="">
          {phase === 'window' && pending ? (
            <p className="vh">
              {LOCK.toast(view.who, pending.label)} {LOCK.countdown(10)}
            </p>
          ) : phase === 'sending' ? (
            <p className="vh">{LOCK.sending}</p>
          ) : phase === 'locked' && lockedLine ? (
            <p className="notice">{lockedLine}</p>
          ) : null}
        </div>
        {act.problem ? (
          <p className="notice" role="alert">
            {act.problem}
          </p>
        ) : null}
        {locking ? (
          <p className="cap" data-status ref={capRef}>
            {LOCK.locking}
          </p>
        ) : (
          <p className={view.open || view.spam ? 'cap muted' : 'cap'} data-status tabIndex={-1} ref={capRef}>
            {view.caption.text}
            {view.caption.unit ? <span className="unit">{view.caption.unit}</span> : null}
            {view.caption.after}
          </p>
        )}
        <h2 className="h1 who-h" style={{ marginTop: 'var(--s2)' }}>
          {view.who}
        </h2>
        {view.flags.map((f) => (
          <div key={f} style={{ marginTop: 'var(--s2)' }}>
            <p className="flag">{f}</p>
            {f === MAIL.failed
              ? view.failed
                  .filter((e) => e.resendable)
                  .map((e) => (
                    <p key={e.id}>
                      <TextButton
                        disabled={act.busy}
                        onClick={() =>
                          void act.run('POST', `/api/admin/email/${e.id}/resend`, {}, { status: MAIL.resent })
                        }
                      >
                        {MAIL.resend}
                      </TextButton>
                    </p>
                  ))
              : null}
            {f === JON_FLAGS.bounced ? (
              <p>
                <TextButton onClick={copyEmail}>{ACTIONS.copyEmail}</TextButton>
              </p>
            ) : null}
            {f === JON_FLAGS.rsvpNo && p.phone ? (
              <p className="send">
                <Button href={`sms:${p.phone.replace(/[^\d+]/g, '')}`}>{MAIL.text(view.who)}</Button>
              </p>
            ) : null}
          </div>
        ))}

        {view.open && !locking
          ? options?.joinHosts.map((h) => (
              <div key={h.hostId} style={{ marginTop: 'var(--s4)' }}>
                <p className="flag">
                  <KeepWhole
                    text={SHEETS.join.flag(whenLabel(new Date(h.startsAt), new Date(h.endsAt)), h.name)}
                  />
                </p>
                <p className="send">
                  <Button
                    disabled={act.busy}
                    onClick={() =>
                      void act.run(
                        'POST',
                        `/api/admin/requests/${requestId}/join`,
                        { hostId: h.hostId },
                        {
                          status: SHEETS.join.joined(h.name),
                        },
                      )
                    }
                  >
                    {SHEETS.join.join(h.name)}
                  </Button>{' '}
                  <TextButton
                    onClick={() =>
                      void act.run(
                        'POST',
                        `/api/admin/requests/${requestId}/close-in-person`,
                        {},
                        {
                          status: SHEETS.join.closed,
                        },
                      )
                    }
                  >
                    {SHEETS.join.close}
                  </TextButton>
                </p>
              </div>
            ))
          : null}

        {confirmCancel && view.cancelWords ? (
          <>
            <p
              className="ui"
              tabIndex={-1}
              ref={questionRef}
              style={{ marginTop: 'var(--s5)', color: 'var(--c-ink)' }}
            >
              <KeepWhole
                text={SHEETS.cancel.question(view.who, view.cancelWords.dish, view.cancelWords.day)}
              />
            </p>
            <p className="help">{SHEETS.cancel.line}</p>
            <p className="send">
              <Button
                variant="commit"
                busy={act.busy ? SHEETS.cancel.yes : undefined}
                onClick={() =>
                  void act.run(
                    'POST',
                    `/api/admin/requests/${requestId}/cancel`,
                    {},
                    {
                      status: SHEETS.cancel.done(view.who),
                      after: () => setConfirmCancel(false),
                    },
                  )
                }
              >
                {SHEETS.cancel.yes}
              </Button>{' '}
              <TextButton onClick={() => setConfirmCancel(false)}>{SHEETS.cancel.keep}</TextButton>
            </p>
          </>
        ) : (
          <dl className="kv">
            {view.facts.map((f) => (
              <FactRow key={`${f.label}:${f.value}`} label={f.label} value={f.value} quote={f.quote} />
            ))}
          </dl>
        )}

        {view.open && view.times.length > 0 ? (
          <fieldset style={{ marginTop: 'var(--s6)' }}>
            <legend className="sec-h" style={{ display: 'block', width: '100%', marginTop: 0 }}>
              {DETAIL.theirTimes}
            </legend>
            {view.times.map((t) => (
              <label className="choice" key={t.slotId}>
                <span className="rb">
                  <input
                    type="radio"
                    name="t"
                    value={t.slotId}
                    checked={picked === t.slotId}
                    disabled={!t.lockable || locking}
                    onChange={() => {
                      setPicked(t.slotId);
                      setTicks({ overrideWeek: false, bookAnyway: false });
                    }}
                  />
                  <Tick />
                </span>
                <span>
                  <span className="t">
                    <KeepWhole text={t.label} />
                  </span>
                  <span className="m">
                    <KeepWhole text={t.meta} />
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {view.open && pickedTime && needsTick && !locking ? (
          <label className="check">
            <input
              type="checkbox"
              checked={ticks[needsTick]}
              onChange={(e) => setTicks({ ...ticks, [needsTick]: e.currentTarget.checked })}
            />
            <span>
              {needsTick === 'bookAnyway' ? LOCK.bookAnyway : LOCK.overrideWeek(ordinal(pickedTime.nth ?? 3))}
            </span>
          </label>
        ) : null}

        {view.open && view.dates.length > 0 ? (
          <fieldset style={{ marginTop: 'var(--s6)' }}>
            <legend className="sec-h" style={{ display: 'block', width: '100%', marginTop: 0 }}>
              {DETAIL.theirDates}
            </legend>
            <ul className="ui" style={{ display: 'grid', gap: 'var(--s2)', color: 'var(--c-ink)' }}>
              {view.dates.map((d) => (
                <li key={d}>
                  <KeepWhole text={d} />
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        {view.spam ? <CheckActions requestId={requestId} who={view.who} /> : null}

        {!view.open && !view.spam ? (
          <NoteField
            requestId={requestId}
            field="before60Note"
            id="b60"
            label={NOTES.before60}
            help={NOTES.before60Help}
            initial={p.notes.before60}
          />
        ) : null}
        {view.spam ? null : (
          <NoteField
            requestId={requestId}
            field="jonNote"
            id="jn"
            label={NOTES.jonNote}
            help={NOTES.jonNoteHelp}
            initial={p.notes.jon}
          />
        )}

        {view.filter === 'locked' && !confirmCancel ? (
          <>
            {/* Change time was removed 2026-09-29: a guest who needs another time emails Jon. */}
            {view.bigDayLocked ? (
              <ul className="actions">
                <li>
                  <button
                    className="row"
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setSheet('weather')}
                  >
                    <span>{SHEETS.weather.open}</span>
                    <span aria-hidden="true">›</span>
                  </button>
                </li>
              </ul>
            ) : null}
            <p style={{ marginTop: 'var(--s6)' }}>
              <TextButton onClick={() => setConfirmCancel(true)}>{SHEETS.cancel.link}</TextButton>
            </p>
          </>
        ) : null}

        {copied ? (
          <p className="notice copied" ref={copiedRef}>
            {copied}
          </p>
        ) : null}

        {view.open && locking ? (
          <div className="actbar sending">
            <p className="sending-rect">{LOCK.sending}</p>
          </div>
        ) : null}
        {view.open && !locking ? (
          <div className="actbar">
            {view.pitch ? (
              <Button variant="commit" aria-haspopup="dialog" onClick={() => setSheet('pitch')}>
                {SHEETS.pitch.open}
              </Button>
            ) : null}
            {view.pitch ? (
              <Button aria-haspopup="dialog" onClick={() => setSheet('lock')}>
                {LOCK_SHEET.lockOpen}
              </Button>
            ) : (
              <Button
                variant="commit"
                dt
                disabled={datesMode ? false : !canLockSlot}
                aria-haspopup={datesMode ? 'dialog' : undefined}
                onClick={() =>
                  datesMode
                    ? setSheet('lock')
                    : pickedTime && startWindow({ slotId: pickedTime.slotId }, pickedTime.label)
                }
              >
                <span>{ACTIONS.lockIn}</span>{' '}
                <span>
                  <KeepWhole text={lockWhen} />
                </span>
              </Button>
            )}
            {datesMode ? null : (
              <Button className="sug" aria-haspopup="dialog" onClick={() => setSheet('suggest')}>
                {ACTIONS.suggest}
              </Button>
            )}
            <span className="more-wrap">
              <Button
                className="more more--m"
                aria-label={ACTIONS.more(view.who)}
                aria-haspopup="dialog"
                onClick={() => setSheet('more')}
              >
                ⋯
              </Button>
              <Menu id={`menu-${requestId}`} buttonLabel={ACTIONS.more(view.who)} items={menuItems} />
            </span>
          </div>
        ) : null}
      </form>

      <Sheet
        id={`more-${requestId}`}
        open={sheet === 'more'}
        onClose={close}
        title={ACTIONS.more(view.who)}
        closeLabel={ACTIONS.closeMore(view.who)}
        footer={
          <Button block onClick={close}>
            {ACTIONS.cancel}
          </Button>
        }
      >
        <ul className="actions">
          {datesMode ? null : (
            <li>
              <button className="row" type="button" onClick={() => setSheet('suggest')}>
                <span>{ACTIONS.suggest}</span>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          )}
          {canMoveToStandby ? (
            <li>
              <button className="row" type="button" onClick={() => setSheet('standby')}>
                <span>{ACTIONS.standby}</span>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          ) : null}
          <li>
            <button className="row" type="button" onClick={() => copyEmail()}>
              <span>{ACTIONS.copyEmail}</span>
            </button>
          </li>
          {p.joinedToRequestId ? (
            <li>
              <button className="row" type="button" onClick={() => promote()}>
                <span>{SHEETS.join.promote(view.who)}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </Sheet>

      {options ? (
        <>
          <SuggestSheet
            requestId={requestId}
            who={view.who}
            dish={p.dishName}
            times={options.openTimes}
            open={sheet === 'suggest'}
            onClose={close}
          />
          <StandbySheet
            requestId={requestId}
            who={view.who}
            dish={p.dishName}
            weeks={options.weeks}
            open={sheet === 'standby'}
            onClose={close}
          />
        </>
      ) : null}
      {view.open && datesMode ? (
        <DateLockSheet
          requestId={requestId}
          who={view.who}
          dish={p.dish}
          dishName={p.dishName}
          dates={view.dateKeys}
          season={p.season}
          pitch={view.pitch}
          open={sheet === 'lock'}
          onClose={close}
          onCommit={(target, label) => startWindow(target, label)}
        />
      ) : null}
      {view.pitch ? (
        <PitchSheet
          requestId={requestId}
          who={view.who}
          dish={p.dishName}
          lengthGuess={p.pitchLength}
          open={sheet === 'pitch'}
          onClose={close}
        />
      ) : null}
      {view.bigDayLocked ? (
        <WeatherSheet
          requestId={requestId}
          who={view.who}
          dish={p.dishName}
          open={sheet === 'weather'}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function FactRow({ label, value, quote }: { label: string; value: string; quote?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={quote ? 'quote' : undefined}>{quote ? value : <KeepWhole text={value} />}</dd>
    </>
  );
}
