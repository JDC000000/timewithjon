// Text size is set BEFORE the page loads (T4.3.09 run rules), with the same CSS the design review used
// (the design review's cases-r12 MODES), so a build result compares 1:1 with a design-review result.
// t100 = browser default · t200 = 200% text (WCAG 1.4.4) · sp125 = WCAG 1.4.12 text spacing at 125% text.
export type TextMode = 't100' | 't200' | 'sp125';

export const TEXT_MODE_CSS: Record<TextMode, string> = {
  t100: '',
  t200: 'html{font-size:200%!important}',
  sp125:
    '*,*::before,*::after{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}' +
    'p{margin-bottom:2em!important}html{font-size:125%!important}',
};

/**
 * Runs in the page (via addInitScript) before any page script: appends the style as soon as <html> exists.
 * Self-contained on purpose: Playwright serialises it into the page.
 */
export function injectTextModeStyle(css: string): void {
  const style = document.createElement('style');
  style.setAttribute('data-e2e-text-mode', '');
  style.textContent = css;
  const add = () => (document.head || document.documentElement).appendChild(style);
  if (document.documentElement) {
    add();
    return;
  }
  new MutationObserver((_, observer) => {
    if (document.documentElement) {
      observer.disconnect();
      add();
    }
  }).observe(document, { childList: true });
}
