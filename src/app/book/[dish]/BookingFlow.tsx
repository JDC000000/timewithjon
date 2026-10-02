'use client';
// The booking flow (pack gen.py flow_page(); Surprise Me = s08()): the form (dish header, picker, Send) and the
// rail, sharing one selection. Send checks the picks first (T1.5.U5), then Surprise Me's need-to-know (T1.6.U4):
// the error summary takes focus, the inline lines sit under their controls, and fixing one clears it.
// The Old Haunt's Thu/Fri mode adds the weekend switch link (T1.6.U6).
import Link from 'next/link';
import { useMemo, useReducer, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Button, SummaryBar, Field, KeepWhole, PhotoSlot } from '@/ui';
import { announce, holdStill, moveFocus } from '@/ui/focus';
import { FLOW } from '@/content';
import { FLOW_UI, PICKER, RAIL, SURPRISE } from '@/content/ui/booking';
import { ErrorSummary } from './ErrorSummary';
import { DetailsFields, SendFailed, useSend } from './SendDetails';
import { PicksRail } from './PicksRail';
import { TimePicker, tabId } from './TimePicker';
import {
  DETAILS_ID,
  detailsErrors,
  errorFor,
  FIELD_IDS,
  needErrors,
  pickErrors,
  withoutError,
  type FormError,
} from './_lib/form-errors';
import {
  dishPhotoSlot,
  NO_GUEST,
  pickerHeading,
  pickerLead,
  type DishView,
  type FlowNotices,
  type GuestView,
} from './_lib/flow-view';
import {
  initialMonth,
  monthTileIds,
  tilesInOrder,
  type PickerMonth,
  type TileView,
} from './_lib/picker-model';
import { EMPTY_SELECTION, isPicked, selectionReducer } from './_lib/selection';

export interface BookingFlowProps {
  dish: DishView;
  months: PickerMonth[];
  notices: FlowNotices;
  /** Surprise Me (pack s08): its own heading, "When works" over the picker, and The plan after it. */
  surprise?: boolean;
  /** The Old Haunt's switch to weekend dates (wireframe 05-G). */
  switchTo?: { href: string; label: string };
  /** who is sending: a personal invite's name and email, or a general invite's Turnstile */
  guest?: GuestView;
}

