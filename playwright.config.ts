// T4.3.01: the E2E suite (Playwright, Chromium AND WebKit). Run it with `pnpm test:e2e` (smoke, what CI runs)
// or `pnpm test:e2e:full` (the local T4.3.09 matrix); tests/e2e/run.sh builds the prototype first.
// No retries, ever: a flaky pass is a fail (decision 29) — find the cause, don't retry it green.
import { defineConfig, devices } from '@playwright/test';
import type { E2EOptions } from './tests/e2e/support/fixtures';
import { applyLocalWebKitLibs } from './tests/e2e/support/local-webkit';
import { profileFromEnv, projectSpecs } from './tests/e2e/support/profiles';
import { targetFromEnv } from './tests/e2e/support/screens';

const env = process.env;
applyLocalWebKitLibs(env.E2E_WK_LIBS);

const profile = profileFromEnv(env.E2E_PROFILE);
/** The test server's keep-alive (see webServer below); tests/unit/test-server-keepalive.test.ts keeps every start in step. */
const TEST_SERVER_KEEP_ALIVE_MS = 70_000;
const port = Number(env.E2E_PORT ?? 3300);
const baseURL = env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const target = targetFromEnv(env.E2E_TARGET);
const DEVICE = { chromium: devices['Desktop Chrome'], webkit: devices['Desktop Safari'] } as const;
// Lane specs that set their own text size (they import @playwright/test directly): U1's primitives + focus bench
// (tests/e2e/ui) and U6's admin FOC-04 (tests/e2e/admin-season). They run in the t100 projects only (both engines,
// every viewport of the profile); the t200/sp125 projects would only repeat them at the same size.
const SELF_SIZED_SPECS = ['ui/**', 'admin-season/**'];

export default defineConfig<E2EOptions>({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e',
  forbidOnly: !!env.CI,
  // App target: the stand-in admin Auth + the guest's resolved invite (tests/e2e/support/sessions.ts).
  globalSetup: './tests/e2e/support/global-setup.ts',
  retries: 0,
  repeatEach: profile.runs,
  fullyParallel: true,
  // CI sets E2E_WORKERS per engine leg (.github/workflows/ci.yml: WebKit 1, Chromium 2); 2 when unset.
  workers: Number(env.E2E_WORKERS ?? 2),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: projectSpecs(profile).map((spec) => ({
    name: spec.name,
    testIgnore: spec.textMode === 't100' ? undefined : SELF_SIZED_SPECS,
    use: {
      ...DEVICE[spec.engine],
      viewport: spec.viewport,
      deviceScaleFactor: 1,
      textMode: spec.textMode,
    },
  })),
  // The prototype build (tests/e2e/run.sh builds it), or the design pack for E2E_TARGET=pack (E2E_PACK_DIR =
  // designs/). E2E_BASE_URL skips this and targets a running server.
  // --keepAliveTimeout: on a server started with -H 127.0.0.1, Next hands proxy.ts a "localhost" URL, so the ?for=
  // rewrite counts as another origin and Next proxies it over HTTP back to this server, on Node's keep-alive agent
  // (5 s idle). With the server's default 5 s keep-alive the two timers race and a reused socket can be reset
  // ("Failed to proxy … read ECONNRESET", a ?for= link that never resolves). Vercel never takes this path. A server
  // keep-alive well past the agent's 5 s means the agent always drops an idle socket first.
  webServer: env.E2E_BASE_URL
    ? undefined
    : {
        command:
          target === 'pack'
            ? `node tests/e2e/support/pack-server.mjs "${env.E2E_PACK_DIR ?? ''}" ${port}`
            : `pnpm start -H 127.0.0.1 -p ${port} --keepAliveTimeout ${TEST_SERVER_KEEP_ALIVE_MS}`,
        url: target === 'pack' ? `${baseURL}/design-tokens.css` : `${baseURL}/robots.txt`,
        reuseExistingServer: false,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
