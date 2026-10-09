// tests/fixtures/fake-google.ts — an in-process fake of the Google endpoints the app calls (T3.3–T3.5, T3.15).
// Install with vi.stubGlobal('fetch', google.fetch). Every request is recorded, so a test can assert on the
// request log (e.g. "no call ever targets primary", T3.4 AC5). Never real tokens; never a network call.

export const TEST_CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const TEST_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
export const TEST_ENC_KEY_OLD = Buffer.alloc(32, 9).toString('base64');
export const G3 = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

export interface RecordedCall {
  method: string;
  url: URL;
  body: string;
  auth: string | null;
  /** The If-Match header, when sent. */
  ifMatch: string | null;
}

export function idToken(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part({ iss: 'https://accounts.google.com', aud: TEST_CLIENT_ID, email_verified: true, ...claims })}.sig`;
}

type Reply = { status: number; json?: unknown };
type Override = (call: RecordedCall) => Reply | undefined;

export function fakeGoogle() {
  const calls: RecordedCall[] = [];
  const calendars = new Map<string, { summary: string; timeZone: string }>();
  /** Events by `${calendarId}/${eventId}`; a deleted event stays with status 'cancelled' (as Google keeps it). */
  const events = new Map<string, Record<string, unknown>>();
  let nextCalendar = 1;
  /** Every stored event carries an etag; each write gives it a new one (as Google does). */
  let nextEtag = 1;
  const etag = () => `"${nextEtag++}"`;
  /** Store an event with a fresh etag (a test changing an event behind the app's back uses it too). */
  const put = (key: string, e: Record<string, unknown>) => events.set(key, { ...e, etag: etag() });
  const state = {
    /** What the token endpoint answers for an authorization_code exchange. */
    account: 'jon@example.com',
    scopes: [...G3],
    refreshToken: 'refresh-1' as string | null,
    /** Refresh tokens Google considers dead (invalid_grant). */
    revoked: new Set<string>(),
    overrides: [] as Override[],
    /** freebusy.query answers by calendar id ('primary' = the account's main calendar); others: notFound. */
    busy: new Map<string, { start: string; end: string }[]>([['primary', []]]),
  };

  const reply = (r: Reply) =>
    new Response(r.json === undefined ? null : JSON.stringify(r.json), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });

  function route(call: RecordedCall): Reply {
    const { method, url } = call;
    const form = new URLSearchParams(call.body);
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
      if (form.get('grant_type') === 'authorization_code') {
        return {
          status: 200,
          json: {
            access_token: 'access-1',
            expires_in: 3599,
            ...(state.refreshToken ? { refresh_token: state.refreshToken } : {}),
            scope: state.scopes.join(' '),
            id_token: idToken({ email: state.account }),
          },
        };
      }
      const rt = form.get('refresh_token') ?? '';
      if (state.revoked.has(rt)) return { status: 400, json: { error: 'invalid_grant' } };
      return {
        status: 200,
        json: { access_token: `access-for-${rt}`, expires_in: 3599, scope: G3.join(' ') },
      };
    }
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
      state.revoked.add(form.get('token') ?? '');
      return { status: 200, json: {} };
    }
    const cal = url.pathname.match(/^\/calendar\/v3\/calendars(?:\/([^/]+))?$/);
    if (url.host === 'www.googleapis.com' && cal) {
      if (method === 'POST' && !cal[1]) {
        const id = `cal${nextCalendar++}@group.calendar.google.com`;
        calendars.set(id, JSON.parse(call.body) as { summary: string; timeZone: string });
        return { status: 200, json: { id, ...calendars.get(id) } };
      }
      const id = decodeURIComponent(cal[1] ?? '');
      if (method === 'GET')
        return calendars.has(id)
          ? { status: 200, json: { id, ...calendars.get(id) } }
          : { status: 404, json: { error: { errors: [{ reason: 'notFound' }] } } };
    }
    if (url.host === 'www.googleapis.com' && url.pathname === '/calendar/v3/freeBusy' && method === 'POST') {
      const q = JSON.parse(call.body) as { timeMin: string; timeMax: string; items: { id: string }[] };
      const [min, max] = [Date.parse(q.timeMin), Date.parse(q.timeMax)];
      const out: Record<string, unknown> = {};
      for (const { id } of q.items) {
        const list = state.busy.get(id);
        out[id] = list
          ? { busy: list.filter((b) => Date.parse(b.end) > min && Date.parse(b.start) < max) }
          : { busy: [], errors: [{ domain: 'global', reason: 'notFound' }] };
      }
      return { status: 200, json: { kind: 'calendar#freeBusy', calendars: out } };
    }
    const ev = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (url.host === 'www.googleapis.com' && ev) {
      const calId = decodeURIComponent(ev[1] ?? '');
      if (!calendars.has(calId))
        return { status: 404, json: { error: { errors: [{ reason: 'notFound' }] } } };
      const body = call.body ? (JSON.parse(call.body) as Record<string, unknown>) : {};
      if (method === 'GET' && !ev[2]) {
        // events.list: live events ending after timeMin (showDeleted defaults to false, as on Google).
        const min = Date.parse(url.searchParams.get('timeMin') ?? '1970-01-01T00:00:00Z');
        const items = [...events.entries()]
          .filter(([k, e]) => k.startsWith(`${calId}/`) && e.status !== 'cancelled')
          .map(([, e]) => e)
          .filter((e) => Date.parse((e.end as { dateTime: string }).dateTime) > min);
        return { status: 200, json: { kind: 'calendar#events', items } };
      }
      if (method === 'POST' && !ev[2]) {
        const key = `${calId}/${String(body.id)}`;
        if (events.has(key)) return { status: 409, json: { error: { errors: [{ reason: 'duplicate' }] } } };
        put(key, { status: 'confirmed', ...body });
        return { status: 200, json: events.get(key) };
      }
      const key = `${calId}/${decodeURIComponent(ev[2] ?? '')}`;
      const existing = events.get(key);
      if (!existing) return { status: 404, json: { error: { errors: [{ reason: 'notFound' }] } } };
      if (method === 'GET') return { status: 200, json: existing }; // cancelled events too, as Google does
      // A conditional write against a changed event: 412, nothing written (Google's If-Match).
      if (call.ifMatch && call.ifMatch !== existing.etag)
        return { status: 412, json: { error: { errors: [{ reason: 'conditionNotMet' }] } } };
      if (method === 'PATCH') {
        put(key, { ...existing, ...body });
        return { status: 200, json: events.get(key) };
      }
      if (method === 'DELETE') {
        if (existing.status === 'cancelled')
          return { status: 410, json: { error: { errors: [{ reason: 'deleted' }] } } };
        put(key, { ...existing, status: 'cancelled' });
        return { status: 204 };
      }
    }
    return { status: 599, json: { error: 'unhandled_by_fake_google' } };
  }

  async function fetchImpl(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    const call: RecordedCall = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      body: typeof init?.body === 'string' ? init.body : '',
      auth: headers.get('authorization'),
      ifMatch: headers.get('if-match'),
    };
    calls.push(call);
    for (const o of state.overrides) {
      const r = o(call);
      if (r) return reply(r);
    }
    return reply(route(call));
  }

  return { fetch: fetchImpl, calls, calendars, events, state, put };
}
