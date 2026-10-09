// The public /privacy page: Jon's words exactly (2026-10-09), one h1, the site's header and footer, no photo, and it
// reads no invite session (so it opens for anyone, signed out, no invite).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PRIVACY } from '@/content/ui/privacy';
import PrivacyPage, { metadata } from '../page';

afterEach(cleanup);

describe('/privacy', () => {
  it('Jon’s words, verbatim, with the typographic apostrophe and the full stop', () => {
    expect(PRIVACY.body).toBe(
      'I only use your name, email and photos to plan our time together. I don’t share them. Ask me if you have any questions.',
    );
    expect(PRIVACY.body).not.toContain("'");
    expect(PRIVACY).toMatchObject({ heading: 'Privacy', pageTitle: 'Privacy · Time with Jon' });
    expect(metadata.title).toBe('Privacy · Time with Jon');
  });

  it('one h1, the words, the footer; no photo', () => {
    const { container } = render(<PrivacyPage />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Privacy']);
    expect(screen.getByText(PRIVACY.body).tagName).toBe('P');
    expect(container.querySelector('footer.site-f')).not.toBeNull();
    expect(container.querySelector('img, figure')).toBeNull();
  });

  it('reads no invite session or cookie (anyone can open it)', () => {
    const src = readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');
    expect(src).not.toMatch(/getInviteSession|requireInvite|cookies\(|twj_/);
  });
});
