'use client';
// src/app/manage/actions.tsx — T2.7.U1 S17's three actions (pack v2.2 s17 .actions rows). Nothing happens until a
// tap: Cancel asks first, in place (QA B: the row becomes "Cancel this one?" with "Yes, cancel" and "Keep it"), then
// POSTs /api/manage/cancel; "Ask for another time" opens the dish's own picker or date form (fed by
// GET /api/availability?dish=<slug>) and POSTs /api/manage/another-time on Send; "Add a story or photo" opens the
// S11 StoryForm posting to /api/stories and /api/photos/sign. Every call carries the raw manage token in the
// x-twj-manage header (MANAGE_HEADER), never the body or the URL, and a strict-origin referrer (origin only).
// After a change the page re-reads its server model (router.refresh), so the status shown is the DB's.
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { ERRORS, FLOW } from '@/content';
import { MANAGE_UI } from '@/content/manage';
import { DATES, PICKER } from '@/content/ui/booking';
import { STORY_FORM } from '@/content/ui/guest-after';
import type { EngineOutput } from '@/features/availability/types';
import { Button } from '@/ui';
import { announce, moveFocus } from '@/ui/focus';
import { StoryForm } from '../_guest/story-form';
import { seasonOf } from './_lib/season';
import { DateGrid } from '../book/[dish]/DateGrid';
import { TimePicker } from '../book/[dish]/TimePicker';
import { calMonths, initialCalMonth, toggleDate, type CalDay } from '../book/[dish]/_lib/date-grid';
import type { DishView } from '../book/[dish]/_lib/flow-view';
import {
  initialMonth,
  pickerMonths,
  type PickerMonth,
  type TileView,
} from '../book/[dish]/_lib/picker-model';
import { EMPTY_SELECTION, isPicked, selectionReducer } from '../book/[dish]/_lib/selection';

export interface ManageActionsProps {
  token: string;
  /** MANAGE_HEADER ('x-twj-manage'), passed from the server so this bundle never imports the token module. */
  header: string;
  dish: DishView;
  /** Which form "Ask for another time" opens: the S6 picker, the S7 date form or the pitch's rough window. */
  form: 'slots' | 'dates' | 'pitch';
  /** Carried 1: "Sending new times frees up {when}." while a time is locked, else null. */
  frees: string | null;
  canCancel: boolean;
  canAskAnother: boolean;
  canAddStory: boolean;
  maxPhotos: number;
}

type Open = null | 'another' | 'story';

