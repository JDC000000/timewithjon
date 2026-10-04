import { describe, expect, it } from 'vitest';
import { scrubEvent, scrubBreadcrumb, scrubObject, scrubText } from '@/lib/sentry-scrub';
describe('AD-11 scrubber', () => {
  it('scrubs names and free-text keys, and pg failing-row details (B008)', () => {
    expect(
      scrubObject({
        contact_name: 'Dave',
        from_name: 'Dave',
        name: 'Dave',
        pitch_idea: 'x',
        surprise_need_to_know: 'x',
        before60_answer: 'x',
        answer: 'x',
        area: 'requests',
      }),
    ).toEqual({
      contact_name: '[scrubbed]',
      from_name: '[scrubbed]',
      name: '[scrubbed]',
      pitch_idea: '[scrubbed]',
      surprise_need_to_know: '[scrubbed]',
      before60_answer: '[scrubbed]',
      answer: '[scrubbed]',
      area: 'requests',
    });
    const t = scrubText('new row violates check constraint. Failing row contains (x, dave, (a, b)).');
    expect(t).not.toMatch(/dave/i);
    expect(t).toBe('new row violates check constraint. Failing row contains ([scrubbed]).');
  });
  it('drops bodies, query strings and cookies', () => {
    const e = scrubEvent({
      request: {
        url: 'https://x/?for=dave-k7q2m9xp',
        data: { note: 'hi' },
        query_string: 'for=dave',
        cookies: { twj_invite: 'x' },
        headers: { cookie: 'a' },
      },
      extra: { contact_email: 'a@b.c', ok: 1 },
    });
    expect(e.request).toEqual({ url: 'https://x/', headers: {} });
    expect(e.extra).toEqual({ contact_email: '[scrubbed]', ok: 1 });
  });
  it('scrubs breadcrumb urls and sensitive keys', () => {
    expect(scrubBreadcrumb({ data: { url: '/api/x?token=abc', phone: '604' } }).data).toEqual({
      url: '/api/x',
      phone: '[scrubbed]',
    });
  });
  it('M6 drops user, contexts and non-allowlisted headers; redacts exception text and breadcrumbs', () => {
    const e = scrubEvent({
      request: {
        url: 'https://x/api',
        headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4', 'user-agent': 'UA', Cookie: 'c' },
      },
      exception: { values: [{ value: 'duplicate key: Key (email)=(dave@example.com) already exists' }] },
      message: 'send to dave@example.com failed',
      user: { ip_address: '1.2.3.4', email: 'dave@example.com' },
      contexts: { form: { email: 'dave@example.com' } },
      breadcrumbs: [{ data: { url: '/?for=dave-k7q2m9xp', email: 'dave@example.com' } }],
    });
    expect(e.request!.headers).toEqual({ 'user-agent': 'UA' });
    expect(e.user).toBeUndefined();
    expect(e.contexts).toBeUndefined();
    expect(e.exception!.values![0]!.value).toBe('duplicate key: Key (email)=([scrubbed]) already exists');
    expect(e.message).toBe('send to [email] failed');
    expect(e.breadcrumbs).toEqual([{ data: { url: '/', email: '[scrubbed]' } }]);
    expect(JSON.stringify(e)).not.toContain('dave@example.com');
    expect(JSON.stringify(e)).not.toContain('1.2.3.4');
  });
  it('N3 scrubs queries, emails and IPs from exception values, messages, tags, extra and console breadcrumbs', () => {
    const e = scrubEvent({
      exception: { values: [{ value: 'lookup failed for /?for=dave-k7q2m9xp from 203.0.113.9' }] },
      message: 'GET /?for=dave-k7q2m9xp',
      tags: { path: '/?for=dave-k7q2m9xp' },
      extra: { seen: 'dave@example.com at 203.0.113.9' },
      breadcrumbs: [{ message: 'fetching /?for=dave-k7q2m9xp', data: { arguments: ['from 203.0.113.9'] } }],
    });
    const all = JSON.stringify(e);
    for (const c of ['k7q2m9xp', 'dave@example.com', '203.0.113.9']) expect(all).not.toContain(c);
  });
  it('N2 keeps only known DSC keys in the envelope header and scrubs the transaction', async () => {
    const { scrubEnvelopeHeader } = await import('@/lib/sentry-scrub');
    const header: { trace?: Record<string, unknown> } = {
      trace: { trace_id: 't', public_key: 'p', transaction: 'GET /?for=bag-k7q2m9xp', evil: 'x' },
    };
    scrubEnvelopeHeader(header);
    expect(header.trace).toEqual({ trace_id: 't', public_key: 'p', transaction: 'GET /' });
  });
});
