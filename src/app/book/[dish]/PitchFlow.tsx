'use client';
// Pitch Me (T1.6.U5, wireframe 06-B/C2/F): the idea first, then the "Try:" starters (each one drops its words into
// the idea: into an empty idea, else on a new line; never replacing what the guest wrote; focus goes to the end of
// the idea and "Added a starter" is announced), then when, then the one-night row, which reveals "Which night?".
// Send checks the idea, then when: the error summary takes focus, fixing a field clears its error. What the guest
// typed is kept for this tab (useDraft, QA M3): a reload or Back restores it.
import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Button, Field, KeepWhole } from '@/ui';
import { announce, moveFocus } from '@/ui/focus';
import { FLOW } from '@/content';
import { DATES, FLOW_UI, PITCH } from '@/content/ui/booking';
import { ErrorSummary } from './ErrorSummary';
import { DetailsFields, SendFailed, useSend } from './SendDetails';
import { PicksRail } from './PicksRail';
import {
  detailsErrors,
  errorFor,
  FIELD_IDS,
  pitchErrors,
  withoutError,
  type FormError,
} from './_lib/form-errors';
import { NO_GUEST, type DishView, type FlowNotices, type GuestView } from './_lib/flow-view';
import { useDraft } from './_lib/useDraft';

/** A starter into the idea: the idea itself when empty, else appended on a new line (wireframe 06 n4). */
export function addStarter(idea: string, starter: string): string {
  return idea.trim() ? `${idea.replace(/\s+$/, '')}\n${starter}` : starter;
}

export function PitchFlow({
  dish,
  notices,
  guest = NO_GUEST,
}: {
  dish: DishView;
  notices: FlowNotices;
  guest?: GuestView;
}) {
  const [idea, setIdea] = useState('');
  const [when, setWhen] = useState('');
  const [overnight, setOvernight] = useState(false);
  const [night, setNight] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const s = useSend(dish.slug, guest);
  useDraft(dish.slug, { idea, when, overnight, night, name: s.name, email: s.email }, (d) => {
    setIdea(d.idea ?? '');
    setWhen(d.when ?? '');
    setOvernight(Boolean(d.overnight && dish.overnightAllowed));
    setNight(d.night ?? '');
    s.restoreDetails(d);
  });

  function onStarter(starter: string) {
    const next = addStarter(idea, starter);
    flushSync(() => {
      setIdea(next);
      setErrors((e) => withoutError(e, 'idea'));
    });
    // A value set from script leaves the caret at its end, so focus lands after the starter.
    moveFocus(document.getElementById(FIELD_IDS.idea), 'script');
    announce(PITCH.added);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = [...pitchErrors(idea, when), ...detailsErrors(s.name, s.email)];
    flushSync(() => setErrors(found));
    if (found.length) return moveFocus(summaryRef.current, 'script');
    void s.submit({
      pitchIdea: idea,
      windowText: when,
      overnight,
      ...(overnight ? { overnightNight: night } : {}),
    });
  }

  const railItems = [
    ...(when.trim() ? [{ key: 'when', label: when.trim() }] : []),
    ...(overnight ? [{ key: 'night', label: PITCH.oneNightAway }] : []),
  ];

  return (
    <div className="wrap flow">
      <form method="post" className="flow-main" noValidate onSubmit={onSubmit}>
        <div className="flow-top">
          <p className="cap">{`${dish.course} · ${dish.name}`}</p>
          <p className="detail">
            <KeepWhole text={dish.detail} />
          </p>
          <h1 className="h1">{PITCH.heading}</h1>
          <p className="lead intro">{dish.line}</p>
          {notices.away && (
            <p className="notice" role="note">
              <KeepWhole text={notices.away} />
            </p>
          )}
          <ErrorSummary errors={errors} ref={summaryRef} />
        </div>
        <Field
          multiline
          id={FIELD_IDS.idea}
          name="pitchIdea"
          label={FLOW.pitchIdeaLabel}
          hint={FLOW.pitchIdeaHint}
          required
          maxLength={2000}
          value={idea}
          error={errorFor(errors, 'idea')?.inline ?? null}
          onChange={(e) => {
            setIdea(e.currentTarget.value);
            if (e.currentTarget.value.trim()) setErrors((x) => withoutError(x, 'idea'));
          }}
        />
        {dish.suggestions.length > 0 && (
          <div role="group" aria-labelledby="try-l" style={{ marginTop: 'var(--s3)' }}>
            {dish.suggestionsLead && <p className="lead">{dish.suggestionsLead}</p>}
            <p className="cap" id="try-l">
              {PITCH.try}
            </p>
            <ul>
              {dish.suggestions.map((s) => (
                <li key={s}>
                  <button type="button" className="textbtn" onClick={() => onStarter(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field
          id={FIELD_IDS.when}
          name="windowText"
          label={FLOW.pitchWhenLabel}
          hint={FLOW.pitchWhenHint}
          required
          maxLength={200}
          value={when}
          error={errorFor(errors, 'when')?.inline ?? null}
          onChange={(e) => {
            setWhen(e.currentTarget.value);
            if (e.currentTarget.value.trim()) setErrors((x) => withoutError(x, 'when'));
          }}
        />
        {dish.overnightAllowed && (
          <label className="check" style={{ marginTop: 'var(--s3)' }}>
            <input
              type="checkbox"
              name="overnight"
              checked={overnight}
              onChange={(e) => setOvernight(e.currentTarget.checked)}
            />
            <span>{DATES.oneNight}</span>
          </label>
        )}
        {overnight && (
          <Field
            id={FIELD_IDS.night}
            name="overnightNight"
            label={FLOW.overnightTitle}
            hint={FLOW.overnightHint}
            maxLength={60}
            value={night}
            onChange={(e) => setNight(e.currentTarget.value)}
          />
        )}
        <DetailsFields s={s} errors={errors} onFixed={(k) => setErrors((x) => withoutError(x, k))} />
        <p className="send">
          <Button variant="commit" type="submit" busy={s.sending ? FLOW_UI.sending : undefined}>
            {FLOW.send}
          </Button>
        </p>
        <SendFailed s={s} />
      </form>
      <PicksRail dish={dish} heading={PITCH.yourPitch} items={railItems} />
    </div>
  );
}
