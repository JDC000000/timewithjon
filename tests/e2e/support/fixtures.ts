// The one `test` every spec imports: applies the project's text mode before load, and fails any test whose page
// logs a console error or throws (the `pageErrors` fixture is automatic; it asserts at the end of each test, so a
// late hydration error still counts). `allowPageErrors: true` opts a test out (the harness's own bad-page probe).
// (`provide` = Playwright's `use`, renamed: React's hook lint claims `use`.) Specs select elements by role /
// accessible name only.
import { test as base, expect } from '@playwright/test';
import { injectTextModeStyle, TEXT_MODE_CSS, type TextMode } from './text-size';

/**
 * Known app defects that log a console error, each with its owner lane. Everything else stays strict. A match is
 * recorded on the test as a `known-issue` annotation (visible in every report); delete the entry when the fix lands.
 */
export const KNOWN_CONSOLE_ISSUES: { owner: string; why: string; url: RegExp }[] = [];

/**
 * Browser noise, not an app defect: WebKit logs an aborted Next.js RSC prefetch (a `?_rsc=` fetch cancelled by a
 * navigation) as a console error, "<url>?_rsc=<id> due to access control checks." Ignored on WebKit only, and only
 * when the whole message is that one line for a same-server `?_rsc=` URL; any other text still fails the test.
 */
export const WEBKIT_RSC_ABORT =
  /^(?:Fetch API cannot load )?(?:https?:)?\/{0,2}(?:127\.0\.0\.1|localhost):\d+\/[^\s?]*\?_rsc=[\w-]+ due to access control checks\.$/;

export type E2EOptions = { textMode: TextMode; allowPageErrors: boolean };
type E2EFixtures = { pageErrors: string[] };

export const test = base.extend<E2EOptions & E2EFixtures>({
  textMode: ['t100', { option: true }],
  allowPageErrors: [false, { option: true }],
  page: async ({ page, textMode }, provide) => {
    const css = TEXT_MODE_CSS[textMode];
    if (css) await page.addInitScript(injectTextModeStyle, css);
    await provide(page);
  },
  pageErrors: [
    async ({ page, allowPageErrors, browserName }, provide) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        // Playwright's WebKit backend reports the aborted fetch as a page error ("/127.0.0.1:…?_rsc=… due to …").
        if (!(browserName === 'webkit' && WEBKIT_RSC_ABORT.test(error.message))) errors.push(error.message);
      });
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (browserName === 'webkit' && WEBKIT_RSC_ABORT.test(message.text())) return;
        const known = KNOWN_CONSOLE_ISSUES.find((issue) => issue.url.test(message.location().url));
        if (!known) errors.push(message.text());
        else if (!test.info().annotations.some((a) => a.description?.startsWith(known.owner)))
          test.info().annotations.push({ type: 'known-issue', description: `${known.owner}: ${known.why}` });
      });
      await provide(errors);
      if (!allowPageErrors) expect(errors, 'console errors / uncaught page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
