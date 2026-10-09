// r5 N-L8: a Stories row's link name read "Name , OK for the book" (a visually hidden ", " adds a space before it).
// The name is now the row's own words joined plainly; the visible row is unchanged.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryItem } from '@/features/admin/stories';
import { storyMeta, storyWho } from '../model';
import { StoriesList } from '../StoriesList';

vi.mock('../AddStory', () => ({ AddStory: () => null }));
vi.mock('../ExportStories', () => ({ ExportStories: () => null }));

const story: StoryItem = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'story_page',
  fromName: 'Kim',
  fromEmail: null,
  body: 'The lake at dawn',
  consent: true,
  consentSource: 'tickbox',
  consentNeedsJon: false,
  spamSuspect: false,
  before60Answer: null,
  photoCount: 0,
  createdAt: '2027-05-01T20:00:00.000Z',
  request: null,
};

afterEach(cleanup);

describe('Stories row names (r5 N-L8)', () => {
  it('who and meta, joined with ", ", no stray space before a comma', () => {
    render(<StoriesList stories={[story]} />);
    const name = [storyWho(story), ...storyMeta(story)].join(', ');
    const link = screen.getByRole('link', { name });
    expect(link.getAttribute('aria-label')).not.toMatch(/ ,/);
    expect(link.querySelector('.vh')).toBeNull();
    expect(link.textContent).toContain(storyWho(story));
  });
});
