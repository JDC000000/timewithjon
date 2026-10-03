// S19: the story POST. Only the first save (which creates the story) carries the general invite's Turnstile token;
// `open` saves the story before a first photo, and does nothing once a save has landed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storySaver } from '../story-submit';

const signal = new AbortController().signal;
function fetchAnswering(...statuses: number[]) {
  const fetchMock = vi.fn(async () => new Response('{}', { status: statuses.shift() ?? 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const sentBody = (f: ReturnType<typeof fetchAnswering>, n: number) =>
  JSON.parse((f.mock.calls[n] as unknown as [string, RequestInit])[1].body as string) as Record<
    string,
    unknown
  >;

afterEach(() => vi.unstubAllGlobals());

describe('storySaver', () => {
  it('first save carries the token; later saves and opens do not', async () => {
    const f = fetchAnswering(200, 200);
    const takeToken = vi.fn(async () => 'tok');
    const s = storySaver({ endpoint: '/api/story-page', opened: false, takeToken, reset: vi.fn() });
    expect((await s.save({ consent: true, body: 'hi' }, signal)).ok).toBe(true);
    expect(sentBody(f, 0)).toEqual({ consent: true, body: 'hi', turnstileToken: 'tok' });
    expect((await s.open(signal)).ok).toBe(true);
    await s.save({ consent: false }, signal);
    expect(f).toHaveBeenCalledTimes(2);
    expect(sentBody(f, 1)).toEqual({ consent: false });
    expect(takeToken).toHaveBeenCalledTimes(1);
  });

  it('open before Send saves the story as it stands; a refused open resets the widget and stays closed', async () => {
    const f = fetchAnswering(400, 200);
    const reset = vi.fn();
    const s = storySaver({ endpoint: '/api/story-page', opened: false, takeToken: async () => 'tok', reset });
    expect((await s.open(signal)).status).toBe(400);
    expect(reset).toHaveBeenCalledTimes(1);
    expect((await s.open(signal)).ok).toBe(true);
    expect(sentBody(f, 1)).toEqual({ consent: false, turnstileToken: 'tok' });
  });

  it('an already-open form (S11, S17) never asks for a token', async () => {
    const f = fetchAnswering(200);
    const takeToken = vi.fn(async () => 'tok');
    const s = storySaver({ endpoint: '/api/stories', opened: true, takeToken, reset: vi.fn() });
    await s.save({ consent: true }, signal);
    expect(takeToken).not.toHaveBeenCalled();
    expect(sentBody(f, 0)).toEqual({ consent: true });
  });
});
