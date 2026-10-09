'use client';
// src/app/_guest/story-form.tsx — the story question, the photo picker, consent, the optional before-60 field and
// Send / "Skip for now" (S11; reused by S17 "Add a story or photo" and S19). The before-60 field is rendered only
// when the server says it is on, so with it off it is absent from the DOM (T1.8 AC4). Every field is optional,
// but an empty Send is held (R7-01); a photo still uploading makes Send wait, then it sends by itself.
// POST only on submit; the capability rides in a header or cookie, never in the body (T1.8 AC2).
// S19 (`storyPage`): the first save creates the story, so a photo picked before Send first saves the story as it
// stands (nothing typed yet), and only that first save carries the general invite's Turnstile token (AD-9). Later
// saves in the same page view update that story; a fresh visit starts a new one (QA r2 H1). On the general link S19
// also asks for the guest's name (optional: its own label, the booking form's length; M4).
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AFTER_SEND, ERRORS } from '@/content';
import { STORY_FORM } from '@/content/ui/guest-after';
import { TurnstileSlot, useGuestTurnstile } from '@/features/requests/GuestTurnstile';
import { TURNSTILE_ACTION } from '@/lib/turnstile-actions';
import { stripBidiControls } from '@/lib/bidi';
import { Button, Field } from '@/ui';
import { moveFocus } from '@/ui/focus';
import { HoneypotField } from './honeypot';
import { PhotoPicker, usePhotos } from './photo-picker';
import { decideSubmit, storyBody, storySaver } from './story-submit';
import { photoUploader, type PhotoTarget } from './uploader';

export interface StoryFormProps {
  /** '/api/stories' (S11, S17) or '/api/story-page' (S19). */
  endpoint: string;
  /** Headers and query for the story and photo calls (S17: the manage token header). */
  target: PhotoTarget;
  maxPhotos: number;
  before60: boolean;
  /** Where "Skip for now" goes. */
  skipHref: string;
  /**
   * S19 only: the story is created by its first save. For the general invite, `siteKey` (Turnstile) and `askName`
   * (an optional name box: a personal invite already names its guest).
   */
  storyPage?: { siteKey?: string; askName?: boolean };
}

type Phase = 'idle' | 'waiting' | 'sending' | 'sent';

/** The pack's s11 question label, as drawn (the voice face at h2 size). */
const QUESTION_STYLE = {
  font: 'var(--fw-voice) var(--fs-h2)/1.15 var(--font-voice)',
  color: 'var(--c-ink)',
  marginTop: 'var(--s3)',
} as const;

