'use client';
// src/app/admin/_requests/ActionSheets.tsx — T2.4.U1 + T2.3.U1: A3's sheets (wireframe 09 A3d Move to stand-by,
// A3f Suggest another time, A3i About your pitch, A3m Weather call). Each is U1's Sheet (modal on
// phones, a side panel from the pack breakpoint; focus to its title, trapped, returned on close). On send the
// sheet closes, focus returns to the control that opened it (Sheet), a status line says what happened, and the
// page re-reads the request. Refusals show inside the sheet in the route's own words.
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button, Field, KeepWhole, Sheet } from '@/ui';
import { ACTIONS, SHEETS } from '@/content/ui/admin-requests';
import type { OpenTime, WeekOption } from '@/features/admin/options';
import { vancouverInstant } from '@/lib/time';
import { shortDate, whenLabel } from './format';
import { emailPreview, emailTime } from './preview';
import { Tick } from './Tick';
import { useAction } from './useAction';

interface Base {
  requestId: string;
  who: string;
  dish: string;
  open: boolean;
  onClose: () => void;
}

/** The sheet chrome + one form: the commit is the footer (outside the scroller, wireframe 09 sheets note). */
function ActionSheet(props: {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  commit: ReactNode;
  busy: boolean;
  disabled?: boolean;
  problem: string | null;
  children: ReactNode;
}) {
  const formId = `${props.id}-form`;
  return (
    <Sheet
      id={props.id}
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      closeLabel={SHEETS.close(props.title)}
      footer={
        <Button variant="commit" block type="submit" form={formId} disabled={props.busy || props.disabled}>
          {props.commit}
        </Button>
      }
    >
      <form
        method="post"
        id={formId}
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!props.busy && !props.disabled) props.onSubmit();
        }}
      >
        {props.problem ? (
          <p className="notice" role="alert">
            {props.problem}
          </p>
        ) : null}
        {props.children}
      </form>
    </Sheet>
  );
}

function Preview({ id, vars }: { id: Parameters<typeof emailPreview>[0]; vars: Record<string, string> }) {
  const p = emailPreview(id, vars);
  return (
    <div style={{ marginTop: 'var(--s5)' }}>
      <p className="cap muted">
        {SHEETS.preview} · {p.subject}
      </p>
      {p.lines.map((l) => (
        <p key={l} className="ui" style={{ marginTop: 'var(--s2)', whiteSpace: 'pre-line' }}>
          {l}
        </p>
      ))}
      <p className="ui" style={{ marginTop: 'var(--s2)' }}>
        {p.signOff}
      </p>
    </div>
  );
}

function Choice(props: {
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  meta?: string;
}) {
  return (
    <label className="choice">
      <span className="rb">
        <input type={props.type} name={props.name} checked={props.checked} onChange={props.onChange} />
        <Tick />
      </span>
      <span>
        <span className="t">
          <KeepWhole text={props.label} />
        </span>
        {props.meta ? <span className="m">{props.meta}</span> : null}
      </span>
    </label>
  );
}

const label = (t: OpenTime) => whenLabel(new Date(t.startsAt), new Date(t.endsAt));

