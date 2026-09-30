'use client';
// src/app/admin/_requests/SpamActions.tsx — A2b/A2c Check these (T2.9.04 APIs): "Not spam" (the fill) moves it to
// Needs a reply and sends Jon's E2; "Delete" (text) asks in place first ("Delete it for good?"), then deletes the
// spam request. Focus lands on the question, returns to Delete on "Keep it"; a status says what happened.
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ERRORS } from '@/content';
import { Button, TextButton } from '@/ui';
import { announce, moveFocus } from '@/ui/focus';
import { CHECK } from '@/content/ui/admin-requests';
import { send } from './api';

export function SpamActions({ requestId, who }: { requestId: string; who: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const question = useRef<HTMLParagraphElement>(null);
  const deleteButton = useRef<HTMLSpanElement>(null);

  const act = async (method: 'POST' | 'DELETE', url: string, done: () => void) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const res = await send(method, url);
    setBusy(false);
    if (res.status === 200) return done();
    setProblem(ERRORS.generic);
  };

  const notSpam = () =>
    act('POST', `/api/admin/requests/${requestId}/not-spam`, () => {
      announce(CHECK.movedToNeeds(who));
      router.refresh(); // the page re-reads it as an ordinary request in Needs a reply
    });
  const remove = () =>
    act('DELETE', `/api/admin/requests/${requestId}/spam`, () => {
      announce(CHECK.deleted(who));
      router.push('/admin?check=1');
      router.refresh();
    });

  const ask = () => {
    setConfirming(true);
    requestAnimationFrame(() => moveFocus(question.current, 'script'));
  };
  const keep = () => {
    setConfirming(false);
    requestAnimationFrame(() => moveFocus(deleteButton.current?.querySelector('button') ?? null, 'script'));
  };

  return (
    <>
      {problem ? (
        <p className="notice" role="alert">
          {problem}
        </p>
      ) : null}
      {confirming ? (
        <>
          <p
            className="ui"
            tabIndex={-1}
            ref={question}
            style={{ marginTop: 'var(--s6)', color: 'var(--c-ink)' }}
          >
            {CHECK.confirm}
          </p>
          <p className="send">
            <Button variant="commit" onClick={remove} busy={busy ? CHECK.deleteIt : undefined}>
              {CHECK.deleteIt}
            </Button>{' '}
            <TextButton onClick={keep}>{CHECK.keepIt}</TextButton>
          </p>
        </>
      ) : (
        <p className="send">
          <Button variant="commit" onClick={notSpam} disabled={busy}>
            {CHECK.notSpam}
          </Button>{' '}
          <span ref={deleteButton}>
            <TextButton onClick={ask}>{CHECK.delete}</TextButton>
          </span>
        </p>
      )}
    </>
  );
}
