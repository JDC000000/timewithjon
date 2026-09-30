'use client';
// src/app/admin/(app)/stories/_a6/SpamActions.tsx — T2.9.U1 (orchestrator ruling Q3): A6 on a spam-suspect story gets
// A2b's answers with A2b's words and confirm step (wireframe 09 A2b/A2c; the markup of _requests/SpamActions.tsx):
// "Not spam" (the fill) makes it an ordinary story, whose "OK for the book" box then takes focus; "Delete" (text)
// asks in place first, then deletes it and goes back to the list. Both are idempotent (spamOutcome); a refusal
// (e.g. a story with photos can't be deleted yet) leaves Not spam on screen, so a false positive is never stuck.
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ERRORS } from '@/content';
import { CHECK } from '@/content/ui/admin-requests';
import { Button, TextButton } from '@/ui';
import { moveFocus } from '@/ui/focus';
import { storySpam } from './api';
import { spamOutcome } from './model';
import { CLEARED_PARAM, STORIES_PATH, storyPath } from './paths';

export function SpamActions({ storyId }: { storyId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const question = useRef<HTMLParagraphElement>(null);
  const deleteButton = useRef<HTMLSpanElement>(null);
  /**
   * Where focus goes once the step it lands on has rendered. Moved in an effect after React commits, never in a
   * requestAnimationFrame: a frame can fire before the commit, find no element and leave focus on <body>.
   */
  const focusNext = useRef<'question' | 'delete' | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    const el =
      target === 'question'
        ? question.current
        : target === 'delete'
          ? deleteButton.current?.querySelector('button')
          : null;
    if (!el) return;
    focusNext.current = null;
    moveFocus(el, 'script');
  }, [confirming, problem]);

  const act = async (action: 'not-spam' | 'delete') => {
    if (busy) return;
    setBusy(true);
    setProblem(false);
    const outcome = spamOutcome(action, await storySpam(storyId, action));
    setBusy(false);
    if (outcome === 'cleared') {
      router.replace(`${storyPath(storyId)}?${CLEARED_PARAM}=1`);
      router.refresh();
    } else if (outcome === 'gone') {
      router.push(STORIES_PATH);
      router.refresh();
    } else {
      focusNext.current = 'delete';
      setProblem(true);
      setConfirming(false);
    }
  };

  const ask = () => {
    focusNext.current = 'question';
    setConfirming(true);
  };
  const keep = () => {
    focusNext.current = 'delete';
    setConfirming(false);
  };

  return (
    <>
      {problem ? (
        <p className="notice" role="alert">
          {ERRORS.generic}
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
            <Button
              variant="commit"
              onClick={() => void act('delete')}
              busy={busy ? CHECK.deleteIt : undefined}
            >
              {CHECK.deleteIt}
            </Button>{' '}
            <TextButton onClick={keep}>{CHECK.keepIt}</TextButton>
          </p>
        </>
      ) : (
        <p className="send">
          <Button variant="commit" onClick={() => void act('not-spam')} disabled={busy}>
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
