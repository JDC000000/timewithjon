// EML-11: signed out, "Open the request" lands on sign-in with ?next=<that page>; after the code, sign-in goes
// there. Only a same-origin admin page is followed: an outside or protocol-relative next ends on the inbox.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { SIGN_IN } from '@/content/ui/admin-requests';
import { EMAIL_KEY } from './sign-in-logic';
import { SignInFlow } from './SignInFlow';

const nav = vi.hoisted(() => ({ search: '', replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

let uninstall: () => void = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  nav.replace.mockReset();
  nav.push.mockReset();
  document.body.insertAdjacentHTML('beforeend', '<div id="live"></div>');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  cleanup();
  document.body.innerHTML = '';
});

async function signInWithCode(search: string) {
  nav.search = search;
  sessionStorage.setItem(EMAIL_KEY, 'jon@example.com');
  const user = userEvent.setup();
  render(<SignInFlow notice={null} />);
  await user.type(await screen.findByLabelText(new RegExp(SIGN_IN.codeLabel)), '123456');
  await user.click(screen.getByRole('button', { name: SIGN_IN.signIn }));
  await vi.waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
  return nav.replace.mock.calls[0]![0] as string;
}

const ID = '11111111-1111-4111-8111-111111111111';

describe('sign-in returns to the page it came from (EML-11)', () => {
  it('a request page: back to it', async () => {
    expect(await signInWithCode(`step=code&next=%2Fadmin%2Frequests%2F${ID}`)).toBe(`/admin/requests/${ID}`);
  });

  it.each(['https://evil.example/admin', '//evil.example', '/\\evil.example', '/menu'])(
    'next=%s is refused: the inbox',
    async (next) => {
      expect(await signInWithCode(`step=code&next=${encodeURIComponent(next)}`)).toBe('/admin');
    },
  );

  it.each([
    [`/admin/requests/${ID}`, `/admin/sign-in?step=code&next=%2Fadmin%2Frequests%2F${ID}`],
    ['//evil.example', '/admin/sign-in?step=code'],
  ])(
    'the email step keeps next=%s on the way to the code step (an unsafe one is dropped)',
    async (next, want) => {
      nav.search = `next=${encodeURIComponent(next)}`;
      const user = userEvent.setup();
      render(<SignInFlow notice={null} />);
      await user.type(await screen.findByLabelText(new RegExp(SIGN_IN.emailLabel)), 'jon@example.com');
      await user.click(screen.getByRole('button', { name: SIGN_IN.send }));
      await vi.waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
      expect(nav.push.mock.calls[0]![0]).toBe(want);
    },
  );
});
