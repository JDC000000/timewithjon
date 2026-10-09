'use client';
// src/app/admin/_requests/DateLockSheet.tsx — T2.3.U1: Lock in a dated request (a Big Day, The Encore, The Long
// Distance, a weekend Old Haunt) or a pitch (wireframe 09 A3g2, A3g3, A3h): Date -> Start (the dish's default
// picked; Other… opens a time field) -> Length -> for a pitch, Counts as. Never all-day (C3 rule 14). Its commit
// closes the sheet and starts the same A3b undo window as a slots lock; the POST goes when the window ends.
import { useState } from 'react';
import { Button, Field, KeepWhole, Sheet } from '@/ui';
import { LOCK_SHEET, SHEETS } from '@/content/ui/admin-requests';
import type { CountsToward } from '@/features/availability/types';
import { dishAfterPossessive } from '@/content/menu-helpers';
import { dayLabel, vancouverInstant } from '@/lib/time';
import { clockLabel } from './format';
import {
  commitParts,
  defaultCountsToward,
  defaultsFor,
  lengthOptions,
  lengthWords,
  parseClock,
  startOptions,
} from './lock-sheet';
import { Tick } from './Tick';

export interface DatesTarget {
  date: string;
  start: string;
  lengthMinutes: number;
  countsToward: CountsToward;
}

function Seg<T extends string | number>(props: {
  label: string;
  name: string;
  options: { value: T; words: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <label key={String(o.value)}>
          <input
            type="radio"
            name={props.name}
            checked={props.value === o.value}
            onChange={() => props.onChange(o.value)}
          />
          <Tick />
          {o.words}
        </label>
      ))}
    </div>
  );
}

/** The commit button's two flex items (.btn--dt, QA L4): the verb, then the day and time kept whole. */
export function CommitLabel({ verb, when }: { verb: string; when: string }) {
  return (
    <>
      <span>{verb}</span>{' '}
      <span>
        <KeepWhole text={when} />
      </span>
    </>
  );
}

export function DateLockSheet(props: {
  requestId: string;
  who: string;
  dish: string;
  dishName: string;
  /** Their dates (YYYY-MM-DD); empty for a pitch, which picks any date in the season. */
  dates: string[];
  season: { start: string; end: string };
  pitch: boolean;
  /** QA4 M1: the guest said it's one night away: the overnight length is offered and picked. */
  overnight?: boolean;
  open: boolean;
  onClose: () => void;
  onCommit: (target: DatesTarget, label: string) => void;
}) {
  const d = defaultsFor(props.dish, props.overnight);
  // QA4 M2: a pitch, or a dated request with only a rough window, has no dates to pick from: any season date.
  const anyDate = props.pitch || props.dates.length === 0;
  const [date, setDate] = useState(props.dates[0] ?? '');
  const [start, setStart] = useState<string>(d.start);
  const [other, setOther] = useState<string | null>(null);
  const [otherError, setOtherError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number>(d.minutes);
  const [counts, setCounts] = useState<CountsToward | null>(null);
  const id = `lock-${props.requestId}`;
  const countsToward = counts ?? defaultCountsToward(props.dish, minutes);
  const startAt = other === null ? start : parseClock(other);

  const commit = () => {
    if (!date) return;
    if (!startAt) return setOtherError(LOCK_SHEET.startBad);
    props.onClose();
    const at = vancouverInstant(date, startAt);
    props.onCommit(
      { date, start: startAt, lengthMinutes: minutes, countsToward },
      `${dayLabel(at)}, ${clockLabel(at)}`,
    );
  };

  return (
    <Sheet
      id={id}
      open={props.open}
      onClose={props.onClose}
      title={LOCK_SHEET.title(props.who, dishAfterPossessive(props.dish))}
      closeLabel={SHEETS.close(LOCK_SHEET.title(props.who, dishAfterPossessive(props.dish)))}
      footer={
        <Button variant="commit" dt block type="submit" form={`${id}-form`} disabled={!date}>
          {date && startAt ? <CommitLabel {...commitParts(date, startAt)} /> : LOCK_SHEET.lockOpen}
        </Button>
      }
    >
      <form
        method="post"
        id={`${id}-form`}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        {anyDate ? (
          <Field
            id={`${id}-date`}
            label={LOCK_SHEET.date}
            type="date"
            min={props.season.start}
            max={props.season.end}
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
        ) : (
          <fieldset>
            <legend className="sec-h" style={{ display: 'block', width: '100%', marginTop: 0 }}>
              {LOCK_SHEET.date}
            </legend>
            {props.dates.map((x, i) => (
              <label className="choice" key={x}>
                <span className="rb">
                  <input type="radio" name="date" checked={date === x} onChange={() => setDate(x)} />
                  <Tick />
                </span>
                <span>
                  <span className="t">
                    <KeepWhole text={dayLabel(vancouverInstant(x, '12:00'))} />
                  </span>
                  {i === 0 ? <span className="m">{LOCK_SHEET.firstPick}</span> : null}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <fieldset>
          <legend className="sec-h" style={{ display: 'block', width: '100%' }}>
            {LOCK_SHEET.time}
          </legend>
          <p className="ui" id={`${id}-start-l`}>
            {LOCK_SHEET.start} <span className="muted">{LOCK_SHEET.vancouver}</span>
          </p>
          <Seg
            label={`${LOCK_SHEET.start} ${LOCK_SHEET.vancouver}`}
            name="start"
            value={other === null ? start : 'other'}
            options={[
              ...startOptions(props.dish).map((v) => ({
                value: v,
                words: clockLabel(vancouverInstant('2027-05-08', v)),
              })),
              { value: 'other', words: LOCK_SHEET.other },
            ]}
            onChange={(v) => {
              if (v === 'other') setOther('');
              else {
                setOther(null);
                setStart(v);
              }
              setOtherError(null);
            }}
          />
          {other !== null ? (
            <Field
              id={`${id}-other`}
              label={LOCK_SHEET.startTime}
              placeholder={LOCK_SHEET.startHint}
              value={other}
              error={otherError}
              onChange={(e) => {
                setOther(e.currentTarget.value);
                setOtherError(null);
              }}
            />
          ) : null}
          <p className="ui" style={{ marginTop: 'var(--s4)' }}>
            {LOCK_SHEET.length}
          </p>
          <Seg
            label={LOCK_SHEET.length}
            name="length"
            value={minutes}
            options={lengthOptions(props.dish, props.overnight).map((l) => ({
              value: l.minutes,
              words: l.words,
            }))}
            onChange={setMinutes}
          />
        </fieldset>

        {props.pitch ? (
          <fieldset>
            <legend className="sec-h" style={{ display: 'block', width: '100%' }}>
              {LOCK_SHEET.countsAs}
            </legend>
            <p className="help">{LOCK_SHEET.countsHint}</p>
            <Seg
              label={LOCK_SHEET.countsAs}
              name="counts"
              value={countsToward}
              options={(['big_day', 'weekly_cap', 'none'] as const).map((v) => ({
                value: v,
                words: LOCK_SHEET.counts[v],
              }))}
              onChange={setCounts}
            />
          </fieldset>
        ) : null}

        <p className="ui" style={{ marginTop: 'var(--s5)' }}>
          <KeepWhole
            text={[
              startAt ? clockLabel(vancouverInstant(date || props.season.start, startAt)) : '',
              lengthWords(minutes),
              ...(props.pitch ? [LOCK_SHEET.counts[countsToward]] : []),
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        </p>
      </form>
    </Sheet>
  );
}
