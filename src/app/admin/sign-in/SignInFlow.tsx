'use client';
// src/app/admin/sign-in/SignInFlow.tsx — T2.1.U1: A1 (email + Turnstile) then A1b (the one code field). The code
// step is `?step=code` in this tab's history, so Back returns to the email step; the address waits in
// sessionStorage (never the URL), so a reload of the code step keeps it. Focus lands on each step's heading, or
// on "Things to fix" after a send with problems (FOC-04).
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Field, TextButton } from '@/ui';
import { announce, useLandingFocus } from '@/ui/focus';
import { SIGN_IN } from '@/content/ui/admin-requests';
import { ErrorSummary, type Problem } from '../_requests/ErrorSummary';
import { codeError, EMAIL_KEY, emailError, requestCode, verifyCode } from './sign-in-logic';
import { useTurnstile } from './useTurnstile';

type Step = 'email' | 'code';

const EMAIL_EVENT = 'twj:signin-email';

function readEmail(): string {
  try {
    return sessionStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveEmail(email: string | null): void {
  try {
    if (email) sessionStorage.setItem(EMAIL_KEY, email);
    else sessionStorage.removeItem(EMAIL_KEY);
  } catch {
    // private mode: a reload of the code step goes back to the email step
  }
  window.dispatchEvent(new Event(EMAIL_EVENT));
}
function onEmail(fn: () => void): () => void {
  window.addEventListener(EMAIL_EVENT, fn);
  return () => window.removeEventListener(EMAIL_EVENT, fn);
}

export function SignInFlow({ siteKey, linkSpent }: { siteKey?: string; linkSpent: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  // null on the server and in the first client render (no sessionStorage there): the email step shows first.
  const stored = useSyncExternalStore(onEmail, readEmail, () => null);
  const email = stored ?? '';
  const hydrated = stored !== null;
  const { setContainer, takeToken } = useTurnstile(siteKey);

  // The code step needs an address: a code-step URL without one (another tab, a cleared store) shows the email step.
  const step: Step = hydrated && params.get('step') === 'code' && email ? 'code' : 'email';

  useEffect(() => {
    document.title = step === 'code' ? SIGN_IN.codePageTitle : SIGN_IN.pageTitle;
  }, [step]);

  const toCodeStep = (address: string) => {
    saveEmail(address);
    router.push('/admin/sign-in?step=code', { scroll: false });
  };

  return (
    <>
      {step === 'email' ? (
        <EmailStep initialEmail={email} takeToken={takeToken} onSent={toCodeStep} linkSpent={linkSpent} />
      ) : (
        <CodeStep
          email={email}
          takeToken={takeToken}
          linkSpent={linkSpent}
          onSignedIn={() => {
            saveEmail(null);
            router.replace('/admin');
            router.refresh();
          }}
        />
      )}
      {/* One widget for both steps: "Send a new code" needs a fresh token too. Invisible unless Cloudflare asks. */}
      <div ref={setContainer} />
      <p className="help">{SIGN_IN.help}</p>
    </>
  );
}

function EmailStep({
  initialEmail,
  takeToken,
  onSent,
  linkSpent,
}: {
  initialEmail: string;
  takeToken: () => Promise<string | undefined>;
  onSent: (email: string) => void;
  linkSpent: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [value, setValue] = useState(initialEmail);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>(linkSpent ? [{ message: SIGN_IN.linkSpent }] : []);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  useLandingFocus(heading, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const err = emailError(value);
    if (err) {
      setFieldError(err.field);
      setProblems([{ fieldId: 's-email', message: err.summary }]);
      setAttempt((n) => n + 1);
      return;
    }
    setProblems([]);
    setBusy(true);
    const res = await requestCode(value, await takeToken());
    setBusy(false);
    if (res.ok) return onSent(value.trim());
    setProblems([{ message: res.message }]);
    setAttempt((n) => n + 1);
  };

  return (
    <>
      <h1 className="h1" tabIndex={-1} ref={heading}>
        {SIGN_IN.title}
      </h1>
      <form noValidate onSubmit={submit}>
        <ErrorSummary problems={problems} attempt={attempt} />
        <Field
          id="s-email"
          label={SIGN_IN.emailLabel}
          type="email"
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          required
          maxLength={254}
          value={value}
          error={fieldError}
          onChange={(e) => {
            setValue(e.currentTarget.value);
            setFieldError(null);
          }}
        />
        <p className="send">
          <Button variant="commit" block type="submit" busy={busy ? SIGN_IN.sending : undefined}>
            {SIGN_IN.send}
          </Button>
        </p>
      </form>
    </>
  );
}

function CodeStep({
  email,
  takeToken,
  linkSpent,
  onSignedIn,
}: {
  email: string;
  takeToken: () => Promise<string | undefined>;
  linkSpent: boolean;
  onSignedIn: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>(linkSpent ? [{ message: SIGN_IN.linkSpent }] : []);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  useLandingFocus(heading, []);

  const fail = (p: Problem, onField: boolean) => {
    setFieldError(onField ? p.message : null);
    setProblems([p]);
    setAttempt((n) => n + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const err = codeError(code);
    if (err) return fail({ fieldId: 's-code', message: err.summary }, true);
    setProblems([]);
    setBusy(true);
    const res = await verifyCode(email, code);
    if (res.ok) return onSignedIn(); // stays busy while the admin loads
    setBusy(false);
    if (res.where === 'field') fail({ fieldId: 's-code', message: res.error.summary }, true);
    else fail({ message: res.message }, false);
  };

  // "Send a new code": the field and the problems clear; one send at a time (a double tap would spend the fresh
  // Turnstile token twice); the status line is said again only once /start has answered (pr75-review F4).
  const [resending, setResending] = useState(false);
  const resend = async () => {
    if (resending) return;
    setResending(true);
    setCode('');
    setFieldError(null);
    setProblems([]);
    const res = await requestCode(email, await takeToken());
    setResending(false);
    if (res.ok) announce(SIGN_IN.onTheirWay(email));
    else fail({ message: res.message }, false);
  };

  return (
    <>
      <h1 className="h1" tabIndex={-1} ref={heading}>
        {SIGN_IN.codeTitle}
      </h1>
      <p className="ui" id="a1b-st" style={{ marginTop: 'var(--s3)', color: 'var(--c-ink)' }}>
        {SIGN_IN.onTheirWay(email)}
      </p>
      <form noValidate onSubmit={submit}>
        <ErrorSummary problems={problems} attempt={attempt} />
        <Field
          id="s-code"
          label={SIGN_IN.codeLabel}
          hint={SIGN_IN.codeHint}
          inputClassName="code-in"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          placeholder="······"
          required
          value={code}
          error={fieldError}
          onChange={(e) => {
            setCode(e.currentTarget.value);
            setFieldError(null);
          }}
        />
        <p className="send">
          <Button variant="commit" block type="submit" disabled={busy}>
            {SIGN_IN.signIn}
          </Button>
        </p>
        <p>
          <TextButton onClick={resend}>{SIGN_IN.sendNew}</TextButton>
        </p>
      </form>
    </>
  );
}
