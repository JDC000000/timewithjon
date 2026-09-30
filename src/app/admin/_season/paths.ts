// src/app/admin/_season/paths.ts — T2.5.U1: the A4 routes and the one session key the panes share.
export const SEASON_PATH = '/admin/season';
export const weekPath = (weekStart: string) => `${SEASON_PATH}/week/${weekStart}`;
export const AWAY_PATH = `${SEASON_PATH}/away`;
/** The week last opened, so Back to the list lands on its row (FOC-04). */
export const LAST_WEEK_KEY = 'twj-season-week';
