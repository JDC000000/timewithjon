// Jon decision 45 (lane U13): "No gifts" left the guest nav; the header keeps the activity menu and Send a story.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SITE_NAV } from '@/content/ui/foundation';
import { ROUTES } from '@/ui/routes';
import { SiteHeader } from '../SiteChrome';

afterEach(cleanup);

describe('SiteHeader nav (decision 45)', () => {
  it('links the activity menu and Send a story, and nothing about gifts', () => {
    render(<SiteHeader />);
    const nav = screen.getByRole('navigation', { name: 'Site' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['The Activity Menu', ROUTES.menu],
      ['Send a story', ROUTES.story],
    ]);
    expect(document.body.textContent).not.toMatch(/gift/i);
    expect(document.querySelector('a[href*="no-gifts"]')).toBeNull();
  });
  it('the nav copy and routes have no no-gifts entry; the printable tag has its path', () => {
    expect(Object.keys(SITE_NAV)).toEqual(['menu', 'story']);
    expect(Object.keys(ROUTES)).not.toContain('noGifts');
    expect(JSON.stringify(ROUTES)).not.toContain('no-gifts');
    expect(ROUTES.tag).toBe('/tag');
  });
});
