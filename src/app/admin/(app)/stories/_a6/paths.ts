// src/app/admin/(app)/stories/_a6/paths.ts — T2.9.U1: the A6 routes.
export const STORIES_PATH = '/admin/stories';
export const storyPath = (id: string) => `${STORIES_PATH}/${id}`;
/** The detail's landing after "Add emailed story" (FOC-04): `?added=<photos that failed>`. */
export const ADDED_PARAM = 'added';
/** The story last opened, so Back to the list lands on its row (FOC-04). */
export const STORY_RETURN_KEY = 'twj-story';
/** The detail's landing after "Not spam": focus goes to its "OK for the book" box (FOC-04). */
export const CLEARED_PARAM = 'cleared';
