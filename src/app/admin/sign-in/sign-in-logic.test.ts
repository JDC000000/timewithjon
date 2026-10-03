// T2.1.U1: the A1 sign-in rules (field errors, code paste, how each server answer reads).
import { describe, expect, it, vi } from 'vitest';
import { ERRORS } from '@/content';
import { SIGN_IN } from '@/content/ui/admin-requests';
import type { ApiAnswer, Send } from '../_requests/api';
import { codeError, emailError, normaliseCode, requestCode, verifyCode } from './sign-in-logic';

function answering(a: ApiAnswer): { post: Send; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const post = vi.fn(async (...args: unknown[]) => {
    calls.push(args);
    return a;
  }) as unknown as Send;
  return { post, calls };
}

describe('emailError', () => {
  it('an empty or blank field asks for the admin email, in the field and the summary', () => {
    expect(emailError('')).toEqual({ field: SIGN_IN.emailEmpty, summary: SIGN_IN.emailEmpty });
    expect(emailError('   ')).toEqual({ field: SIGN_IN.emailEmpty, summary: SIGN_IN.emailEmpty });
  });
  it('a malformed address says so under the field and "Check your email." in the summary', () => {
    for (const bad of ['jon', 'jon@', 'jon@example', '@example.com', 'jon @example.com', 'jon@example.c']) {
      expect(emailError(bad)).toEqual({ field: ERRORS.badEmail, summary: SIGN_IN.emailBadSummary });
    }
  });
  it('an address over 254 characters is refused before the server sees it', () => {
    expect(emailError(`${'a'.repeat(242)}@example.com`)).toBeNull(); // 254 exactly
    expect(emailError(`${'a'.repeat(243)}@example.com`)).not.toBeNull();
  });
  it('a good address (spaces around it are fine) passes', () => {
    expect(emailError(' jon@example.com ')).toBeNull();
    expect(emailError('JON@Example.COM')).toBeNull();
  });
});

describe('the code field', () => {
  it('a pasted code with spaces or a line break counts only its digits', () => {
    expect(normaliseCode(' 482 119\n')).toBe('482119');
    expect(codeError('482 119')).toBeNull();
  });
  it('anything but exactly six digits is the wrong-code line', () => {
    for (const bad of ['', '48211', '4821190', 'abcdef', '48211x']) {
      expect(codeError(bad)).toEqual({ field: SIGN_IN.codeWrong, summary: SIGN_IN.codeWrong });
    }
  });
});

describe('requestCode (POST /api/admin/auth/start)', () => {
  it('posts the trimmed email and the Turnstile token', async () => {
    const { post, calls } = answering({ status: 200, data: { ok: true } });
    await expect(requestCode(' jon@example.com ', 'tok', post)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ['POST', '/api/admin/auth/start', { email: 'jon@example.com', turnstileToken: 'tok' }],
    ]);
  });
  it('a failed bot check, a 429 and anything else each read their own way', async () => {
    const bot = await requestCode('a@b.co', undefined, answering({ status: 400, code: 'bot_check' }).post);
    expect(bot).toEqual({ ok: false, message: ERRORS.botCheck });
    const other400 = await requestCode('a@b.co', undefined, answering({ status: 400, code: 'invalid' }).post);
    expect(other400).toEqual({ ok: false, message: ERRORS.generic });
    const limited = await requestCode('a@b.co', undefined, answering({ status: 429 }).post);
    expect(limited).toEqual({ ok: false, message: ERRORS.rateLimited });
    const offline = await requestCode('a@b.co', undefined, answering({ status: 0 }).post);
    expect(offline).toEqual({ ok: false, message: ERRORS.generic });
  });
  it('a 503 (sign-in limiter down, fail closed) says sign-in is paused', async () => {
    const down = await requestCode('a@b.co', undefined, answering({ status: 503, code: 'unavailable' }).post);
    expect(down).toEqual({ ok: false, message: SIGN_IN.unavailable });
  });
});

describe('verifyCode (POST /api/admin/auth/verify)', () => {
  it('posts the trimmed email and the digits of the code', async () => {
    const { post, calls } = answering({ status: 200, data: { ok: true } });
    await expect(verifyCode(' jon@example.com', '482 119', post)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([['POST', '/api/admin/auth/verify', { email: 'jon@example.com', code: '482119' }]]);
  });
  it('a wrong code and an address off the allowlist read the same (never who the admin is)', async () => {
    const wrong = {
      ok: false,
      where: 'field',
      error: { field: SIGN_IN.codeWrong, summary: SIGN_IN.codeWrong },
    };
    await expect(verifyCode('a@b.co', '123456', answering({ status: 400 }).post)).resolves.toEqual(wrong);
    await expect(verifyCode('a@b.co', '123456', answering({ status: 401 }).post)).resolves.toEqual(wrong);
  });
  it('a 503 (sign-in limiter down, fail closed) says sign-in is paused', async () => {
    await expect(verifyCode('a@b.co', '123456', answering({ status: 503 }).post)).resolves.toEqual({
      ok: false,
      where: 'notice',
      message: SIGN_IN.unavailable,
    });
  });
  it('too many tries points to the link; anything else is the generic notice', async () => {
    await expect(verifyCode('a@b.co', '123456', answering({ status: 429 }).post)).resolves.toEqual({
      ok: false,
      where: 'notice',
      message: SIGN_IN.tooManyTries,
    });
    for (const status of [0, 403, 404, 500]) {
      await expect(verifyCode('a@b.co', '123456', answering({ status }).post)).resolves.toEqual({
        ok: false,
        where: 'notice',
        message: ERRORS.generic,
      });
    }
  });
});
