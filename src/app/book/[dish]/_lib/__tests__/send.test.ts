// T1.7.U4 the guest Send: the body the flows post, the answer they read, one POST per Send, and the details checks.
import { describe, expect, it, vi } from 'vitest';
import { ERRORS } from '@/content';
import { DETAILS } from '@/content/ui/booking';
import { RequestBody } from '@/features/requests/schema';
import { detailsErrors, FIELD_IDS } from '../form-errors';
import { guestView, NO_GUEST } from '../flow-view';
import { createSender, requestPayload, type RequestPayload } from '../send';

const KEY = '0b7f4c7e-2f7a-4d4c-9d0e-3c1a2b4c5d6e'; // gitleaks:allow (test fixture)
const DETAILS_IN = { name: '  Sam Rivera ', email: ' sam@example.com ', hp: '' };

function answer(status: number, json: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;
}

describe('requestPayload', () => {
  it('times: the picks, the trimmed details, crew 1, no empty optionals; the server schema accepts it', () => {
    const body = requestPayload(KEY, 'the-long-lunch', DETAILS_IN, { slotIds: ['s1', 's2'] });
    expect(body).toEqual({
      clientKey: KEY,
      dish: 'the-long-lunch',
      name: 'Sam Rivera',
      email: 'sam@example.com',
      crew: 1,
      slotIds: ['s1', 's2'],
    });
    expect(RequestBody.safeParse(body).success).toBe(true);
  });

  it('a stand-by week, dates, the rough window, the zone, the idea, the plan and the Turnstile token pass through', () => {
    const body = requestPayload(
      KEY,
      'surprise-me',
      { ...DETAILS_IN, hp: 'bot' },
      {
        standbyWeek: '2027-04-12',
        dates: ['2027-04-17'],
        windowText: ' sometime in May ',
        overnight: true,
        overnightNight: 'May 3, Tofino',
        guestTimeZone: 'Europe/London',
        pitchIdea: 'Sailing',
        surpriseNeedToKnow: 'Wear boots',
        surprisePlan: '',
      },
      'tok',
    );
    expect(body).toEqual({
      clientKey: KEY,
      dish: 'surprise-me',
      name: 'Sam Rivera',
      email: 'sam@example.com',
      crew: 1,
      standbyWeek: '2027-04-12',
      dates: ['2027-04-17'],
      windowText: 'sometime in May',
      overnight: true,
      overnightNight: 'May 3, Tofino',
      guestTimeZone: 'Europe/London',
      pitchIdea: 'Sailing',
      surpriseNeedToKnow: 'Wear boots',
      hp: 'bot',
      turnstileToken: 'tok',
    });
    expect(RequestBody.safeParse(body).success).toBe(true);
  });

  it('blank text and an empty stand-by week are left out', () => {
    const body = requestPayload(KEY, 'pitch-me', DETAILS_IN, {
      windowText: '   ',
      pitchIdea: '',
      standbyWeek: undefined,
      guestTimeZone: undefined,
    });
    for (const k of ['windowText', 'pitchIdea', 'standbyWeek', 'guestTimeZone', 'hp', 'turnstileToken'])
      expect(body).not.toHaveProperty(k);
  });
});

describe('createSender', () => {
  const body = requestPayload(KEY, 'the-long-lunch', DETAILS_IN, { slotIds: ['s1'] });

  it('POSTs the JSON body to /api/requests once and answers ok', async () => {
    const f = answer(200, { ok: true, sentTo: 'sam@example.com' });
    await expect(createSender(f)(body)).resolves.toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(f).mock.calls[0]!;
    expect(url).toBe('/api/requests');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body)) as RequestPayload).toEqual(body);
  });

  it('a refusal comes back with the server’s own code and message', async () => {
    const f = answer(409, { ok: false, code: 'time_gone', message: ERRORS.timeGone });
    await expect(createSender(f)(body)).resolves.toEqual({
      ok: false,
      code: 'time_gone',
      message: ERRORS.timeGone,
    });
  });

  it('no JSON, a 200 without ok, or no answer at all: the generic line, never silence', async () => {
    const html = vi.fn(async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch;
    await expect(createSender(html)(body)).resolves.toEqual({
      ok: false,
      code: 'http',
      message: ERRORS.generic,
    });
    await expect(createSender(answer(200, { ok: false }))(body)).resolves.toEqual({
      ok: false,
      code: 'http',
      message: ERRORS.generic,
    });
    const down = vi.fn(async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    await expect(createSender(down)(body)).resolves.toEqual({
      ok: false,
      code: 'network',
      message: ERRORS.generic,
    });
  });

  it('a second Send while one is in flight posts nothing', async () => {
    let release!: (r: Response) => void;
    const f = vi.fn(() => new Promise<Response>((r) => (release = r))) as unknown as typeof fetch;
    const send = createSender(f);
    const first = send(body);
    await expect(send(body)).resolves.toBeNull();
    release(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(first).resolves.toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('after a landed Send nothing more is posted; after a refusal the next Send goes', async () => {
    const ok = answer(200, { ok: true });
    const sendOk = createSender(ok);
    await sendOk(body);
    await expect(sendOk(body)).resolves.toBeNull();
    expect(ok).toHaveBeenCalledTimes(1);

    const no = answer(400, { ok: false, code: 'bot_check', message: ERRORS.botCheck });
    const sendNo = createSender(no);
    await sendNo(body);
    await sendNo(body);
    expect(no).toHaveBeenCalledTimes(2);
  });
});

describe('detailsErrors', () => {
  it('a name and an email that looks like one: nothing to fix', () => {
    expect(detailsErrors(' Sam ', ' sam@example.com ')).toEqual([]);
  });
  it('no name, then a bad email: in that order, each landing on its field', () => {
    expect(detailsErrors('  ', 'sam@example')).toEqual([
      { key: 'name', target: FIELD_IDS.name, inline: DETAILS.nameError, summary: DETAILS.nameError },
      { key: 'email', target: FIELD_IDS.email, inline: ERRORS.badEmail, summary: ERRORS.badEmail },
    ]);
    for (const bad of ['', 'sam', 'sam @example.com', '@example.com', 'sam@.'])
      expect(detailsErrors('Sam', bad).map((e) => e.key)).toEqual(['email']);
  });
});

describe('guestView', () => {
  const base = { prefill_name: 'Sam Rivera', prefill_email: 'sam@example.com' };
  it('a personal invite arrives filled in, with no Turnstile', () => {
    expect(guestView({ kind: 'personal', ...base }, 'site-key')).toEqual({
      name: 'Sam Rivera',
      email: 'sam@example.com',
      general: false,
    });
    expect(guestView({ kind: 'personal', prefill_name: null, prefill_email: null }, undefined)).toEqual(
      NO_GUEST,
    );
  });
  it('a general invite starts blank and carries the site key (none in mock mode)', () => {
    expect(guestView({ kind: 'general', ...base }, 'site-key')).toEqual({
      name: '',
      email: '',
      general: true,
      siteKey: 'site-key',
    });
    expect(guestView({ kind: 'general', ...base }, undefined)).toEqual({
      name: '',
      email: '',
      general: true,
    });
  });
});