export function ManageActions(p: ManageActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [cancelling, setCancelling] = useState(false);
  /** QA B: the Cancel row is showing its question */
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const auth = useMemo(() => ({ [p.header]: p.token }), [p.header, p.token]);
  const target = useMemo(() => ({ headers: auth }), [auth]);

  async function onCancel() {
    if (cancelling) return;
    setCancelling(true);
    setFailed(null);
    const json = await post('/api/manage/cancel', auth, {});
    setCancelling(false);
    if (!json.ok) return setFailed(json.message ?? ERRORS.generic);
    setAsking(false);
    setOpen(null);
    if (json.already) setSaid(json.message ?? null);
    router.refresh();
  }

  function ask() {
    flushSync(() => setAsking(true));
    moveFocus(keepRef.current, 'script');
  }
  function keep() {
    flushSync(() => setAsking(false));
    moveFocus(cancelRef.current, 'script');
  }

  return (
    <>
      {failed && (
        <p className="ui" role="alert" style={{ marginTop: 'var(--s4)', color: 'var(--c-ink)' }}>
          {failed}
        </p>
      )}
      {said && (
        <p className="ui" role="status" style={{ marginTop: 'var(--s4)', color: 'var(--c-ink)' }}>
          {said}
        </p>
      )}
      <div className="actions" data-manage-actions="">
        {p.canAskAnother && (
          <div>
            <Row expanded={open === 'another'} onClick={() => setOpen(open === 'another' ? null : 'another')}>
              {MANAGE_UI.askAnother}
            </Row>
            {p.frees && <p className="note">{p.frees}</p>}
          </div>
        )}
        {p.canCancel &&
          (asking ? (
            <div
              className="manage-confirm"
              role="group"
              aria-labelledby="m-cancel-q"
              data-manage-confirm=""
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !cancelling) {
                  e.preventDefault();
                  keep();
                }
              }}
            >
              <p className="ui" id="m-cancel-q">
                {MANAGE_UI.cancelAsk}
              </p>
              <div className="manage-confirm-actions">
                <Button busy={cancelling ? MANAGE_UI.cancelYes : undefined} onClick={onCancel}>
                  {MANAGE_UI.cancelYes}
                </Button>
                <button type="button" className="textbtn" ref={keepRef} onClick={keep} disabled={cancelling}>
                  {MANAGE_UI.cancelKeep}
                </button>
              </div>
            </div>
          ) : (
            <Row onClick={ask} ref={cancelRef}>
              {MANAGE_UI.cancel}
            </Row>
          ))}
        {p.canAddStory && (
          <Row expanded={open === 'story'} onClick={() => setOpen(open === 'story' ? null : 'story')}>
            {MANAGE_UI.addStory}
          </Row>
        )}
      </div>
      {open === 'another' && (
        <AnotherTime
          auth={auth}
          dish={p.dish}
          form={p.form}
          onDone={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}
      {open === 'story' && (
        <div data-manage-story="">
          <StoryForm
            endpoint="/api/stories"
            target={target}
            maxPhotos={p.maxPhotos}
            before60={false}
            skipHref="/"
          />
        </div>
      )}
    </>
  );
}

/** One pack .actions row as a button (site.css `.actions button.row`): label, then the chevron. */
function Row({
  ref,
  ...p
}: {
  children: ReactNode;
  onClick: () => void;
  expanded?: boolean;
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className="row"
      aria-expanded={p.expanded}
      aria-busy={p.busy || undefined}
      disabled={p.busy}
      onClick={p.onClick}
    >
      <span>{p.children}</span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

interface Answer {
  ok?: boolean;
  already?: boolean;
  message?: string;
}

/** POST with the token header. strict-origin: the Origin check passes and no Referer carries the ?t= token. */
async function post(url: string, auth: Record<string, string>, body: unknown): Promise<Answer> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify(body),
      referrerPolicy: 'strict-origin',
    });
    return ((await res.json().catch(() => null)) as Answer | null) ?? {};
  } catch {
    return {};
  }
}

/** The picker's own tiles only: a re-request has no stand-by (RerequestChoices), so its rows are left out. */
function tilesOnly(months: PickerMonth[]): PickerMonth[] {
  return months
    .map((m) => ({ ...m, rows: m.rows.filter((r) => r.kind === 'week' || r.kind === 'away') }))
    .filter((m) => m.rows.some((r) => r.kind === 'week'));
}

function AnotherTime(p: {
  auth: Record<string, string>;
  dish: DishView;
  form: 'slots' | 'dates' | 'pitch';
  onDone: () => void;
}) {
  const [engine, setEngine] = useState<EngineOutput | 'error' | null>(
    p.form === 'pitch' ? emptyEngine : null,
  );
  useEffect(() => {
    if (p.form === 'pitch') return;
    const ac = new AbortController();
    fetch(`/api/availability?dish=${encodeURIComponent(p.dish.slug)}`, {
      headers: p.auth,
      referrerPolicy: 'strict-origin',
      signal: ac.signal,
    })
      .then(async (res) => (res.ok ? setEngine((await res.json()) as EngineOutput) : setEngine('error')))
      .catch(() => ac.signal.aborted || setEngine('error'));
    return () => ac.abort();
  }, [p.auth, p.dish.slug, p.form]);

  if (engine === null) return <p className="ui muted" aria-busy="true" data-manage-another="loading" />;
  if (engine === 'error')
    return (
      <p className="ui" role="alert" data-manage-another="error">
        {ERRORS.generic}
      </p>
    );
  return <AnotherForm {...p} engine={engine} />;
}
const emptyEngine: EngineOutput = { weeks: [], unavailableDates: [] };

