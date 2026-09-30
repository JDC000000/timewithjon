// Each T4.3.09 case runs on the part of the full matrix its carry-over text names (t4.3-carryover-focus-cases.md);
// the other projects skip it, so the 5-run matrix stays affordable. Smoke runs every case at 375 + 1440 / 100 %
// that its scope includes.
import { VIEWPORTS, type Viewport } from './profiles';
import type { TextMode } from './text-size';

export type ViewportName = keyof typeof VIEWPORTS;
export type Scope = { viewports?: readonly ViewportName[]; textModes?: readonly TextMode[] };

export const PHONES: readonly ViewportName[] = ['w320', 'w375', 'short375', 'short320'];
export const TALL_PHONES: readonly ViewportName[] = ['w320', 'w375'];
export const WIDTHS: readonly ViewportName[] = ['w320', 'w375', 'w768', 'w1440'];
export const SHORT_PHONES: readonly ViewportName[] = ['short375', 'short320'];

/** Does this project (viewport × text mode) belong to the case's scope? An empty scope field = every value. */
export function inScope(viewport: Viewport | null, textMode: TextMode, scope: Scope): boolean {
  const byViewport =
    !scope.viewports ||
    scope.viewports.some((name) => {
      const v = VIEWPORTS[name];
      return v.width === viewport?.width && v.height === viewport?.height;
    });
  const byText = !scope.textModes || scope.textModes.includes(textMode);
  return byViewport && byText;
}
