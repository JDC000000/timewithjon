// Types for scripts/build-real-photos.mjs (the tests import it; tsconfig has allowJs off).
export type ViewValue = string | { pos: string; frame?: number; zoom?: number };
export type SourceView = Record<string, ViewValue>;
export type SlotSource = { file: string; pos?: string; aspect?: 'source'; view?: SourceView };
/** slot -> [widths, aspect w, aspect h] */
export const SLOTS: Readonly<Record<string, readonly [readonly number[], number, number]>>;
export const MAX_SLIDES: number;
export const VIEW_KEYS: readonly string[];
export const FRAME_MIN: number;
export const FRAME_MAX: number;
export const ZOOM_MIN: number;
export const ZOOM_MAX: number;
export function parseView(where: string, view: unknown): SourceView;
export function viewsFor(slots: Record<string, SlotSource[]>): Record<string, SourceView[]>;
export function parseSlots(slots: unknown): Record<string, SlotSource[]>;
export function outName(slot: string, n: number, w: number): string;
export function buildRealPhotos(
  manifest: { slots?: unknown },
  baseDir: string,
  outDir: string,
  log?: (line: string) => void,
): Promise<{ files: string[]; slides: Record<string, number>; views: Record<string, SourceView[]> }>;
