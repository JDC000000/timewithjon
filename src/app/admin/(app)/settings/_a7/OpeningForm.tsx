'use client';
// src/app/admin/(app)/settings/_a7/OpeningForm.tsx — T2.9.U1: A7b Opening times (wireframe 09 A7b): when personal
// links open and when the general link opens, each a Vancouver date + an hour. Save sends only what moved (T2.9.02
// refuses personal after general, or a time outside now..season end). A slip lands focus on the field to fix; a
// save keeps focus on Save and says "Saved." (FOC-04 via @/ui/focus).
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { OPENING, SETTINGS } from '@/content/ui/admin-season';
import { Button, FieldGroup } from '@/ui';
import { announce, moveFocus } from '@/ui/focus';
import { saveSettings } from './api';
import {
  openingPatch,
  openingRefusal,
  splitRelease,
  timeChoices,
  timeLabel,
  type OpeningField,
  type ReleaseForm,
} from './model';

const FIELDS: { key: OpeningField; label: string }[] = [
  { key: 'personal', label: OPENING.personal },
  { key: 'general', label: OPENING.general },
];
const dateId = (k: OpeningField) => `op-${k}-date`;

export function OpeningForm({ saved }: { saved: { personalOpenAt: string; generalOpenAt: string } }) {
  const router = useRouter();
  const p = splitRelease(saved.personalOpenAt);
  const g = splitRelease(saved.generalOpenAt);
  const [form, setForm] = useState<ReleaseForm>({
    personalDate: p.date,
    personalTime: p.time,
    generalDate: g.date,
    generalTime: g.time,
  });
  const [errors, setErrors] = useState<Partial<Record<OpeningField, string>>>({});
  const [status, setStatus] = useState<{ ok: boolean; line: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof ReleaseForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const say = (ok: boolean, line: string) => {
    setStatus({ ok, line });
    announce(line);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErrors({});
    setStatus(null);
    const built = openingPatch(saved, form);
    if ('bad' in built) {
      setErrors({ [built.bad]: OPENING.errDate });
      moveFocus(document.getElementById(dateId(built.bad)));
      return;
    }
    if (Object.keys(built.patch).length === 0) return say(true, SETTINGS.nothingChanged);
    setBusy(true);
    const res = await saveSettings(built.patch);
    setBusy(false);
    if (res.ok) {
      say(true, SETTINGS.saved);
      router.refresh();
      return;
    }
    const refusal = openingRefusal(res.code);
    if (refusal.field) {
      setErrors({ [refusal.field]: refusal.message });
      moveFocus(document.getElementById(dateId(refusal.field)));
    } else {
      say(false, refusal.message);
    }
  };

  return (
    <form noValidate onSubmit={submit}>
      {FIELDS.map(({ key, label }) => {
        const date = key === 'personal' ? 'personalDate' : 'generalDate';
        const time = key === 'personal' ? 'personalTime' : 'generalTime';
        const errId = `op-${key}-e`;
        return (
          <FieldGroup
            key={key}
            id={`op-${key}`}
            label={label}
            hint={OPENING.tz}
            className={errors[key] ? 'bad' : undefined}
          >
            {({ labelId, hintId }) => (
              <>
                <div
                  role="group"
                  aria-labelledby={[labelId, hintId].filter(Boolean).join(' ')}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}
                >
                  <input
                    id={dateId(key)}
                    type="date"
                    className="input"
                    style={{ flex: '1 1 10em', width: 'auto' }}
                    aria-label={OPENING.date(label)}
                    aria-describedby={errId}
                    aria-invalid={errors[key] ? true : undefined}
                    value={form[date]}
                    onChange={(e) => set(date, e.target.value)}
                  />
                  <select
                    className="input"
                    style={{ flex: '1 1 7em', width: 'auto' }}
                    aria-label={OPENING.time(label)}
                    value={form[time]}
                    onChange={(e) => set(time, e.target.value)}
                  >
                    {timeChoices(form[time]).map((t) => (
                      <option key={t} value={t}>
                        {timeLabel(t)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="err" id={errId} hidden={!errors[key]}>
                  {errors[key]}
                </p>
              </>
            )}
          </FieldGroup>
        );
      })}
      <div style={{ marginTop: 'var(--s5)' }}>
        <Button
          variant="commit"
          type="submit"
          busy={busy ? SETTINGS.saving : undefined}
          aria-describedby="op-status"
        >
          {SETTINGS.save}
        </Button>
        <p
          id="op-status"
          className={status && !status.ok ? 'err' : 'help'}
          style={{ marginTop: 'var(--s2)' }}
        >
          {status?.line}
        </p>
      </div>
    </form>
  );
}
