// Types for scripts/build-real-photos.mjs (the tests import it; tsconfig has allowJs off).
export type SlotSource = { file: string; pos?: string };
/** slot -> [widths, aspect w, aspect h] */
export const SLOTS: Readonly<Record<string, readonly [readonly number[], number, number]>>;
export const MAX_SLIDES: number;
export function parseSlots(slots: unknown): Record<string, SlotSource[]>;
export function outName(slot: string, n: number, w: number): string;
export function buildRealPhotos(
  manifest: { slots?: unknown },
  baseDir: string,
  outDir: string,
  log?: (line: string) => void,
): Promise<{ files: string[]; slides: Record<string, number> }>;
