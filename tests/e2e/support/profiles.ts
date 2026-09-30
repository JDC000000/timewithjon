// The E2E run matrix (T4.3.01 / T4.3.09 run rules). One Playwright project per engine × viewport × text mode.
// smoke = the CI job (both engines, 375 + 1440, 100% text, 1 run); full = the local T4.3.09 matrix
// (4 widths + 2 short phones × 3 text modes × both engines × 5 runs; a flaky pass is a fail, so retries stay 0).
import type { TextMode } from './text-size';

export type Engine = 'chromium' | 'webkit';
export type Viewport = { width: number; height: number };
export type ProfileName = 'smoke' | 'full';

export type Profile = {
  name: ProfileName;
  engines: readonly Engine[];
  viewports: readonly Viewport[];
  textModes: readonly TextMode[];
  runs: number;
};

const ENGINES: readonly Engine[] = ['chromium', 'webkit'];

export const VIEWPORTS = {
  w320: { width: 320, height: 740 },
  w375: { width: 375, height: 812 },
  w768: { width: 768, height: 1024 },
  w1440: { width: 1440, height: 900 },
  short375: { width: 375, height: 667 },
  short320: { width: 320, height: 568 },
} as const satisfies Record<string, Viewport>;

export const PROFILES: Record<ProfileName, Profile> = {
  smoke: {
    name: 'smoke',
    engines: ENGINES,
    viewports: [VIEWPORTS.w375, VIEWPORTS.w1440],
    textModes: ['t100'],
    runs: 1,
  },
  full: {
    name: 'full',
    engines: ENGINES,
    viewports: Object.values(VIEWPORTS),
    textModes: ['t100', 't200', 'sp125'],
    runs: 5,
  },
};

export function profileFromEnv(value: string | undefined): Profile {
  if (value === undefined || value === '') return PROFILES.smoke;
  if (value === 'smoke' || value === 'full') return PROFILES[value];
  throw new Error(`E2E_PROFILE must be "smoke" or "full", got "${value}"`);
}

export type ProjectSpec = {
  name: string;
  engine: Engine;
  viewport: Viewport;
  textMode: TextMode;
};

/** Every engine × viewport × text-mode combination of a profile, named e.g. `webkit-375x667-t200`. */
export function projectSpecs(profile: Profile): ProjectSpec[] {
  return profile.engines.flatMap((engine) =>
    profile.viewports.flatMap((viewport) =>
      profile.textModes.map((textMode) => ({
        name: `${engine}-${viewport.width}x${viewport.height}-${textMode}`,
        engine,
        viewport,
        textMode,
      })),
    ),
  );
}
