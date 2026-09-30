'use client';
// S6 picker (T1.5.U2-U4, pack s06 + gen.py picker()/wk()/tile()): month tabs (automatic activation, roving
// tabindex), a week list per month, time tiles as button[aria-pressed], spoken-for weeks with stand-by, away weeks
// and the collapsed spoken-for run. State lives in the flow (BookingFlow); this renders it.
import Link from 'next/link';
import { useRef, type KeyboardEvent } from 'react';
import { KeepWhole } from '@/ui';
import { moveFocus } from '@/ui/focus';
import { DISHES, FLOW, SECTIONS } from '@/content';
import { bookHref } from '@/content/menu-helpers';
import { PICKER } from '@/content/ui/booking';
import {
  monthStandbyWeeks,
  monthTileIds,
  type PickerMonth,
  type PickerRow,
  type TileView,
} from './_lib/picker-model';
import { PICKER_ID } from './_lib/form-errors';
import { isPicked, type Selection } from './_lib/selection';
import { useTabStack, useTileStack } from './_lib/useFit';

export const tabId = (monthKey: string) => `t-${monthKey}`;
const panelId = (monthKey: string) => `p-${monthKey}`;

const LONG_DISTANCE = DISHES.find((d) => d.slug === 'the-long-distance');
const BIG_DAYS = SECTIONS.find((s) => s.id === 'big-days');

export interface TimePickerProps {
  months: PickerMonth[];
  shownMonth: string;
  onShowMonth: (key: string) => void;
  selection: Selection;
  onTile: (tile: TileView, el: HTMLButtonElement) => void;
  onStandby: (weekStart: string, on: boolean) => void;
  /** ERRORS.noTimes under the tabs while Send has no pick (T1.5.U5). */
  picksError: string | null;
  /** Tile elements by slot id, for focus return after a Remove in the picks list. */
  tileRefs: Map<string, HTMLButtonElement>;
}

