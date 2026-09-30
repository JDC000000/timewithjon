'use client';
// S7 month grid (T1.6.U1, pack gen.py s07()/cal_month() + site.js "Date grid"): Monday-first tables of day buttons
// (aria-pressed; off days aria-disabled), one Tab stop for the whole season (roving tabindex; arrows cross months),
// month steps on phones, the date chips and the two-max line. State lives in DatesFlow; this renders it.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { announce, moveFocus } from '@/ui/focus';
import { DATES } from '@/content/ui/booking';
import { PICKER_ID } from './_lib/form-errors';
import { allDays, monthOf, stepDay, tabStopDay, type CalDay, type CalMonth } from './_lib/date-grid';
import { Tick } from './TimePicker';

export const dayId = (date: string) => `d-${date}`;

export interface DateGridProps {
  months: CalMonth[];
  order: string[];
  shownMonth: string;
  onShowMonth: (key: string) => void;
  onToggle: (day: CalDay, el: HTMLButtonElement) => void;
  onRemove: (day: CalDay) => void;
  /** Old Haunt weekend mode: the "Weekends only" caption and the weekday names (wireframe 05-G2). */
  weekendsOnly: boolean;
  picksError: string | null;
  /** The rough window and the overnight row sit inside the fieldset (pack s07). */
  children?: ReactNode;
}

export function DateGrid(p: DateGridProps) {
  const [active, setActive] = useState<string | null>(null);
  const days = allDays(p.months);
  const stop = tabStopDay(p.months, p.order, p.shownMonth, active);
  const shownAt = p.months.findIndex((m) => m.key === p.shownMonth);

  function go(date: string) {
    const month = monthOf(p.months, date);
    flushSync(() => {
      setActive(date);
      if (month && month.key !== p.shownMonth) p.onShowMonth(month.key);
    });
    moveFocus(document.getElementById(dayId(date)), 'keyboard');
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, d: CalDay) {
    // pr80-review F4: a modified key is the browser's or the AT's (Alt+Left is Back), never the grid's.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!d.off) toggle(d, e.currentTarget);
      return;
    }
    const to = stepDay(days, d.date, e.key);
    if (to === null) {
      if (e.key.startsWith('Arrow') || e.key.startsWith('Page') || e.key === 'Home' || e.key === 'End')
        e.preventDefault();
      return;
    }
    e.preventDefault();
    go(to);
  }

  function toggle(d: CalDay, el: HTMLButtonElement) {
    const month = monthOf(p.months, d.date);
    flushSync(() => {
      setActive(d.date);
      if (month && month.key !== p.shownMonth) p.onShowMonth(month.key);
    });
    p.onToggle(d, el);
  }

  function step(by: 1 | -1) {
    const m = p.months[shownAt + by];
    if (!m) return;
    // The Tab stop follows: tabStopDay() keeps it in the month shown.
    flushSync(() => p.onShowMonth(m.key));
    announce(m.name);
  }

  return (
    <fieldset
      className="picker"
      id={PICKER_ID}
      tabIndex={-1}
      aria-describedby={p.picksError ? 'picks-err' : undefined}
    >
      <legend className="vh">{DATES.legend}</legend>
      {p.months.length > 1 && (
        <div className="cal-nav m-only" style={{ marginTop: 'var(--s6)' }}>
          <button
            type="button"
            aria-label={DATES.prevMonth}
            aria-disabled={shownAt <= 0}
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <span className="cal-label" aria-hidden="true">
            {p.months[shownAt]?.name}
          </span>
          <button
            type="button"
            aria-label={DATES.nextMonth}
            aria-disabled={shownAt >= p.months.length - 1}
            onClick={() => step(1)}
          >
            ›
          </button>
        </div>
      )}
      <div className="cal-wrap">
        {p.months.map((m) => (
          <Month
            key={m.key}
            month={m}
            hide={m.key !== p.shownMonth}
            order={p.order}
            stop={stop}
            weekendsOnly={p.weekendsOnly}
            onKey={onKey}
            onToggle={toggle}
          />
        ))}
      </div>
      <p className="err" id="picks-err" hidden={!p.picksError}>
        {p.picksError}
      </p>
      <ul className="chips" aria-label={DATES.chipsLabel}>
        {p.order.map((date) => {
          const d = days.find((x) => x.date === date);
          return (
            d && (
              <li key={date} className="chip">
                <span>{d.short}</span>
                <button
                  type="button"
                  aria-label={DATES.remove(d.long)}
                  onClick={() => {
                    // Un-pick, then focus the day itself (its month shown first, so focus is never lost).
                    const month = monthOf(p.months, d.date);
                    flushSync(() => {
                      setActive(d.date);
                      if (month && month.key !== p.shownMonth) p.onShowMonth(month.key);
                      p.onRemove(d);
                    });
                    moveFocus(document.getElementById(dayId(d.date)), 'script');
                  }}
                >
                  ×
                </button>
              </li>
            )
          );
        })}
      </ul>
      <p className="help">{DATES.twoMax}</p>
      {p.children}
    </fieldset>
  );
}

function Month({
  month,
  hide,
  order,
  stop,
  weekendsOnly,
  onKey,
  onToggle,
}: {
  month: CalMonth;
  hide: boolean;
  order: string[];
  stop: string | null;
  weekendsOnly: boolean;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, d: CalDay) => void;
  onToggle: (d: CalDay, el: HTMLButtonElement) => void;
}) {
  const h = `cal-${month.key}`;
  return (
    <div className={hide ? 'cal-month m-hide' : 'cal-month'} data-name={month.name}>
      <h2 className="vh" id={h}>
        {month.name}
      </h2>
      <p className="cap" aria-hidden="true" style={{ marginTop: 'var(--s2)' }}>
        {month.name}
      </p>
      {weekendsOnly && <p className="ui muted">{DATES.weekendsOnly}</p>}
      <table className="cal" aria-labelledby={h}>
        <thead>
          <tr>
            {WEEKDAY_HEADS.map((n) => (
              <th key={n} scope="col">
                <abbr title={n}>{n[0]}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {month.rows.map((row, i) => (
            <tr key={i}>
              {row.map((d, j) => (
                <td key={d?.date ?? `pad-${j}`}>
                  {d && (
                    <Day
                      day={d}
                      pressed={order.includes(d.date)}
                      stop={d.date === stop}
                      weekendsOnly={weekendsOnly}
                      onKey={onKey}
                      onToggle={onToggle}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const WEEKDAY_HEADS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function Day({
  day: d,
  pressed,
  stop,
  weekendsOnly,
  onKey,
  onToggle,
}: {
  day: CalDay;
  pressed: boolean;
  stop: boolean;
  weekendsOnly: boolean;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, d: CalDay) => void;
  onToggle: (d: CalDay, el: HTMLButtonElement) => void;
}) {
  const suffix = d.off === 'rule' && weekendsOnly ? DATES.weekendsOnlySuffix : '';
  return (
    <button
      type="button"
      className="day"
      id={dayId(d.date)}
      aria-label={`${DATES.dayName(d.day, d.long)}${suffix}`}
      aria-pressed={d.off ? undefined : pressed}
      aria-disabled={d.off ? true : undefined}
      tabIndex={stop ? 0 : -1}
      onClick={(e) => {
        if (!d.off) onToggle(d, e.currentTarget);
      }}
      onKeyDown={(e) => onKey(e, d)}
    >
      {d.day}
      {!d.off && <Tick />}
    </button>
  );
}
