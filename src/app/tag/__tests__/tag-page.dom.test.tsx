// U2 PR3 S12b /tag: the printable wine tag on pack v2.2. Every string word for word from the pack (via WINE_TAG and
// TAG_UI), the back link to S11 "Sent.", four tags on one Letter sheet described for screen readers, the Print
// button, and nothing the P.S. rule forbids (NOGIFTSPS: no no-gifts nav, no link back to the tag, no photo).
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WINE_TAG } from '@/content';
import { TAG_UI } from '@/content/ui/tag';
import { ROUTES } from '@/ui/routes';
import TagPage, { metadata } from '../page';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NBSP = ' ';

describe('S12b /tag', () => {
  it('reads the pack words, verbatim', () => {
    expect(TAG_UI).toMatchObject({
      back: 'Sent',
      title: 'The tag',
      intro: 'Four to a page. Cut on the dashed lines, punch the hole, tie it on.',
      print: 'Print',
      printAlt: 'Or save it as a PDF from the print window.',
      sheetLabel: 'A Letter page with four tags, front side, and dashed cut lines',
    });
    expect(TAG_UI.words).toBe(
      'Each tag reads “For Jon”, then “Open on” and “From”, each with a line to write on, then “No date? It opens on my 51st.”',
    );
    expect(WINE_TAG).toMatchObject({ forJon: 'For Jon', openOn: 'Open on', from: 'From' });
    expect(metadata.title).toBe('Wine tag · Time with Jon');
  });

  it('has one h1, the intro, and the ‹ Sent back link to S11', () => {
    render(<TagPage />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['The tag']);
    expect(screen.getByText(TAG_UI.intro)).toHaveProperty('tagName', 'P');
    const back = screen.getByRole('link', { name: 'Sent' }); // the ‹ is aria-hidden
    expect(back.textContent).toBe('‹ Sent');
    expect(back.getAttribute('href')).toBe(ROUTES.sent);
    expect(ROUTES.sent).toBe('/sent');
    expect(back.className).toBe('back');
  });

  it('shows one Letter sheet of four tags, as one image described by the words line', () => {
    const { container } = render(<TagPage />);
    const sheet = screen.getByRole('img', { name: TAG_UI.sheetLabel });
    const words = document.getElementById(sheet.getAttribute('aria-describedby') ?? '');
    expect(words?.textContent).toBe(TAG_UI.words.replace('my 51st', `my${NBSP}51st`));
    expect(words?.className).toBe('ui muted no-print');
    expect(sheet.className).toBe('sheet-fit');
    const tags = container.querySelectorAll('.sheet-letter > .cell > .tag');
    expect(tags).toHaveLength(4);
    for (const t of tags) {
      expect([...t.children].map((p) => [p.className, p.textContent])).toEqual([
        ['cap', 'For Jon'],
        ['ln', 'Open on'],
        ['ln', 'From'],
        ['fine', `No date? It opens on my${NBSP}51st.`],
      ]);
    }
  });

  it('prints from the Print button; the intro and the words stay off the printed page', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { container } = render(<TagPage />);
    const btn = screen.getByRole('button', { name: 'Print' });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.nextElementSibling?.textContent).toBe(TAG_UI.printAlt);
    await userEvent.click(btn);
    expect(print).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.flow-top.no-print')?.contains(btn)).toBe(true);
  });

  it('links nowhere but the back link, the wordmark and the footer; no gifts nav, no photo', () => {
    const { container } = render(<TagPage />);
    const hrefs = within(container)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain(ROUTES.tag);
    expect(container.querySelector('a[href*="no-gifts"]')).toBeNull();
    expect(container.textContent).not.toMatch(/no gifts/i);
    expect(container.querySelector('img, figure, .ph')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Site' })).toBeNull();
  });
  it('keeps the pack markup: its classes, its inline spacing and the site footer', () => {
    render(<TagPage />);
    expect(screen.getByRole('heading', { level: 1 }).className).toBe('h1');
    expect(screen.getByText(TAG_UI.intro).className).toBe('lead intro');
    expect(screen.getByRole('button', { name: TAG_UI.print }).parentElement?.className).toBe('send');
    expect(screen.getByRole('img', { name: TAG_UI.sheetLabel }).style.marginTop).toBe('var(--s7)');
    expect(document.getElementById('tag-words')?.style.marginTop).toBe('var(--s3)');
    expect(
      within(screen.getByRole('contentinfo')).getByText('Questions? Text me. You’ve got the number.'),
    ).toBeTruthy();
    expect(within(screen.getByRole('contentinfo')).queryByText(/North Shore/)).toBeNull(); // Jon, 2026-10-05
  });
});