export function StoryForm(p: StoryFormProps) {
  const ids = {
    name: useId(),
    story: useId(),
    storyErr: useId(),
    b60: useId(),
    thanks: useId(),
    hp: useId(),
  };
  const turnstile = useGuestTurnstile(p.storyPage?.siteKey, TURNSTILE_ACTION.story);
  const { takeToken, reset } = turnstile;
  const isStoryPage = Boolean(p.storyPage);
  const saver = useMemo(
    () =>
      storySaver({
        endpoint: p.endpoint,
        headers: p.target.headers,
        opened: !isStoryPage,
        takeToken,
        reset,
      }),
    [p.endpoint, p.target.headers, isStoryPage, takeToken, reset],
  );
  const uploader = useMemo(
    () => photoUploader(p.target, isStoryPage ? saver.open : undefined),
    [p.target, isStoryPage, saver],
  );
  const photos = usePhotos(p.maxPhotos, uploader);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [before60, setBefore60] = useState('');
  const [hp, setHp] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [empty, setEmpty] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const storyRef = useRef<HTMLTextAreaElement>(null);
  const thanksRef = useRef<HTMLParagraphElement>(null);
  const errRef = useRef<HTMLParagraphElement>(null);
  // QA4 L10: "Add a line or a photo first" goes once a photo is added (as it goes once a line is typed). Adjusted while
  // rendering, as React advises for state that follows other state.
  const photoCount = photos.state.items.length;
  const [seenPhotos, setSeenPhotos] = useState(photoCount);
  if (photoCount !== seenPhotos) {
    setSeenPhotos(photoCount);
    if (photoCount > seenPhotos && empty) setEmpty(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (phase !== 'idle') return;
    const d = decideSubmit(text, photos.state);
    if (d === 'empty') {
      setEmpty(true);
      moveFocus(storyRef.current);
      return;
    }
    setFailed(null);
    setPhase(d === 'wait' ? 'waiting' : 'sending');
  }

  // Send waited for a photo: once nothing is uploading it goes. It holds if a photo failed (pr94 F3: the guest
  // sees "Try again" / Remove before the story goes without it; a second Send sends), or if there's nothing to send.
  const decision = decideSubmit(text, photos.state);
  if (phase === 'waiting' && decision !== 'wait') {
    const photoFailed = photos.state.items.some((ph) => ph.status === 'failed');
    setPhase(decision === 'send' && !photoFailed ? 'sending' : 'idle');
    if (decision === 'empty') setEmpty(true);
  }

  // The one POST, on submit only. A re-run effect (React dev) aborts the first call.
  const body = storyBody({
    name: p.storyPage?.askName ? name : undefined,
    body: text,
    consent,
    before60Answer: before60,
    hp,
  });
  useEffect(() => {
    if (phase !== 'sending') return;
    const ac = new AbortController();
    saver
      .save(body, ac.signal)
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
        if (res.ok && json?.ok) return setPhase('sent');
        setFailed(json?.message ?? ERRORS.generic);
        setPhase('idle');
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setFailed(ERRORS.generic);
        setPhase('idle');
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one POST per entry into 'sending', with this render's fields
  }, [phase]);

  // FOC-04: after a Send, focus lands on the thank-you line; after a refused Send, on the error.
  useEffect(() => {
    if (phase === 'sent') moveFocus(thanksRef.current);
  }, [phase]);
  useEffect(() => {
    if (failed) moveFocus(errRef.current);
  }, [failed]);

  if (phase === 'sent')
    return (
      <p id={ids.thanks} ref={thanksRef} className="lead" tabIndex={-1} style={{ marginTop: 'var(--s8)' }}>
        {AFTER_SEND.thanks}
      </p>
    );

  return (
    <form
      method="post"
      className="section"
      style={{ paddingTop: 'var(--s8)' }}
      aria-labelledby={`${ids.story}-q`}
      noValidate
      onSubmit={onSubmit}
    >
      <p className="cap muted">{AFTER_SEND.askTitle}</p>
      {p.storyPage?.askName && (
        <Field
          id={ids.name}
          name="name"
          label={STORY_FORM.nameLabel}
          maxLength={80}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(stripBidiControls(e.currentTarget.value))} // QA4 L9
        />
      )}
      <div className={empty ? 'field bad' : 'field'} style={{ maxWidth: 'none' }}>
        <label htmlFor={ids.story} id={`${ids.story}-q`} className="h2" style={QUESTION_STYLE}>
          {AFTER_SEND.question}
        </label>
        <span className="hint" style={{ marginTop: 'var(--s2)' }}>
          {AFTER_SEND.questionHint}
        </span>
        <textarea
          ref={storyRef}
          className="textarea"
          id={ids.story}
          rows={5}
          maxLength={5000}
          value={text}
          aria-invalid={empty || undefined}
          aria-describedby={ids.storyErr}
          onChange={(e) => {
            setText(e.target.value);
            setEmpty(false);
          }}
        />
        <p className="err" id={ids.storyErr} hidden={!empty}>
          {STORY_FORM.empty}
        </p>
      </div>
      <PhotoPicker photos={photos} />
      <label className="check" style={{ marginTop: 'var(--s4)', maxWidth: '34rem' }}>
        <input
          type="checkbox"
          name="consent"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>{AFTER_SEND.consent}</span>
      </label>
      {p.before60 && (
        <Field
          id={ids.b60}
          label={AFTER_SEND.before60}
          multiline
          rows={3}
          maxLength={2000}
          style={{ maxWidth: 'none' }}
          value={before60}
          onChange={(e) => setBefore60(e.target.value)}
        />
      )}
      <HoneypotField id={ids.hp} value={hp} onChange={setHp} />
      {turnstile.box && <TurnstileSlot box={turnstile.box} />}
      {failed && (
        <p className="err" ref={errRef} tabIndex={-1} role="alert">
          {failed}
        </p>
      )}
      <p className="send">
        <Button
          variant="commit"
          type="submit"
          busy={
            phase === 'waiting' ? STORY_FORM.waiting : phase === 'sending' ? STORY_FORM.sending : undefined
          }
        >
          {STORY_FORM.send}
        </Button>
        <Link className="textbtn" href={p.skipHref}>
          {AFTER_SEND.skip}
        </Link>
      </p>
    </form>
  );
}
