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
import { Field, FieldGroup, ROUTES } from '@/ui';
import { moveFocus } from '@/ui/focus';
import { FLOW } from '@/content';
import type { CrewRange } from '@/content/menu-helpers';
import { DETAILS } from '@/content/ui/booking';
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

/** A dish with no choice of party size (Q9): the screens don't ask and send 1. */
const SOLO: CrewRange = { min: 1, max: 1 };

export function useSend(
  dish: string,
  guest: GuestView,
  go: (href: string) => void = toPage,
  crewRange: CrewRange = SOLO,
) {
  const [start] = useState(() => prefill(guest));
  /** Q9: how many of you, the guest included; starts at the dish's smallest party */
  const [crew, setCrew] = useState(crewRange.min);
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
    const details = { name, email, hp, crew };
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

  /** QA M3: a kept draft's details; edited ones open the fields, as Change would. A kept crew outside the dish's
   * range (the data changed since) is dropped. */
  function restoreDetails(d: { name?: string; email?: string; crew?: string }) {
    const n0 = d.crew === undefined ? NaN : Number(d.crew);
    if (Number.isInteger(n0) && n0 >= crewRange.min && n0 <= crewRange.max) setCrew(n0);
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
    crew,
    setCrew,
    crewRange,
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
      <CrewStepper s={s} />
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

/**
 * Q9 "How many of you?" (PACK v1.12 s10's crew stepper): − n + inside one labelled group, from the dish's smallest
 * party to the servesMax the menu shows. Each button is a 44 px target; at an end its button says so with
 * aria-disabled and does nothing, but keeps focus (a disabled button would drop a keyboard user's focus). The number
 * is read out when it changes. A dish with one size (min = max) doesn't ask.
 */
function CrewStepper({ s }: { s: SendState }) {
  const { crew, setCrew, crewRange } = s;
  if (crewRange.max <= crewRange.min) return null;
  return (
    <FieldGroup id={FIELD_IDS.crew} label={FLOW.crewLabel}>
      {({ labelId }) => (
        <div className="stepper" role="group" aria-labelledby={labelId}>
          <button
            type="button"
            aria-label={DETAILS.crewFewer}
            aria-disabled={crew <= crewRange.min}
            onClick={() => setCrew((n) => Math.max(crewRange.min, n - 1))}
          >
            −
          </button>
          <output aria-live="polite" aria-atomic="true" data-testid="crew-count">
            {crew}
          </output>
          <button
            type="button"
            aria-label={DETAILS.crewMore}
            aria-disabled={crew >= crewRange.max}
            onClick={() => setCrew((n) => Math.min(crewRange.max, n + 1))}
          >
            +
          </button>
        </div>
      )}
    </FieldGroup>
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
