// tests/unit/ui/pages.dom.test.tsx (U1): the 404 page (T1.2.U4), the staging banner (T3.16.U1) and the tick (T1.1b.U4).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import NotFound, { metadata } from '@/app/not-found';
import { NOT_FOUND } from '@/content';
import { StagingBanner, Tick } from '@/ui';

afterEach(cleanup);

describe('404 (S15)', () => {
  it('one h1 line, a link back to the menu, header + main#main, no footer (Jon, 2026-10-05), the page title', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(NOT_FOUND.line);
    expect(screen.getByRole('link', { name: NOT_FOUND.back }).getAttribute('href')).toBe('/menu');
    expect(screen.getByRole('main').id).toBe('main');
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.queryByRole('contentinfo')).toBeNull();
    expect(metadata.title).toBe('Page not found · Time with Jon');
  });
});

describe('StagingBanner', () => {
  it('shows on staging only, as a note', () => {
    const { rerender } = render(<StagingBanner mode="staging" />);
    expect(screen.getByRole('note').textContent).toBe('Staging. Test data only.');
    for (const mode of ['prototype', 'production']) {
      rerender(<StagingBanner mode={mode} />);
      expect(screen.queryByRole('note')).toBeNull();
    }
  });
});

describe('Tick', () => {
  it('is the pack glyph, hidden from assistive tech', () => {
    const { container } = render(<Tick />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toBe('ck');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M1.5 6.5l3 3 6-7.5');
  });
});
