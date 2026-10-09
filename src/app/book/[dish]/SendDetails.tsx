'use client';
// S10 details + Send (T1.7.U4), shared by BookingFlow, DatesFlow and PitchFlow: the guest's name and email (a
// personal invite's arrive filled in and show as one "Sending as Dave · dave@… · Change" line until Change (T1.7.U2);
// they stay editable), the Turnstile box for a general invite only (T1.7.U3, AD-9: height reserved, reset after
// any refusal (L11); no site key = no widget), the honeypot, then ONE POST /api/requests. Send shows
// "Sending…" and refuses a second tap; a refusal from the server is shown as it came, under Send, and takes focus;
// a saved request goes to /sent (its twj_req capability cookie came with the answer) and the tab's draft is cleared
// (QA M3, draft.ts).
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Field, ROUTES } from '@/ui';
import { moveFocus } from '@/ui/focus';
import { FLOW } from '@/content';
import { stripBidiControls } from '@/lib/bidi';
import { TurnstileSlot, useGuestTurnstile } from '@/features/requests/GuestTurnstile';
import { HoneypotField } from '../../_guest/honeypot';
import { clearDraft, draftStore } from './_lib/draft';
import { errorFor, FIELD_IDS, type FormError } from './_lib/form-errors';
import type { GuestView } from './_lib/flow-view';
import { prefill, SEND_AS } from './_lib/prefill';
import { keyFor, type KeyedBody } from '@/lib/client-key';
import { createSender, requestPayload, type Picks } from './_lib/send';

const toPage = (href: string) => window.location.assign(href);
/** the refusal line under Send (focus goes there) */
const SEND_ERROR_ID = 'send-err';

export function useSend(dish: string, guest: GuestView, go: (href: string) => void = toPage) {
  const [start] = useState(() => prefill(guest));
  const [name, setName] = useState(start.name);
  const [email, setEmail] = useState(start.email);
  /** T1.7.U2: a personal invite's fields stay behind the summary line until Change */
  const [changing, setChanging] = useState(false);
  const [hp, setHp] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const busy = useRef(false);
  /** One key per body (ENG-01): a retry of the same body after a lost answer replays it; an edited body, or a
   * refusal the server answered, gets a new one. */
  const keyed = useRef<KeyedBody | null>(null);
  const [send] = useState(() => createSender());
  const turnstile = useGuestTurnstile(guest.general ? guest.siteKey : undefined);

  async function submit(picks: Picks): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setFailed(null);
    setSending(true);
    const details = { name, email, hp };
    keyed.current = keyFor(keyed.current, requestPayload('', dish, details, picks));
    const token = guest.general ? await turnstile.takeToken() : undefined;
    const res = await send(requestPayload(keyed.current.key, dish, details, picks, token));
    if (res === null) return;
    if (res.ok) {
      clearDraft(draftStore(), dish);
      return go(ROUTES.sent); // stays "Sending…" while the page changes
    }
    if (res.code !== 'network') keyed.current = null;
    turnstile.reset(); // L11: the token went with the refused (or unanswered) request
    busy.current = false;
    flushSync(() => {
      setSending(false);
      setFailed(res.message);
    });
    moveFocus(document.getElementById(SEND_ERROR_ID), 'script');
  }

  /** QA M3: a kept draft's details; edited ones open the fields, as Change would. */
  function restoreDetails(d: { name?: string; email?: string }) {
    const n = d.name ?? start.name;
    const e = d.email ?? start.email;
    setName(n);
    setEmail(e);
    if (n !== start.name || e !== start.email) setChanging(true);
  }

  return {
    name,
    setName,
    email,
    setEmail,
    hp,
    setHp,
    sending,
    failed,
    submit,
    summary: changing ? null : start.summary,
    change: () => setChanging(true),
    restoreDetails,
    turnstileBox: turnstile.box,
  };
}

export type SendState = ReturnType<typeof useSend>;

/** The details fields; a fixed field clears its own error line. */
export function DetailsFields({
  s,
  errors,
  onFixed,
}: {
  s: SendState;
  errors: readonly FormError[];
  onFixed: (key: 'name' | 'email') => void;
}) {
  const { name, setName, email, setEmail, hp, setHp, turnstileBox, summary } = s;
  // A name or email error always shows its field (the summary link lands on it).
  const collapsed = summary && !errors.some((e) => e.key === 'name' || e.key === 'email');
  return (
    <div>
      {collapsed ? (
        <p className="sendas">
          <span>
            {SEND_AS.lead} <strong>{summary.name}</strong> · {summary.email}
          </span>
          <button
            type="button"
            className="textbtn"
            aria-expanded={false}
            onClick={() => {
              flushSync(s.change);
              moveFocus(document.getElementById(FIELD_IDS.name), 'script');
            }}
          >
            {SEND_AS.change}
          </button>
        </p>
      ) : (
        <>
          <Field
            id={FIELD_IDS.name}
            name="name"
            label={FLOW.nameLabel}
            required
            maxLength={80}
            autoComplete="name"
            value={name}
            error={errorFor(errors, 'name')?.inline ?? null}
            onChange={(e) => {
              setName(stripBidiControls(e.currentTarget.value)); // QA4b L4, as the story name box
              if (e.currentTarget.value.trim()) onFixed('name');
            }}
          />
          <Field
            id={FIELD_IDS.email}
            name="email"
            type="email"
            inputMode="email"
            label={FLOW.emailLabel}
            hint={FLOW.emailHint}
            required
            maxLength={254}
            autoComplete="email"
            spellCheck={false}
            value={email}
            error={errorFor(errors, 'email')?.inline ?? null}
            onChange={(e) => {
              setEmail(e.currentTarget.value);
              onFixed('email');
            }}
          />
        </>
      )}
      {turnstileBox && <TurnstileSlot box={turnstileBox} />}
      <HoneypotField id="f-hp" value={hp} onChange={setHp} />
    </div>
  );
}

/** The server's answer when it refused the request (or the generic line when it never answered). */
export function SendFailed({ s }: { s: SendState }) {
  return s.failed ? (
    <p className="err" id={SEND_ERROR_ID} tabIndex={-1} role="alert">
      {s.failed}
    </p>
  ) : null;
}
