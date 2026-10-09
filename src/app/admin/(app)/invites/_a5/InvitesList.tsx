'use client';
// src/app/admin/(app)/invites/_a5/InvitesList.tsx — T2.6.U1: the A5 list (wireframe 09 A5). The general link on top
// with Rotate, then every personal link: its link, open count and request status, Copy link / Copy text, and Revoke,
// which asks in place (plan.md Carried 9: the row turns into the question, no dialog). A revoked or rotated link
// shows S16 on its next request (the invite session reads revoked_at).
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { InviteListItem } from '@/features/admin/invites';
import { Button, TextButton } from '@/ui';
import { moveFocus } from '@/ui/focus';
import { revokeInvite, rotateGeneral } from './api';
import { A5 } from './copy';
import { CreateSheet } from './CreateSheet';
import { inviteMeta, splitInvites, type DishOption } from './model';

function Meta({ parts }: { parts: string[] }) {
  return (
    <span className="meta">
      {parts.map((m, i) => (
        <Fragment key={m}>
          {i > 0 ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="vh">, </span>
            </>
          ) : null}
          {m}
        </Fragment>
      ))}
    </span>
  );
}

/** QA4 L8: a row action's name carries whose link it is ("Copy link, Dave"); the visible word stays as it is. */
function Whose({ who }: { who: string }) {
  return <span className="vh">, {who}</span>;
}

function CopyButtons({
  item,
  who,
  onCopied,
}: {
  item: InviteListItem;
  who: string;
  onCopied: (line: string) => void;
}) {
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      onCopied(A5.copied);
    } catch {
      onCopied(A5.copyFailed);
    }
  };
  return (
    <>
      <TextButton onClick={() => copy(item.link)}>
        {A5.copyLink}
        <Whose who={who} />
      </TextButton>
      <TextButton onClick={() => copy(item.text)}>
        {A5.copyText}
        <Whose who={who} />
      </TextButton>
    </>
  );
}

/**
 * Revoke / Rotate: the button becomes the question and its two answers, in place (Carried 9). QA4 L8: when the
 * question goes, focus goes back to the button, or after a done Revoke (the row loses its buttons) to `doneFocus`.
 */
function Confirm({
  label,
  who,
  question,
  yes,
  run,
  testId,
  doneFocus,
}: {
  label: string;
  /** Whose link: carried in the button's name (QA4 L8). */
  who?: string;
  question: string;
  yes: string;
  run: () => Promise<boolean>;
  testId: string;
  doneFocus?: () => HTMLElement | null;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const back = useRef<'kept' | 'done' | null>(null);
  const triggerId = useId();
  useEffect(() => {
    if (asking || !back.current) return;
    moveFocus(
      back.current === 'done' && doneFocus ? doneFocus() : document.getElementById(triggerId),
      'script',
    );
    back.current = null;
  }, [asking, doneFocus, triggerId]);
  if (!asking)
    return (
      <TextButton id={triggerId} onClick={() => setAsking(true)} data-testid={testId}>
        {label}
        {who ? <Whose who={who} /> : null}
      </TextButton>
    );
  return (
    <div className="a5-confirm" role="group" aria-label={question}>
      <p className="ui">{question}</p>
      {failed ? <p className="err">{A5.failed}</p> : null}
      <div className="a5-actions">
        <Button
          variant="commit"
          busy={busy ? yes : undefined}
          onClick={async () => {
            setBusy(true);
            const ok = await run();
            setBusy(false);
            setFailed(!ok);
            if (ok) {
              back.current = 'done';
              setAsking(false);
            }
          }}
        >
          {yes}
        </Button>
        <TextButton
          autoFocus
          onClick={() => {
            back.current = 'kept';
            setAsking(false);
          }}
        >
          {A5.keep}
        </TextButton>
      </div>
    </div>
  );
}

export function InvitesList({ invites, dishes }: { invites: InviteListItem[]; dishes: DishOption[] }) {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const { general, rest } = splitInvites(invites);
  const done = (line: string) => (ok: boolean) => {
    if (ok) {
      setStatus(line);
      router.refresh();
    }
    return ok;
  };

  return (
    <>
      <div className="pane-pad">
        <h1 className="h1" tabIndex={-1}>
          {A5.title}
        </h1>
        <p className="cap muted" style={{ marginTop: 'var(--s1)' }}>
          {A5.cap}
        </p>
        <div style={{ marginTop: 'var(--s3)', display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
          <CreateSheet dishes={dishes} onMade={setStatus} />
        </div>
        <p className="ui a5-status" role="status" aria-live="polite">
          {status}
        </p>
      </div>
      <section className="pane-pad a5-general" aria-labelledby="a5-general-h" data-testid="a5-general">
        <h2 className="h3" id="a5-general-h">
          {A5.general}
        </h2>
        {general ? (
          <>
            <p className="ui a5-link">{general.link.replace(/^https?:\/\//, '')}</p>
            <Meta parts={inviteMeta(general)} />
            <div className="a5-actions">
              <CopyButtons item={general} who={A5.general} onCopied={setStatus} />
              <Confirm
                label={A5.rotate}
                question={A5.rotateConfirm}
                yes={A5.rotateYes}
                testId="a5-rotate"
                run={async () => done(A5.rotated)(await rotateGeneral())}
              />
            </div>
          </>
        ) : (
          <>
            <p className="ui muted">{A5.noGeneral}</p>
            <div className="a5-actions">
              <Confirm
                label={A5.rotate}
                question={A5.rotateConfirm}
                yes={A5.rotateYes}
                testId="a5-rotate"
                run={async () => done(A5.rotated)(await rotateGeneral())}
              />
            </div>
          </>
        )}
      </section>
      <h2 className="h3 pane-pad" style={{ marginTop: 'var(--s5)' }}>
        {A5.personal}
      </h2>
      <ul className="rows a5-rows" style={{ marginTop: 'var(--s2)' }}>
        {rest.length === 0 ? (
          <li className="pane-pad ui muted" style={{ paddingBlock: 'var(--s5)' }}>
            {A5.empty}
          </li>
        ) : (
          rest.map((i) => {
            const who = i.name ?? i.slug;
            return (
              <li key={i.id} className="pane-pad a5-row" data-testid={`a5-row-${i.slug}`}>
                {/* QA4 L8: where focus lands after its Revoke (the row stays, without its buttons) */}
                <span className="who" id={`a5-who-${i.id}`} tabIndex={-1}>
                  {who}
                </span>
                <span className="vh">, </span>
                <Meta parts={inviteMeta(i)} />
                <p className="ui a5-link">{i.link.replace(/^https?:\/\//, '')}</p>
                {i.revoked ? null : (
                  <div className="a5-actions">
                    <CopyButtons item={i} who={who} onCopied={setStatus} />
                    <Confirm
                      label={A5.revoke}
                      who={who}
                      doneFocus={() => document.getElementById(`a5-who-${i.id}`)}
                      question={A5.revokeConfirm(who)}
                      yes={A5.revokeYes}
                      testId={`a5-revoke-${i.slug}`}
                      run={async () => done(A5.revoked)(await revokeInvite(i.id))}
                    />
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </>
  );
}
