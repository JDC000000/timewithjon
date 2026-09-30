// src/app/admin/(app)/settings/_a7/paths.ts — T2.9.U1: the A7 routes (wireframe 09 A7 groups).
export const SETTINGS_PATH = '/admin/settings';
export const CALENDAR_PATH = `${SETTINGS_PATH}/calendar`;
export const OPENING_PATH = `${SETTINGS_PATH}/opening-times`;
export const REPLIES_PATH = `${SETTINGS_PATH}/replies`;
/** T3.3.03: starts Google's consent screen (a plain link: it redirects off-site, so never next/link). */
export { CONNECT_GOOGLE } from '@/app/admin/_season/GoogleBanner';
/** The group last opened, so Back to the list lands on its row (FOC-04). */
export const SETTINGS_RETURN_KEY = 'twj-settings';
