'use client';
// src/app/admin/(app)/requests/_check/CheckActions.tsx — T2.9.U2: A2b/A2c Check these answers on a spam-suspect
// request (wireframe 09 A2b/A2c, n15; T2.9.04 routes). Rendered only for a spam suspect (DetailPane: view.spam), so
// Delete is never offered on a real request; the server refuses one anyway (409 not_spam_suspect, AC4).
//   Not spam (the fill): at once the buttons give way to "{who} is in Needs a reply now." (optimistic); the route
//     moves it to Needs a reply and sends E2; on success the page re-reads it as an ordinary request.
//   Delete (text): asks in place (A2c). "Delete it": at once the pane says what went and the row leaves the list
//     (optimistic); on success, back to Check these with focus on the next row (or the list caption).
//   A failure rolls back: the buttons return, an alert says so, and focus lands on the button that was used.
// Keyboard: Esc on the question is "Keep it". Focus moves in an effect after React commits (pr83), never a frame.
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { ERRORS } from '@/content';
import { CHECK } from '@/content/ui/admin-requests';
import { Button, TextButton } from '@/ui';
import { announce, moveFocus } from '@/ui/focus';
import { send } from '@/app/admin/_requests/api';
import { checkOutcome, checkUrl, type CheckAction } from './model';
import { nextRowHref, setLanding } from './landing';

type Phase = 'idle' | 'confirming' | 'moved' | 'deleted';
type Target = 'question' | 'notSpam' | 'delete' | 'status' | null;

/** The row of this request in the list pane (1024+ shows it beside the detail). */
const currentRow = (requestId: string) =>
  document.querySelector(`a[href="/admin/requests/${requestId}"]`)?.closest('li') ?? null;

export function CheckActions({ requestId, who }: { requestId: string; who: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [problem, setProblem] = useState(false);
  const inFlight = useRef(false);
  const questionId = useId();
  const questionRef = useRef<HTMLParagraphElement>(null);
  const notSpamRef = useRef<HTMLSpanElement>(null);
  const deleteRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusNext = useRef<Target>(null);
  useEffect(() => {
    const t = focusNext.current;
    const el =
      t === 'question'
        ? questionRef.current
        : t === 'status'
          ? statusRef.current
          : (t === 'notSpam' ? notSpamRef : deleteRef).current?.querySelector('button');
    if (!t || !el) return;
    focusNext.current = null;
    moveFocus(el, 'script');
  }, [phase, problem]);

  const go = (next: Phase, target: Target) => {
    focusNext.current = target;
    setPhase(next);
  };

  const answer = async (action: CheckAction) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setProblem(false);
    const row = action === 'delete' ? currentRow(requestId) : null;
    const landing = action === 'delete' ? nextRowHref() : null;
    // optimistic: the screen shows the result before the server answers
    go(action === 'delete' ? 'deleted' : 'moved', 'status');
    if (row) row.hidden = true;
    const { method, url } = checkUrl(action, requestId);
    const outcome = checkOutcome(action, await send(method, url));
    inFlight.current = false;
    if (outcome === 'rollback') {
      if (row) row.hidden = false;
      focusNext.current = action === 'delete' ? 'delete' : 'notSpam';
      setProblem(true);
      setPhase('idle');
      return;
    }
    if (action === 'not-spam') {
      announce(CHECK.movedToNeeds(who));
      router.refresh(); // the page re-reads it as an ordinary request in Needs a reply
    } else {
      announce(CHECK.deleted(who));
      setLanding(landing);
      router.push('/admin?check=1');
      router.refresh();
    }
  };

  const keep = () => go('idle', 'delete');

  if (phase === 'moved' || phase === 'deleted') {
    return (
      <p className="ui check-status" tabIndex={-1} ref={statusRef}>
        {phase === 'moved' ? CHECK.movedToNeeds(who) : CHECK.deleted(who)}
      </p>
    );
  }

  return (
    <>
      {problem ? (
        <p className="notice" role="alert">
          {ERRORS.generic}
        </p>
      ) : null}
      {phase === 'confirming' ? (
        <div
          role="group"
          aria-labelledby={questionId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              keep();
            }
          }}
        >
          <p id={questionId} className="ui check-question" tabIndex={-1} ref={questionRef}>
            {CHECK.confirm}
          </p>
          <p className="send">
            <Button variant="commit" onClick={() => void answer('delete')}>
              {CHECK.deleteIt}
            </Button>{' '}
            <TextButton onClick={keep}>{CHECK.keepIt}</TextButton>
          </p>
        </div>
      ) : (
        <p className="send" role="group" aria-label={`${CHECK.caption}: ${who}`}>
          <span ref={notSpamRef}>
            <Button variant="commit" onClick={() => void answer('not-spam')}>
              {CHECK.notSpam}
            </Button>
          </span>{' '}
          <span ref={deleteRef}>
            <TextButton onClick={() => go('confirming', 'question')}>{CHECK.delete}</TextButton>
          </span>
        </p>
      )}
    </>
  );
}
