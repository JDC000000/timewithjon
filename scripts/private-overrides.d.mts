// Types for scripts/private-overrides.mjs (the tests import it; tsconfig has allowJs off).
export type TextOverride = { file: string; find: string; replace: string };
export const TEXT_FILES: readonly string[];
export const DEFAULT_TEXT_FILE: string;
export const PHOTO_SLOTS_FILE: string;
export const POS_PATTERN: RegExp;
export const PLAIN_TEXT: RegExp;
export function singleQuotedSpans(line: string): [start: number, end: number][] | null;
export function parseTextOverrides(text: unknown): TextOverride[];
export function applyTextOverrides(
  sources: Readonly<Record<string, string>>,
  overrides: readonly TextOverride[],
): Record<string, string>;
export function parsePosOverrides(pos: unknown): [slot: string, value: string][];
export function applyPosOverrides(source: string, overrides: readonly (readonly [string, string])[]): string;
export function applySlidesOverrides(source: string, counts: readonly (readonly [string, number])[]): string;
export const PHOTO_VIEWS_FILE: string;