/** A3f: pick open times to offer (E5). */
export function SuggestSheet({ times, ...b }: Base & { times: OpenTime[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const act = useAction();
  const chosen = times.filter((t) => picked.includes(t.slotId));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <ActionSheet
      id={`suggest-${b.requestId}`}
      title={ACTIONS.suggest}
      open={b.open}
      onClose={b.onClose}
      busy={act.busy}
      disabled={chosen.length === 0}
      problem={act.problem}
      commit={SHEETS.suggest.send(Math.max(chosen.length, 1))}
      onSubmit={() =>
        void act.run(
          'POST',
          `/api/admin/requests/${b.requestId}/suggest`,
          { slotIds: picked, lead: '' },
          {
            status: SHEETS.sentTo(b.who),
            after: b.onClose,
          },
        )
      }
    >
      <p className="ui">{SHEETS.suggest.intro(b.who, b.dish)}</p>
      {times.length === 0 ? (
        <p className="ui muted" style={{ marginTop: 'var(--s4)' }}>
          {SHEETS.suggest.none}
        </p>
      ) : (
        <fieldset style={{ marginTop: 'var(--s4)' }}>
          <legend className="sec-h" style={{ display: 'block', width: '100%', marginTop: 0 }}>
            {SHEETS.suggest.legend}
          </legend>
          {times.map((t) => (
            <Choice
              key={t.slotId}
              type="checkbox"
              name="offer"
              checked={picked.includes(t.slotId)}
              onChange={() => toggle(t.slotId)}
              label={label(t)}
            />
          ))}
        </fieldset>
      )}
      {chosen.length > 0 ? (
        <Preview
          id="E5"
          vars={{
            dish: b.dish,
            lead: '',
            times: chosen.map((t) => emailTime(new Date(t.startsAt), new Date(t.endsAt))).join('\n'),
          }}
        />
      ) : null}
    </ActionSheet>
  );
}

/** A3d: move to stand-by for a week (E6). */
export function StandbySheet({ weeks, ...b }: Base & { weeks: WeekOption[] }) {
  // Their own week first (the one they picked), as wireframe 09 A3d lists it.
  const [week, setWeek] = useState<string | null>(weeks[0]?.weekStart ?? null);
  const act = useAction();
  const range = (w: WeekOption) => {
    const a = shortDate(vancouverInstant(w.firstDate, '12:00'));
    const z = shortDate(vancouverInstant(w.lastDate, '12:00'));
    return a === z ? a : `${a}–${z.split(' ')[1]}`;
  };
  return (
    <ActionSheet
      id={`standby-${b.requestId}`}
      title={ACTIONS.standby}
      open={b.open}
      onClose={b.onClose}
      busy={act.busy}
      disabled={!week}
      problem={act.problem}
      commit={SHEETS.standby.commit(b.who)}
      onSubmit={() =>
        void act.run(
          'POST',
          `/api/admin/requests/${b.requestId}/standby`,
          { week },
          {
            status: SHEETS.standby.note(b.who),
            after: b.onClose,
          },
        )
      }
    >
      <p className="ui">{SHEETS.standby.intro(b.who, b.dish)}</p>
      <fieldset style={{ marginTop: 'var(--s4)' }}>
        <legend className="sec-h" style={{ display: 'block', width: '100%', marginTop: 0 }}>
          {SHEETS.standby.legend}
        </legend>
        {weeks.map((w) => (
          <Choice
            key={w.weekStart}
            type="radio"
            name="week"
            checked={week === w.weekStart}
            onChange={() => setWeek(w.weekStart)}
            label={range(w)}
            meta={w.state === 'spoken_for' ? SHEETS.standby.full : SHEETS.standby.open}
          />
        ))}
      </fieldset>
    </ActionSheet>
  );
}

/** A3i: About your pitch: the smaller version (E8, with how long it is in Jon's words) or an honest no (E9). */
export function PitchSheet({ lengthGuess, ...b }: Base & { lengthGuess: string }) {
  const [reply, setReply] = useState<'smaller' | 'no'>('smaller');
  const [length, setLength] = useState(lengthGuess);
  const [lengthError, setLengthError] = useState<string | null>(null);
  const act = useAction();
  const submit = () => {
    if (reply === 'smaller' && !length.trim()) return setLengthError(SHEETS.pitch.lengthMissing);
    const body = reply === 'smaller' ? { reply, length: length.trim() } : { reply };
    void act.run('POST', `/api/admin/requests/${b.requestId}/pitch`, body, {
      status: SHEETS.sentTo(b.who),
      after: b.onClose,
    });
  };
  return (
    <ActionSheet
      id={`pitch-${b.requestId}`}
      title={SHEETS.pitch.open}
      open={b.open}
      onClose={b.onClose}
      busy={act.busy}
      problem={act.problem}
      commit={SHEETS.pitch.send}
      onSubmit={submit}
    >
      <fieldset>
        <legend className="sec-h" style={{ display: 'block', width: '100%', marginTop: 0 }}>
          {SHEETS.pitch.legend}
        </legend>
        <Choice
          type="radio"
          name="reply"
          checked={reply === 'smaller'}
          onChange={() => setReply('smaller')}
          label={SHEETS.pitch.smaller}
        />
        <Choice
          type="radio"
          name="reply"
          checked={reply === 'no'}
          onChange={() => setReply('no')}
          label={SHEETS.pitch.no}
        />
      </fieldset>
      {reply === 'smaller' ? (
        <Field
          id={`pitch-length-${b.requestId}`}
          label={SHEETS.pitch.lengthLabel}
          hint={SHEETS.pitch.lengthHint}
          value={length}
          maxLength={60}
          error={lengthError}
          onChange={(e) => {
            setLength(e.currentTarget.value);
            setLengthError(null);
          }}
        />
      ) : null}
      <Preview id={reply === 'smaller' ? 'E8' : 'E9'} vars={{ length: length.trim() || '…' }} />
    </ActionSheet>
  );
}

/** A3m: the weather call on a locked Big Day (E10: "It's pouring. Let's move it."). */
export function WeatherSheet(b: Base) {
  const act = useAction();
  return (
    <ActionSheet
      id={`weather-${b.requestId}`}
      title={SHEETS.weather.open}
      open={b.open}
      onClose={b.onClose}
      busy={act.busy}
      problem={act.problem}
      commit={SHEETS.weather.send}
      onSubmit={() =>
        void act.run(
          'POST',
          `/api/admin/requests/${b.requestId}/weather`,
          {},
          {
            status: SHEETS.sentTo(b.who),
            after: b.onClose,
          },
        )
      }
    >
      <Preview id="E10" vars={{}} />
    </ActionSheet>
  );
}
