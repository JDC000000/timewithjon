'use client';
// src/app/_guest/story-form.tsx — the story question, the photo picker, consent, the optional before-60 field and
// Send / "Skip for now" (S11; reused by S17 "Add a story or photo" and S19). The before-60 field is rendered only
// when the server says it is on, so with it off it is absent from the DOM (T1.8 AC4). Every field is optional,
// but an empty Send is held (R7-01); a photo still uploading makes Send wait, then it sends by itself.
// POST only on submit; the capability rides in a header or cookie, never in the body (T1.8 AC2).
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AFTER_SEND, ERRORS } from '@/content';
import { STORY_FORM } from '@/content/ui/guest-after';
import { Button, Field } from '@/ui';
import { moveFocus } from '@/ui/focus';
import { PhotoPicker, usePhotos } from './photo-picker';
import { decideSubmit, storyBody } from './story-submit';
import { mockUploader, type PhotoTarget } from './uploader';

export interface StoryFormProps {
  /** '/api/stories' (S11, S17) or '/api/story-page' (S19). */
  endpoint: string;
  /** Headers and query for the story and photo calls (S17: the manage token header). */
  target: PhotoTarget;
  maxPhotos: number;
  before60: boolean;
  /** Where "Skip for now" goes. */
  skipHref: string;
}

type Phase = 'idle' | 'waiting' | 'sending' | 'sent';

/** The pack's s11 question label, as drawn (the voice face at h2 size). */
const QUESTION_STYLE = {
  font: 'var(--fw-voice) var(--fs-h2)/1.15 var(--font-voice)',
  color: 'var(--c-ink)',
  marginTop: 'var(--s3)',
} as const;

export function StoryForm(p: StoryFormProps) {
  const ids = { story: useId(), storyErr: useId(), b60: useId(), thanks: useId(), hp: useId() };
  const uploader = useMemo(() => mockUploader(p.target), [p.target]);
  const photos = usePhotos(p.maxPhotos, uploader);
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
  const body = JSON.stringify(storyBody({ body: text, consent, before60Answer: before60, hp }));
  useEffect(() => {
    if (phase !== 'sending') return;
    const ac = new AbortController();
    fetch(p.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...p.target.headers },
      body,
      signal: ac.signal,
    })
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
      className="section"
      style={{ paddingTop: 'var(--s8)' }}
      aria-labelledby={`${ids.story}-q`}
      noValidate
      onSubmit={onSubmit}
    >
      <p className="cap muted">{AFTER_SEND.askTitle}</p>
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
      <div className="vh" aria-hidden="true">
        <label htmlFor={ids.hp}>{STORY_FORM.honeypot}</label>
        <input
          id={ids.hp}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
        />
      </div>
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
