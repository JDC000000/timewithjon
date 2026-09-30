// T3.12.U1 GAP: a story-page photo picked before the first save creates the story on sign and issues twj_story;
// finalise never creates one, and a twj_story naming another invite's story is never replaced.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  cookieStore: { set: vi.fn() },
  readStoryPageCapability: vi.fn(),
  setStoryCapability: vi.fn(),
  requireInvite: vi.fn(),
  ownStoryPageStory: vi.fn(),
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
  ownStoryPageStory: m.ownStoryPageStory,
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
const req = () => new NextRequest('https://twj.test/api/photos/sign?for=story_page', { method: 'POST' });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireInvite.mockResolvedValue({ invite: INVITE });
});

describe('story_page photo capability', () => {
  it('sign on a first visit (no twj_story) creates the story and issues twj_story for it', async () => {
    m.readStoryPageCapability.mockResolvedValue(null);
    m.saveStoryPageStory.mockResolvedValue('story-new');
    expect(await callerStoryForSign(req())).toEqual({ storyId: 'story-new' });
    expect(m.saveStoryPageStory).toHaveBeenCalledWith(null, INVITE, { consent: false });
    expect(m.setStoryCapability).toHaveBeenCalledWith({ cookies: m.cookieStore }, 'story-new');
  });

  it('sign with twj_story uses that story and creates nothing', async () => {
    m.readStoryPageCapability.mockResolvedValue('story-1');
    m.ownStoryPageStory.mockResolvedValue('story-1');
    expect(await callerStoryForSign(req())).toEqual({ storyId: 'story-1' });
    expect(m.ownStoryPageStory).toHaveBeenCalledWith('story-1', 'inv-1');
    expect(m.saveStoryPageStory).not.toHaveBeenCalled();
    expect(m.setStoryCapability).not.toHaveBeenCalled();
  });

  it("sign with another invite's twj_story answers null (403), never a new story", async () => {
    m.readStoryPageCapability.mockResolvedValue('story-other');
    m.ownStoryPageStory.mockResolvedValue(null);
    expect(await callerStoryForSign(req())).toEqual({ storyId: null });
    expect(m.saveStoryPageStory).not.toHaveBeenCalled();
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
