// POST /api/events: a chunked body (no Content-Length) over the limit is refused without being read whole (B010).
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import '../../../../../tests/fixtures/unit-env';

vi.mock('@/lib/ratelimit', () => ({ limitByIp: vi.fn(async () => null) }));
const countEvent = vi.hoisted(() => vi.fn());
vi.mock('@/features/analytics/count', () => ({ BEACON_EVENTS: ['dish_sheet_opened'], countEvent }));
const { POST } = await import('../route');

const SITE = 'http://localhost:3000';
const chunked = (chunks: number, size: number) => {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled === chunks) return c.close();
      pulled++;
      c.enqueue(new Uint8Array(size).fill(0x61));
    },
  });
  const req = new NextRequest(`${SITE}/api/events`, {
    method: 'POST',
    headers: { origin: SITE, 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as unknown as ConstructorParameters<typeof NextRequest>[1]); // a stream body needs duplex
  return { req, pulled: () => pulled };
};

describe('POST /api/events body limit', () => {
  it('a 1 MB chunked body: 413 after reading little more than the limit', async () => {
    const { req, pulled } = chunked(1024, 1024);
    expect(req.headers.get('content-length')).toBeNull();
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(pulled()).toBeLessThan(4);
    expect(countEvent).not.toHaveBeenCalled();
  });

  it('a small valid body still counts', async () => {
    const res = await POST(
      new NextRequest(`${SITE}/api/events`, {
        method: 'POST',
        headers: {
          origin: SITE,
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        },
        body: JSON.stringify({ name: 'dish_sheet_opened' }),
      }),
    );
    expect(res.status).toBe(204);
    expect(countEvent).toHaveBeenCalledWith('dish_sheet_opened');
  });
});