function AnotherForm(p: {
  auth: Record<string, string>;
  dish: DishView;
  form: 'slots' | 'dates' | 'pitch';
  engine: EngineOutput;
  onDone: () => void;
}) {
  const months = useMemo(() => tilesOnly(pickerMonths(p.engine.weeks)), [p.engine]);
  const cal = useMemo(
    () =>
      p.form === 'dates' ? calMonths(seasonOf(p.engine), p.engine.unavailableDates, p.dish.dateRule) : [],
    [p.form, p.engine, p.dish.dateRule],
  );
  const [selection, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const [shownMonth, setShownMonth] = useState(() => initialMonth(months, [], null) ?? '');
  const [order, setOrder] = useState<string[]>([]);
  const [shownCal, setShownCal] = useState(() => (cal.length ? initialCalMonth(cal, []) : ''));
  const [rough, setRough] = useState('');
  const [overnight, setOvernight] = useState(false);
  const [need, setNeed] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientKey] = useState(() => crypto.randomUUID());
  const [tileRefs] = useState(() => new Map<string, HTMLButtonElement>());
  const errRef = useRef<HTMLParagraphElement>(null);

  function onTile(tile: TileView) {
    const on = !isPicked(selection, tile.slotId);
    dispatch({ type: 'toggle', slotId: tile.slotId });
    if (on) setNeed(null);
    const n = selection.picks.length + (on ? 1 : -1);
    announce(on ? PICKER.picked(tile.label, n) : PICKER.removed(tile.label, n));
  }
  function onDay(d: CalDay) {
    const next = toggleDate(order, d.date);
    setOrder(next.order);
    if (next.order.length) setNeed(null);
    announce(next.order.includes(d.date) ? DATES.picked(d.short) : DATES.removed(d.long));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const empty =
      p.form === 'slots' ? selection.picks.length === 0 : order.length === 0 && rough.trim() === '';
    if (empty) {
      flushSync(() => setNeed(ERRORS.noTimes));
      return moveFocus(errRef.current, 'script');
    }
    setBusy(true);
    setFailed(null);
    const choices =
      p.form === 'slots'
        ? { slotIds: [...selection.picks] }
        : { dates: order, ...(rough.trim() ? { windowText: rough.trim() } : {}), overnight };
    const json = await post('/api/manage/another-time', p.auth, { ...choices, clientKey, hp: '' });
    setBusy(false);
    if (json.ok) return p.onDone();
    setFailed(json.message ?? ERRORS.generic);
  }

  // QA L9: always on show here (S7 hides it behind a toggle), so no example inside the box: the hint gives one.
  const roughField = (
    <div className="field">
      <label htmlFor="m-rough">
        {FLOW.pitchWhenLabel} <span className="hint">{FLOW.pitchWhenHint}</span>
      </label>
      <input
        className="input"
        id="m-rough"
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
    <form method="post" className="flow-main" noValidate onSubmit={onSubmit} data-manage-another={p.form}>
      {need && (
        <p className="ui" role="alert" tabIndex={-1} ref={errRef} style={{ color: 'var(--c-ink)' }}>
          {need}
        </p>
      )}
      {p.form === 'slots' && (
        <TimePicker
          months={months}
          shownMonth={shownMonth}
          onShowMonth={setShownMonth}
          selection={selection}
          onTile={onTile}
          onStandby={() => {}}
          picksError={null}
          tileRefs={tileRefs}
        />
      )}
      {p.form === 'dates' && (
        <DateGrid
          months={cal}
          order={order}
          shownMonth={shownCal}
          onShowMonth={setShownCal}
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
      )}
      {p.form === 'pitch' && roughField}
      {failed && (
        <p className="ui" role="alert" style={{ color: 'var(--c-ink)' }}>
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
