'use client';
// src/app/admin/(app)/settings/_a7/RepliesForm.tsx — T2.9.U1: A7c Replies and stories (wireframe 09 A7c): the reply
// promise guests see after Send, the Before 60 question on/off, and people reached (M9, read only). Save sends only
// what changed (T2.9.02); focus stays on Save and the line under it says what happened.
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ERRORS } from '@/content';
import { REPLIES, SETTINGS } from '@/content/ui/admin-season';
import { Button, FieldGroup, Tick } from '@/ui';
import { announce } from '@/ui/focus';
import { saveSettings } from './api';
import { promiseChoices, repliesPatch } from './model';

export function RepliesForm({
  saved,
  peopleReached,
}: {
  saved: { replyPromiseDays: number; before60Enabled: boolean };
  peopleReached: number;
}) {
  const router = useRouter();
  const [days, setDays] = useState(saved.replyPromiseDays);
  const [before60, setBefore60] = useState(saved.before60Enabled);
  const [status, setStatus] = useState<{ ok: boolean; line: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const say = (ok: boolean, line: string) => {
    setStatus({ ok, line });
    announce(line);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setStatus(null);
    const patch = repliesPatch(saved, { replyPromiseDays: days, before60Enabled: before60 });
    if (Object.keys(patch).length === 0) return say(true, SETTINGS.nothingChanged);
    setBusy(true);
    const res = await saveSettings(patch);
    setBusy(false);
    if (!res.ok) return say(false, ERRORS.generic);
    say(true, SETTINGS.saved);
    router.refresh();
  };

  return (
    <form method="post" noValidate onSubmit={submit}>
      <FieldGroup id="rp-promise" label={REPLIES.promise} hint={REPLIES.promiseHelp}>
        {({ labelId, hintId }) => (
          <div
            className="seg"
            role="radiogroup"
            aria-labelledby={labelId}
            aria-describedby={hintId}
            style={{ marginTop: 'var(--s2)' }}
          >
            {promiseChoices(saved.replyPromiseDays).map((n) => (
              <label key={n}>
                <input type="radio" name="rp-days" checked={days === n} onChange={() => setDays(n)} />
                <Tick />
                {REPLIES.days(n)}
              </label>
            ))}
          </div>
        )}
      </FieldGroup>
      <label className="check" style={{ marginTop: 'var(--s4)' }}>
        <input type="checkbox" checked={before60} onChange={(e) => setBefore60(e.target.checked)} />
        <span>{REPLIES.before60}</span>
      </label>
      <dl className="kv">
        <dt>{REPLIES.reached}</dt>
        <dd className="tnum">{peopleReached}</dd>
      </dl>
      <div style={{ marginTop: 'var(--s5)' }}>
        <Button
          variant="commit"
          type="submit"
          busy={busy ? SETTINGS.saving : undefined}
          aria-describedby="rp-status"
        >
          {SETTINGS.save}
        </Button>
        <p
          id="rp-status"
          className={status && !status.ok ? 'err' : 'help'}
          style={{ marginTop: 'var(--s2)' }}
        >
          {status?.line}
        </p>
      </div>
    </form>
  );
}
