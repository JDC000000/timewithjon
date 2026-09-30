'use client';
// S7 date request (T1.6.U1-U3, pack gen.py s07()): the dish header, the month grid with its chips, the rough
// window, the overnight row (dishes that allow it), the Long Distance time zone, Send and the rail. The Old Haunt's
// weekend mode is this flow on weekends only, with the switch back to Thu/Fri times (T1.6.U6, wireframe 05-G2).
// Send checks for a date or a rough window: the error summary takes focus, a pick or a window clears it.
import Link from 'next/link';
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Button, KeepWhole, PhotoSlot } from '@/ui';
import { announce, holdStill, moveFocus } from '@/ui/focus';
import { FLOW } from '@/content';
import { DATES, FLOW_UI, TIME_ZONE } from '@/content/ui/booking';
import { DateGrid } from './DateGrid';
import { ErrorSummary } from './ErrorSummary';
import { DetailsFields, SendFailed, useSend } from './SendDetails';
import { PicksRail } from './PicksRail';
import { initialCalMonth, toggleDate, type CalDay, type CalMonth } from './_lib/date-grid';
import { dateErrors, detailsErrors, errorFor, withoutError, type FormError } from './_lib/form-errors';
import { dishPhotoSlot, NO_GUEST, type DishView, type FlowNotices, type GuestView } from './_lib/flow-view';
import { ELSEWHERE, initialZoneOption, postedZone } from './_lib/time-zone';

export interface DatesFlowProps {
  dish: DishView;
  months: CalMonth[];
  notices: FlowNotices;
  /** The Old Haunt's weekend mode: "Weekends only" and the switch back to Thu/Fri times. */
  weekendsOnly?: boolean;
  switchTo?: { href: string; label: string };
  /** who is sending: a personal invite's name and email, or a general invite's Turnstile */
  guest?: GuestView;
}

const noSubscribe = () => () => {};
/** The phone's zone, read after hydration (the server renders the first option). */
function useDetectedZone(): string | null {
  return useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    () => null,
  );
}

export function DatesFlow({
  dish,
  months,
  notices,
  weekendsOnly = false,
  switchTo,
  guest = NO_GUEST,
}: DatesFlowProps) {
  const [order, setOrder] = useState<string[]>([]);
  const [shownMonth, setShownMonth] = useState(() => initialCalMonth(months, []));
  const [roughOpen, setRoughOpen] = useState(false);
  const [rough, setRough] = useState('');
  const [overnight, setOvernight] = useState(false);
  const detected = useDetectedZone();
  const [zone, setZone] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormError[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const s = useSend(dish.slug, guest);
  const days = new Map(months.flatMap((m) => m.rows.flat()).flatMap((d) => (d ? [[d.date, d]] : [])));

  function onToggle(d: CalDay, el: HTMLButtonElement) {
    const next = toggleDate(order, d.date);
    holdStill(el, () =>
      flushSync(() => {
        setOrder(next.order);
        if (next.order.length) setErrors((e) => withoutError(e, 'picks'));
      }),
    );
    const on = next.order.includes(d.date);
    const swapped = next.swapped ? days.get(next.swapped) : undefined;
    announce(
      on ? `${swapped ? DATES.swapped(swapped.short) : ''}${DATES.picked(d.short)}` : DATES.removed(d.long),
    );
  }

  function onRemove(d: CalDay) {
    setOrder((o) => o.filter((x) => x !== d.date));
    announce(DATES.removed(d.long));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = [...dateErrors(order, rough), ...detailsErrors(s.name, s.email)];
    flushSync(() => setErrors(found));
    if (found.length) return moveFocus(summaryRef.current, 'script');
    void s.submit({
      dates: order,
      windowText: rough,
      overnight,
      guestTimeZone: dish.asksTimeZone
        ? postedZone(zone ?? initialZoneOption(detected), detected)
        : undefined,
    });
  }

  const railItems = [
    ...order.flatMap((date) => {
      const d = days.get(date);
      return d ? [{ key: date, label: d.short }] : [];
    }),
    ...(rough.trim() ? [{ key: 'rough', label: rough.trim() }] : []),
  ];

  return (
    <div className="wrap flow">
      <form className="flow-main" noValidate onSubmit={onSubmit}>
        <div className="flow-top">
          <PhotoSlot slot={dishPhotoSlot(dish.slug)} kind="thumb" />
          <p className="cap">{`${dish.course} · ${dish.name}`}</p>
          <p className="detail">
            <KeepWhole text={dish.detail} />
          </p>
          <h1 className="h1">{FLOW.datesTitle}</h1>
          <p className="lead intro">{DATES.leads[dish.slug] ?? FLOW.datesHint}</p>
          {switchTo && (
            <p>
              <Link className="tap" href={switchTo.href}>
                {switchTo.label}
              </Link>
            </p>
          )}
          {notices.away && (
            <p className="notice" role="note">
              <KeepWhole text={notices.away} />
            </p>
          )}
          <ErrorSummary errors={errors} ref={summaryRef} />
        </div>
        <DateGrid
          months={months}
          order={order}
          shownMonth={shownMonth}
          onShowMonth={setShownMonth}
          onToggle={onToggle}
          onRemove={onRemove}
          weekendsOnly={weekendsOnly}
          picksError={errorFor(errors, 'picks')?.inline ?? null}
        >
          <p>
            <button
              type="button"
              className="textbtn"
              aria-expanded={roughOpen}
              aria-controls="rough"
              onClick={() => setRoughOpen((o) => !o)}
            >
              {DATES.roughToggle}
            </button>
          </p>
          <div className="field" id="rough" hidden={!roughOpen}>
            <label htmlFor="f-rough">
              {FLOW.pitchWhenLabel} <span className="hint">{FLOW.pitchWhenHint}</span>
            </label>
            <input
              className="input"
              id="f-rough"
              name="windowText"
              maxLength={200}
              placeholder={DATES.roughPlaceholder}
              value={rough}
              onChange={(e) => {
                setRough(e.currentTarget.value);
                if (e.currentTarget.value.trim()) setErrors((x) => withoutError(x, 'picks'));
              }}
            />
          </div>
          {dish.overnightAllowed && (
            <label className="check" style={{ marginTop: 'var(--s3)' }}>
              <input
                type="checkbox"
                name="overnight"
                checked={overnight}
                onChange={(e) => setOvernight(e.currentTarget.checked)}
              />
              <span>{DATES.oneNight}</span>
            </label>
          )}
        </DateGrid>
        {dish.asksTimeZone && (
          <div className="field">
            <label htmlFor="f-tz">{FLOW.timeZoneLabel}</label>
            <p className="help" id="f-tz-h" style={{ marginTop: 'var(--s1)' }}>
              {TIME_ZONE.help}
            </p>
            <select
              className="input"
              id="f-tz"
              name="guestTimeZone"
              aria-describedby="f-tz-h"
              value={zone ?? initialZoneOption(detected)}
              onChange={(e) => setZone(e.currentTarget.value)}
            >
              {TIME_ZONE.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value={ELSEWHERE}>{TIME_ZONE.elsewhere}</option>
            </select>
          </div>
        )}
        <DetailsFields s={s} errors={errors} onFixed={(k) => setErrors((x) => withoutError(x, k))} />
        <p className="send">
          <Button variant="commit" type="submit" busy={s.sending ? FLOW_UI.sending : undefined}>
            {FLOW.send}
          </Button>
          <span className="ui muted">{DATES.count(order.length)}</span>
        </p>
        <SendFailed s={s} />
      </form>
      <PicksRail dish={dish} heading={DATES.chipsLabel} items={railItems} />
    </div>
  );
}
