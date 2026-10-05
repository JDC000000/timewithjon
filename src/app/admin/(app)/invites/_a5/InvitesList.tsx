'use client';
// src/app/admin/(app)/invites/_a5/InvitesList.tsx — T2.6.U1: the A5 list (wireframe 09 A5). The general link on top
// with Rotate, then every personal link: its link, open count and request status, Copy link / Copy text, and Revoke,
// which asks in place (plan.md Carried 9: the row turns into the question, no dialog). A revoked or rotated link
// shows S16 on its next request (the invite session reads revoked_at).
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import type { InviteListItem } from '@/features/admin/invites';
import { Button, TextButton } from '@/ui';
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

function CopyButtons({ item, onCopied }: { item: InviteListItem; onCopied: (line: string) => void }) {
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
      <TextButton onClick={() => copy(item.link)}>{A5.copyLink}</TextButton>
      <TextButton onClick={() => copy(item.text)}>{A5.copyText}</TextButton>
    </>
  );
}

/** Revoke / Rotate: the button becomes the question and its two answers, in place (Carried 9). */
function Confirm({
  label,
  question,
  yes,
  run,
  testId,
}: {
  label: string;
  question: string;
  yes: string;
  run: () => Promise<boolean>;
  testId: string;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!asking)
    return (
      <TextButton onClick={() => setAsking(true)} data-testid={testId}>
        {label}
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
            if (ok) setAsking(false);
          }}
        >
          {yes}
        </Button>
        <TextButton autoFocus onClick={() => setAsking(false)}>
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
              <CopyButtons item={general} onCopied={setStatus} />
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
                <span className="who">{who}</span>
                <span className="vh">, </span>
                <Meta parts={inviteMeta(i)} />
                <p className="ui a5-link">{i.link.replace(/^https?:\/\//, '')}</p>
                {i.revoked ? null : (
                  <div className="a5-actions">
                    <CopyButtons item={i} onCopied={setStatus} />
                    <Confirm
                      label={A5.revoke}
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
