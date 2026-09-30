// T2.1.U1 A1b "Send a new code" (pr75-review F4), user-event only: a double tap sends /start once, and the
// status line is announced only when /start answers ok; a refusal shows in "Things to fix" instead.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { SIGN_IN } from '@/content/ui/admin-requests';
import { EMAIL_KEY } from './sign-in-logic';
import { SignInFlow } from './SignInFlow';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams('step=code'),
}));

let uninstall: () => void = () => {};
let release: (() => void) | null = null;
const calls: string[] = [];
beforeEach(() => {
  uninstall = installFocusGuard(null);
  sessionStorage.setItem(EMAIL_KEY, 'jon@example.com');
  calls.length = 0;
  document.body.insertAdjacentHTML('beforeend', '<div id="live"></div>');
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  cleanup(); // unmount React roots first: a live root's scheduler would fire after jsdom teardown
  document.body.innerHTML = '';
});

function stubStart(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      await new Promise<void>((r) => (release = r));
      return new Response(JSON.stringify(status === 200 ? { ok: true } : { ok: false, code: 'bot_check' }), {
        status,
      });
    }),
  );
}
const live = () => document.getElementById('live')!.textContent ?? '';

describe('A1b Send a new code', () => {
  it('a double tap sends one /start; the line is said only after it answers ok', async () => {
    const user = userEvent.setup();
    stubStart(200);
    render(<SignInFlow linkSpent={false} />);
    const again = await screen.findByRole('button', { name: SIGN_IN.sendNew });
    await user.click(again);
    await user.click(again);
    expect(calls).toEqual(['/api/admin/auth/start']);
    expect(live()).toBe(''); // nothing announced while /start is out
    release!();
    await vi.waitFor(() => expect(live().trim()).toBe(SIGN_IN.onTheirWay('jon@example.com')));
  });

  it('a refused resend announces nothing and lands in Things to fix', async () => {
    const user = userEvent.setup();
    stubStart(400);
    render(<SignInFlow linkSpent={false} />);
    await user.click(await screen.findByRole('button', { name: SIGN_IN.sendNew }));
    release!();
    expect(await screen.findByRole('heading', { name: 'One thing to fix' })).toBeTruthy();
    expect(live()).toBe('');
  });
});
