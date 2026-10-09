// The photo pipeline answers inside its functions' maxDuration, whatever the file (slot wait + HEIC + encode).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DECODE_WAIT_MS,
  ENCODE_TIMEOUT_SECONDS,
  HEIC_BUDGET_MS,
  HEIC_SHARP_TRY_SECONDS,
  WORST_CONVERSION_MS,
} from '@/features/photos/limits';
import { MEDIA_BUDGET_MS, MEDIA_HEAVY_RESERVE_MS } from '@/features/jobs/media-limits';

const maxDuration = (route: string) =>
  Number(/export const maxDuration = (\d+)/.exec(readFileSync(route, 'utf8'))![1]) * 1000;
const FINALISE = maxDuration('src/app/api/photos/finalise/route.ts');
const MEDIA = maxDuration('src/app/api/jobs/media/route.ts');
const ENCODE_TIMEOUT_MS = ENCODE_TIMEOUT_SECONDS * 1000; // sharp's own timeout (any format)
const SLACK_MS = 5_000; // the download, the upload of the result and the database work around it

describe('photo time budgets', () => {
  it('the slowest conversion covers both paths: slot wait + a sharp encode, or slot wait + sharp try + HEIC budget', () => {
    expect(WORST_CONVERSION_MS).toBeGreaterThanOrEqual(DECODE_WAIT_MS + ENCODE_TIMEOUT_MS);
    expect(WORST_CONVERSION_MS).toBeGreaterThanOrEqual(
      DECODE_WAIT_MS + HEIC_SHARP_TRY_SECONDS * 1000 + HEIC_BUDGET_MS,
    );
  });

  it('a guest finalise answers inside its maxDuration, HEIC or not', () => {
    expect(WORST_CONVERSION_MS + SLACK_MS).toBeLessThanOrEqual(FINALISE);
    expect(DECODE_WAIT_MS + ENCODE_TIMEOUT_MS + SLACK_MS).toBeLessThanOrEqual(FINALISE);
  });

  it('the media job claims a conversion only while one still fits its budget, and the budget fits its maxDuration', () => {
    expect(MEDIA_HEAVY_RESERVE_MS).toBeGreaterThanOrEqual(WORST_CONVERSION_MS);
    expect(MEDIA_BUDGET_MS + SLACK_MS).toBeLessThanOrEqual(MEDIA);
  });
});
