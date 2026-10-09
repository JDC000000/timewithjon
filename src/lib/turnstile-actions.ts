// src/lib/turnstile-actions.ts — the Turnstile `action` each widget renders with and its route checks (AD-9): a token
// solved on one form is refused on another. Client-safe (the widgets import it too).
export const TURNSTILE_ACTION = {
  request: 'request', // the booking form's Send (general link)
  story: 'story', // the story page (general link)
  signIn: 'admin_sign_in', // A1's email step
} as const;
export type TurnstileAction = (typeof TURNSTILE_ACTION)[keyof typeof TURNSTILE_ACTION];
