// S6 selection state (T1.5.U2/U3): picked times, or ONE stand-by week. The server takes either picks or a
// stand-by week, never both (validate.ts: standby_not_allowed), so choosing one clears the other; the screen says
// so with PICKER.standbyReplaces (wireframe 05-E).

export interface Selection {
  /** Picked slot ids, in tap order. */
  picks: readonly string[];
  standbyWeek: string | null;
}

export const EMPTY_SELECTION: Selection = { picks: [], standbyWeek: null };

export type SelectionAction =
  | { type: 'toggle'; slotId: string }
  | { type: 'standby'; weekStart: string; on: boolean }
  | { type: 'remove'; slotId: string }
  /** QA M3: a kept draft, already checked against what is offered (never both picks and a week). */
  | { type: 'restore'; picks: readonly string[]; standbyWeek: string | null };

export function selectionReducer(s: Selection, a: SelectionAction): Selection {
  switch (a.type) {
    case 'toggle':
      return s.picks.includes(a.slotId)
        ? { ...s, picks: s.picks.filter((id) => id !== a.slotId) }
        : { picks: [...s.picks, a.slotId], standbyWeek: null };
    case 'remove':
      return s.picks.includes(a.slotId) ? { ...s, picks: s.picks.filter((id) => id !== a.slotId) } : s;
    case 'restore':
      return a.picks.length
        ? { picks: [...a.picks], standbyWeek: null }
        : { picks: [], standbyWeek: a.standbyWeek };
    case 'standby':
      if (a.on) return { picks: [], standbyWeek: a.weekStart };
      return s.standbyWeek === a.weekStart ? { ...s, standbyWeek: null } : s;
  }
}

export const isPicked = (s: Selection, slotId: string) => s.picks.includes(slotId);

/** T1.5.U5: Send needs at least one time, or a stand-by week. */
export const hasTimes = (s: Selection) => s.picks.length > 0 || s.standbyWeek !== null;
