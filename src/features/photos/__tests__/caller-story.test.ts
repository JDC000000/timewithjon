// T3.12.U1: the story-page photo calls never create a story (the page's first save does); a twj_story naming
// another invite's story is never replaced.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  cookieStore: { set: vi.fn() },
  readStoryPageCapability: vi.fn(),
  setStoryCapability: vi.fn(),
  requireInvite: vi.fn(),
  pageStory: vi.fn(),
  saveStoryPageStory: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => m.cookieStore }));
vi.mock('@/features/invites/capability', () => ({
  readStoryCapability: vi.fn(),
  readStoryPageCapability: m.readStoryPageCapability,
  setStoryCapability: m.setStoryCapability,
}));
vi.mock('@/features/invites/require', () => ({ requireInvite: m.requireInvite }));
vi.mock('../story-page', () => ({
  pageStory: m.pageStory,
  saveStoryPageStory: m.saveStoryPageStory,
}));
vi.mock('../story', () => ({ afterSendStoryId: vi.fn(), ensureAfterSendStory: vi.fn() }));

const { callerStoryForFinalise, callerStoryForSign } = await import('../caller-story');

const INVITE = {
  id: 'inv-1',
  kind: 'personal',
  display_name: 'Ann',
  prefill_name: null,
  prefill_email: null,
};
const KEY = '11111111-2222-4333-8444-555555555555';
const req = (key: string | null = KEY) =>
  new NextRequest(`https://twj.test/api/photos/sign?for=story_page${key ? `&key=${key}` : ''}`, {
    method: 'POST',
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireInvite.mockResolvedValue({ invite: INVITE });
});

describe('story_page photo capability', () => {
  it('sign on a first visit (no twj_story) is capability_expired and creates no story', async () => {
    m.readStoryPageCapability.mockResolvedValue(null);
    const out = await callerStoryForSign(req());
    expect('response' in out && out.response.status).toBe(403);
    expect(m.saveStoryPageStory).not.toHaveBeenCalled();
    expect(m.setStoryCapability).not.toHaveBeenCalled();
    expect(m.cookieStore.set).not.toHaveBeenCalled();
  });

  it("sign with twj_story uses the story this page view's key made, and creates nothing", async () => {
    m.readStoryPageCapability.mockResolvedValue('story-1');
    m.pageStory.mockResolvedValue('story-1');
    expect(await callerStoryForSign(req())).toEqual({ storyId: 'story-1' });
    expect(m.pageStory).toHaveBeenCalledWith('story-1', KEY, 'inv-1');
    expect(m.saveStoryPageStory).not.toHaveBeenCalled();
    expect(m.setStoryCapability).not.toHaveBeenCalled();
  });

  it("sign with another invite's twj_story answers null (403), never a new story", async () => {
    m.readStoryPageCapability.mockResolvedValue('story-other');
    m.pageStory.mockResolvedValue(null);
    expect(await callerStoryForSign(req())).toEqual({ storyId: null });
    expect(m.saveStoryPageStory).not.toHaveBeenCalled();
  });

  it('sign without the page key (or with a malformed one) names no story: the stale answer', async () => {
    m.readStoryPageCapability.mockResolvedValue('story-1');
    m.pageStory.mockResolvedValue(null);
    expect(await callerStoryForSign(req(null))).toEqual({ storyId: null });
    expect(m.pageStory).toHaveBeenLastCalledWith('story-1', null, 'inv-1');
    expect(await callerStoryForFinalise(req('not-a-uuid'))).toEqual({ storyId: null });
    expect(m.pageStory).toHaveBeenLastCalledWith('story-1', null, 'inv-1');
  });

  it('sign without a valid invite creates nothing', async () => {
    const response = new Response(null, { status: 403 });
    m.requireInvite.mockResolvedValue({ response });
    expect(await callerStoryForSign(req())).toEqual({ response });
    expect(m.saveStoryPageStory).not.toHaveBeenCalled();
  });

  it('finalise without twj_story is capability_expired and never creates a story', async () => {
    m.readStoryPageCapability.mockResolvedValue(null);
    const out = await callerStoryForFinalise(req());
    expect('response' in out && out.response.status).toBe(403);
    expect(m.saveStoryPageStory).not.toHaveBeenCalled();
    expect(m.setStoryCapability).not.toHaveBeenCalled();
  });
});