export function BookingFlow({
  dish,
  months,
  notices,
  surprise = false,
  switchTo,
  guest = NO_GUEST,
}: BookingFlowProps) {
  const [selection, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const [shownMonth, setShownMonth] = useState(() => initialMonth(months, [], null));
  const [errors, setErrors] = useState<FormError[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [tileRefs] = useState(() => new Map<string, HTMLButtonElement>());
  const allTiles = useMemo(() => tilesInOrder(months), [months]);
  const picks = allTiles.filter((t) => isPicked(selection, t.slotId));
  const picksError = errorFor(errors, 'picks');
  const [need, setNeed] = useState('');
  const [plan, setPlan] = useState('');
  const s = useSend(dish.slug, guest);

  function onTile(tile: TileView, el: HTMLButtonElement) {
    const on = !isPicked(selection, tile.slotId);
    holdStill(el, () =>
      flushSync(() => {
        dispatch({ type: 'toggle', slotId: tile.slotId });
        if (on) setErrors((e) => withoutError(e, 'picks'));
      }),
    );
    const n = selection.picks.length + (on ? 1 : -1);
    announce(on ? PICKER.picked(tile.label, n) : PICKER.removed(tile.label, n));
  }

  function onStandby(weekStart: string, on: boolean) {
    dispatch({ type: 'standby', weekStart, on });
    if (on) setErrors((e) => withoutError(e, 'picks'));
  }

  /** Remove in the picks list: un-pick, then focus the tile itself (its month shown first, so focus is never lost). */
  function onRemove(tile: TileView) {
    const month = months.find((m) => monthTileIds(m).includes(tile.slotId));
    flushSync(() => {
      dispatch({ type: 'remove', slotId: tile.slotId });
      if (month) setShownMonth(month.key);
    });
    announce(PICKER.removed(tile.label, selection.picks.length - 1));
    moveFocus(tileRefs.get(tile.slotId) ?? null, 'script');
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = [
      ...pickErrors(selection, shownMonth ? tabId(shownMonth) : null),
      ...(surprise ? needErrors(need) : []),
      ...detailsErrors(s.name, s.email),
    ];
    flushSync(() => setErrors(found));
    if (found.length) return moveFocus(summaryRef.current, 'script');
    void s.submit({
      ...(selection.standbyWeek ? { standbyWeek: selection.standbyWeek } : { slotIds: [...selection.picks] }),
      ...(surprise ? { surpriseNeedToKnow: need, surprisePlan: plan } : {}),
    });
  }

  return (
    <div className="wrap flow">
      <form className="flow-main" noValidate onSubmit={onSubmit}>
        <div className="flow-top">
          {!surprise && <PhotoSlot slot={dishPhotoSlot(dish.slug)} kind="thumb" />}
          <p className="cap">{`${dish.course} · ${dish.name}`}</p>
          <p className="detail">
            <KeepWhole text={dish.detail} />
          </p>
          {surprise ? (
            <>
              <h1 className="h1">{SURPRISE.heading}</h1>
              <p className="lead intro">{SURPRISE.lead}</p>
            </>
          ) : (
            <>
              <h1 className="h1">{pickerHeading()}</h1>
              <p className="lead intro">{pickerLead()}</p>
              <p className="ui muted" style={{ marginTop: 'var(--s2)' }}>
                {FLOW.pickerTz}
              </p>
              {switchTo && (
                <p>
                  <Link className="tap" href={switchTo.href}>
                    {switchTo.label}
                  </Link>
                </p>
              )}
            </>
          )}
          {notices.away && (
            <p className="notice" role="note">
              <KeepWhole text={notices.away} />
            </p>
          )}
          <ErrorSummary errors={errors} ref={summaryRef} />
        </div>
        {surprise && (
          <>
            <h2 className="h2" style={{ marginTop: 'var(--s7)' }}>
              {SURPRISE.whenWorks}
            </h2>
            <p className="ui" style={{ marginTop: 'var(--s2)' }}>
              {pickerLead()} <span className="muted">{FLOW.pickerTz}</span>
            </p>
          </>
        )}
        <TimePicker
          months={months}
          shownMonth={shownMonth}
          onShowMonth={setShownMonth}
          selection={selection}
          onTile={onTile}
          onStandby={onStandby}
          picksError={picksError?.inline ?? null}
          tileRefs={tileRefs}
        />
        {surprise && (
          <section className="details" aria-labelledby="pl-h" style={{ paddingTop: 'var(--s7)' }}>
            <h2 className="h2" id="pl-h">
              {SURPRISE.planHeading}
            </h2>
            <Field
              multiline
              id={FIELD_IDS.need}
              name="need"
              label={SURPRISE.needLabel}
              hint={FLOW.surpriseNeedHint}
              required
              maxLength={1000}
              value={need}
              error={errorFor(errors, 'need')?.inline ?? null}
              onChange={(e) => {
                setNeed(e.currentTarget.value);
                if (e.currentTarget.value.trim()) setErrors((x) => withoutError(x, 'need'));
              }}
            />
            <Field
              multiline
              id={FIELD_IDS.plan}
              name="plan"
              label={SURPRISE.planLabel}
              hint={FLOW.surprisePlanHint}
              maxLength={2000}
              value={plan}
              onChange={(e) => setPlan(e.currentTarget.value)}
            />
          </section>
        )}
        <div id={DETAILS_ID}>
          <DetailsFields s={s} errors={errors} onFixed={(k) => setErrors((x) => withoutError(x, k))} />
          <p className="send">
            <Button variant="commit" type="submit" busy={s.sending ? FLOW_UI.sending : undefined}>
              {FLOW.send}
            </Button>
            <span className="ui muted">
              {selection.picks.length ? PICKER.count(selection.picks.length) : PICKER.countNone}
            </span>
          </p>
          <SendFailed s={s} />
        </div>
        <SummaryBar
          count={selection.picks.length ? PICKER.count(selection.picks.length) : null}
          detailsId={DETAILS_ID}
          jumpTo={FIELD_IDS.name}
          detailsLabel={RAIL.yourDetails}
          sendLabel={FLOW.send}
          sendRest={FLOW_UI.barSendRest}
          busy={s.sending ? FLOW_UI.sending : undefined}
        />
      </form>
      <PicksRail
        dish={dish}
        items={picks.map((t) => ({ key: t.slotId, label: t.label }))}
        empty={RAIL.empty}
        onRemove={(id) => {
          const tile = picks.find((t) => t.slotId === id);
          if (tile) onRemove(tile);
        }}
      />
    </div>
  );
}
