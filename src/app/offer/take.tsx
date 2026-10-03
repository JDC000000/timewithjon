'use client';
// src/app/offer/take.tsx — T2.4.U2 S18's one POST: the guest picks one offered time and taps Send, which POSTs
// /api/offer/take with the single-use token in the BODY (TakeBody: { token, slotId | rangeIndex, hp }), never the
// URL, with a strict-origin referrer (the Origin check passes, no Referer carries ?t=). Nothing happens on GET.
// 200 → the request's line ("You're locked in for …"), then the page re-reads its server model. 409 offer_gone →
// "Looks like that one went. I'll send you more." with only the times still open (T2.4 AC4).
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ERRORS, FLOW } from '@/content';
import { MANAGE_UI } from '@/content/manage';
import { STORY_FORM } from '@/content/ui/guest-after';
import { Button } from '@/ui';

export interface Choice {
  key: string;
  label: string;
  startsAt: string;
  pick: { slotId: string } | { rangeIndex: number };
}

interface Answer {
  ok?: boolean;
  message?: string | null;
  windows?: { startsAt: string }[];
}

export async function postJson(url: string, body: unknown): Promise<Answer> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      referrerPolicy: 'strict-origin',
    });
    return ((await res.json().catch(() => null)) as Answer | null) ?? {};
  } catch {
    return {};
  }
}

export function TakeOffer({ token, choices }: { token: string; choices: Choice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(choices);
  const [picked, setPicked] = useState(choices.length === 1 ? choices[0]!.key : '');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const choice = open.find((c) => c.key === picked);
    if (!choice) return setFailed(ERRORS.noTimes);
    setBusy(true);
    setFailed(null);
    const json = await postJson('/api/offer/take', { token, ...choice.pick, hp: '' });
    setBusy(false);
    if (json.ok) {
      if (json.message) setSaid(json.message);
      return router.refresh();
    }
    if (json.windows) {
      const still = new Set(json.windows.map((w) => new Date(w.startsAt).toISOString()));
      setOpen(open.filter((c) => still.has(c.startsAt)));
      setPicked('');
    }
    setFailed(json.message ?? ERRORS.generic);
  }

  if (said)
    return (
      <p className="lead intro s18-line" role="status">
        {said}
      </p>
    );
  return (
    <form className="flow-main s18-take" noValidate onSubmit={onSubmit}>
      {failed && (
        <p className="ui s18-line" role="alert">
          {failed}
        </p>
      )}
      {open.length > 0 && (
        <>
          <fieldset className="s18-times">
            <legend className="cap muted">{MANAGE_UI.when}</legend>
            {open.map((c) => (
              <label key={c.key} className="check s18-time">
                <input
                  type="radio"
                  name="time"
                  value={c.key}
                  checked={picked === c.key}
                  onChange={() => {
                    setPicked(c.key);
                    setFailed(null);
                  }}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </fieldset>
          <p className="send">
            <Button type="submit" variant="commit" busy={busy ? STORY_FORM.sending : undefined}>
              {FLOW.send}
            </Button>
          </p>
        </>
      )}
    </form>
  );
}