export function TimePicker(p: TimePickerProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useTabStack(
    listRef,
    p.months.map((m) => monthTileIds(m).length),
  );

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = p.months.length - 1;
    const to =
      e.key === 'ArrowRight'
        ? i === last
          ? 0
          : i + 1
        : e.key === 'ArrowLeft'
          ? i === 0
            ? last
            : i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    const key = p.months[to]?.key;
    if (key === undefined) return;
    e.preventDefault();
    p.onShowMonth(key);
    moveFocus(document.getElementById(tabId(key)), 'keyboard');
  }

  return (
    <fieldset
      className="picker"
      id={PICKER_ID}
      tabIndex={-1}
      aria-describedby={p.picksError ? 'picks-err' : undefined}
    >
      <legend className="vh">{PICKER.legend}</legend>
      <div className="tabs" role="tablist" aria-label={PICKER.monthTabsLabel} ref={listRef}>
        {p.months.map((m, i) => {
          const on = m.key === p.shownMonth;
          const n = monthTileIds(m).filter((id) => isPicked(p.selection, id)).length;
          const standby =
            p.selection.standbyWeek !== null && monthStandbyWeeks(m).includes(p.selection.standbyWeek);
          const suffix = n ? PICKER.monthPicked(n) : standby ? PICKER.monthStandby : null;
          return (
            <button
              key={m.key}
              type="button"
              role="tab"
              id={tabId(m.key)}
              aria-controls={panelId(m.key)}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              data-shown={suffix ? n || 1 : 0}
              onClick={() => p.onShowMonth(m.key)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {m.name}
              {suffix && (
                <span className="tc">
                  <span className="tsep vh"> · </span>
                  <span className="tcn">{suffix}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="err" id="picks-err" hidden={!p.picksError}>
        {p.picksError}
      </p>
      {p.months.map((m) => (
        <MonthPanel key={m.key} month={m} shown={m.key === p.shownMonth} {...p} />
      ))}
    </fieldset>
  );
}

function MonthPanel({ month, shown, ...p }: { month: PickerMonth; shown: boolean } & TimePickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useTileStack(ref, shown);
  return (
    <div role="tabpanel" id={panelId(month.key)} aria-labelledby={tabId(month.key)} hidden={!shown} ref={ref}>
      {month.rows.map((r) => (
        <WeekRow key={r.key} row={r} {...p} />
      ))}
    </div>
  );
}

function WeekRow({ row, ...p }: { row: PickerRow } & TimePickerProps) {
  switch (row.kind) {
    case 'week':
      return (
        <div className="week" role="group" aria-label={row.caption}>
          <p className="week-cap" aria-hidden="true">
            <KeepWhole text={row.caption} />
          </p>
          <div className="tiles">
            {row.tiles.map((t) => (
              <Tile key={t.slotId} tile={t} {...p} />
            ))}
          </div>
        </div>
      );
    case 'away':
      return (
        <div className="week">
          <p className="week-cap">
            <KeepWhole text={row.caption} />
          </p>
          <div className="full">
            <p>{PICKER.awayWeek}</p>
          </div>
        </div>
      );
    case 'spoken':
      return (
        <div className="week">
          <p className="week-cap">
            <KeepWhole text={row.caption} />
          </p>
          <div className="full">
            <p>{FLOW.weekFull}</p>
            <Standby weekStart={row.weekStart} label={FLOW.standby} vh={`, ${row.caption}`} {...p} />
          </div>
        </div>
      );
    case 'run':
      return (
        <div className="week">
          <p className="week-cap">
            <KeepWhole text={PICKER.runCaption(row.firstCaption, row.lastCaption)} />
          </p>
          <div className="full">
            <p>{FLOW.spokenForRun}</p>
            <p className="alts">
              {BIG_DAYS && (
                <Link className="tap" href={`/#${BIG_DAYS.id}`}>
                  {BIG_DAYS.title}
                </Link>
              )}
              {LONG_DISTANCE && (
                <Link className="tap" href={bookHref(LONG_DISTANCE)}>
                  {LONG_DISTANCE.name}
                </Link>
              )}
            </p>
            <Standby weekStart={row.weekStart} label={PICKER.standbyFor(row.firstCaption)} {...p} />
          </div>
        </div>
      );
  }
}

function Tile({ tile, ...p }: { tile: TileView } & TimePickerProps) {
  const pressed = isPicked(p.selection, tile.slotId);
  return (
    <button
      type="button"
      className="tile"
      aria-pressed={pressed}
      ref={(el) => {
        if (el) p.tileRefs.set(tile.slotId, el);
        else p.tileRefs.delete(tile.slotId);
      }}
      onClick={(e) => p.onTile(tile, e.currentTarget)}
    >
      <span className="tw">
        {tile.day}
        <span className="d" aria-hidden="true">
          {' ·'}
        </span>{' '}
      </span>
      <span className="tt">
        <span aria-hidden="true">{tile.time}</span>
        <span className="vh">
          <KeepWhole text={tile.spoken} />
        </span>
      </span>
      <Tick />
    </button>
  );
}

function Standby({
  weekStart,
  label,
  vh,
  selection,
  onStandby,
}: { weekStart: string; label: string; vh?: string } & TimePickerProps) {
  const checked = selection.standbyWeek === weekStart;
  return (
    <>
      <label className="check standby">
        <input
          type="checkbox"
          name="standby"
          value={weekStart}
          checked={checked}
          onChange={(e) => onStandby(weekStart, e.currentTarget.checked)}
        />
        <span>
          {vh ? (
            // VD6-09, the tile way: the out-of-flow .vh after visible text gets a space before its comma in
            // Chrome ("stand-by , Apr 15–16"; the pack has that bug), so the visible words are aria-hidden and
            // the .vh speaks the whole name.
            <>
              <span aria-hidden="true">{label}</span>
              <span className="vh">
                <KeepWhole text={`${label}${vh}`} />
              </span>
            </>
          ) : (
            <KeepWhole text={label} />
          )}
          <span className="hint">{PICKER.standbyHint}</span>
        </span>
      </label>
      {checked && <p className="hint">{PICKER.standbyReplaces}</p>}
    </>
  );
}

/** The pick tick (pack CK): decorative, the state is aria-pressed. */
export function Tick() {
  return (
    <svg className="ck" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M1.5 6.5l3 3 6-7.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
