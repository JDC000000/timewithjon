'use client';
// src/app/new-date/form.tsx — T2.4.U2 S18 new-date form: the S7 date grid (or the pitch's rough window) and ONE
// POST, Send → /api/offer/propose with the single-use token in the BODY (ProposeBody: token, clientKey, hp and the
// choices), never the URL; strict-origin referrer. The pick_new_date token opens no availability feed, so the grid
// shows the season (QA H2: from the page's span, so it opens on the season's first month and other days are off)
// with the engine's off dates greyed, as /book does (QA r3 M2: the household hold, blocks); the server validates
// the dates too (its line is shown as is). After Send the page re-reads.
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ERRORS, FLOW } from '@/content';
import { keyFor, type KeyedBody } from '@/lib/client-key';
import { DATES } from '@/content/ui/booking';
import { STORY_FORM } from '@/content/ui/guest-after';
import { Button } from '@/ui';
import { announce, moveFocus } from '@/ui/focus';
import { DateGrid } from '../book/[dish]/DateGrid';
import { calMonths, initialCalMonth, toggleDate, type CalDay } from '../book/[dish]/_lib/date-grid';
import type { DishView } from '../book/[dish]/_lib/flow-view';
import { postJson } from '../offer/take';
import type { Span } from './span';

export function NewDateForm(p: {
  token: string;
  dish: DishView;
  form: 'dates' | 'pitch';
  /** newDateSpan(): the season from today; null when it is over (the rough window only). */
  span: Span | null;
  /** The engine's off dates (rule 11: blocks, away, the household hold, pre-release, past), as /book greys them. */
  unavailable: readonly string[];
  /** r5 N-L7: the stored "one night away" (e.g. after a weather call): the box starts as they left it. */
  overnight?: boolean;
}) {
  const router = useRouter();
  const { start, end } = p.span ?? {};
  const cal = useMemo(
    () =>
      p.form === 'dates' && start && end ? calMonths({ start, end }, p.unavailable, p.dish.dateRule) : [],
    [p.form, start, end, p.dish.dateRule, p.unavailable],
  );
  const [order, setOrder] = useState<string[]>([]);
  const [shown, setShown] = useState(() => (cal.length ? initialCalMonth(cal, []) : ''));
  const [rough, setRough] = useState('');
  const [overnight, setOvernight] = useState(p.overnight ?? false);
  const [need, setNeed] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyed = useRef<KeyedBody | null>(null); // one key per set of choices (ENG-14)
  const errRef = useRef<HTMLParagraphElement>(null);

  function onDay(d: CalDay) {
    const next = toggleDate(order, d.date);
    setOrder(next.order);
    if (next.order.length) setNeed(null);
    announce(next.order.includes(d.date) ? DATES.picked(d.short) : DATES.removed(d.long));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (order.length === 0 && rough.trim() === '') {
      flushSync(() => setNeed(ERRORS.noTimes));
      return moveFocus(errRef.current, 'script');
    }
    setBusy(true);
    setFailed(null);
    const choices = { dates: order, ...(rough.trim() ? { windowText: rough.trim() } : {}), overnight };
    keyed.current = keyFor(keyed.current, choices);
    const json = await postJson('/api/offer/propose', {
      token: p.token,
      ...choices,
      clientKey: keyed.current.key,
      hp: '',
    });
    setBusy(false);
    if (!json.ok) return setFailed(json.message ?? ERRORS.generic);
    if (json.message) setSaid(json.message);
    router.refresh();
  }

  if (said)
    return (
      <p className="lead intro s18-line" role="status">
        {said}
      </p>
    );
  // QA L9: always on show here (S7 hides it behind a toggle), so no example inside the box: the hint gives one.
  const roughField = (
    <div className="field">
      <label htmlFor="s18-rough">
        {FLOW.pitchWhenLabel} <span className="hint">{FLOW.pitchWhenHint}</span>
      </label>
      <input
        className="input"
        id="s18-rough"
        name="windowText"
        maxLength={200}
        value={rough}
        onChange={(e) => {
          setRough(e.currentTarget.value);
          if (e.currentTarget.value.trim()) setNeed(null);
        }}
      />
    </div>
  );
  return (
    <form
      method="post"
      className="flow-main s18-new-date"
      noValidate
      onSubmit={onSubmit}
      data-s18-form={p.form}
    >
      {need && (
        <p className="ui s18-line" role="alert" tabIndex={-1} ref={errRef}>
          {need}
        </p>
      )}
      {p.form === 'dates' && cal.length > 0 ? (
        <DateGrid
          months={cal}
          order={order}
          shownMonth={shown}
          onShowMonth={setShown}
          onToggle={onDay}
          onRemove={(d) => setOrder((o) => o.filter((x) => x !== d.date))}
          weekendsOnly={false}
          picksError={null}
        >
          {roughField}
          {p.dish.overnightAllowed && (
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
      ) : (
        roughField
      )}
      {failed && (
        <p className="ui s18-line" role="alert">
          {failed}
        </p>
      )}
      <p className="send">
        <Button type="submit" variant="commit" busy={busy ? STORY_FORM.sending : undefined}>
          {FLOW.send}
        </Button>
      </p>
    </form>
  );
}
