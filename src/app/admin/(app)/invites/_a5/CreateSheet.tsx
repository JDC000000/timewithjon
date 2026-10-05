'use client';
// src/app/admin/(app)/invites/_a5/CreateSheet.tsx — T2.6.U1: A5c "New link" (wireframe 09 A5c). Name, the dish, an
// optional pre-filled email and the hoped-for flag, over a live preview that IS the S2 hero (PersonalHero fed by
// landingModel). Jon (2026-10-05): the hero line is the same for everyone, so there are no "our things" boxes. Saves
// through POST /api/admin/invites; the server's refusals land on their boxes. No AI suggestions anywhere.
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { SHEETS } from '@/content/ui/admin-requests';
import { PersonalHero } from '@/app/_landing/PersonalHero';
import { ErrorSummary, type Problem } from '@/app/admin/_requests/ErrorSummary';
import { Button, Field, Sheet } from '@/ui';
import { createInvite } from './api';
import { A5 } from './copy';
import {
  createBody,
  createErrors,
  previewModel,
  serverErrors,
  NAME_MAX,
  type CreateField,
  type DishOption,
} from './model';

const SHEET_ID = 'new-link';
const FORM_ID = `${SHEET_ID}-form`;
const fieldId = (k: CreateField) => `nl-${k}`;
const ORDER: CreateField[] = ['name', 'dish', 'email'];

export function CreateSheet({ dishes, onMade }: { dishes: DishOption[]; onMade: (line: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [dish, setDish] = useState('');
  const [email, setEmail] = useState('');
  const [hopedFor, setHopedFor] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<CreateField, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const form = { name, dish, email, hopedFor };
  const model = useMemo(
    () => previewModel({ name, dish, email: '', hopedFor: true }, dishes),
    [name, dish, dishes],
  );
  const picked = dishes.find((d) => d.slug === dish) ?? null;

  const reset = () => {
    setName('');
    setDish('');
    setEmail('');
    setHopedFor(true);
    setErrors({});
    setProblem(null);
    setAttempt(0);
  };
  const fix = (k: CreateField) =>
    setErrors((e) => {
      if (!e[k]) return e;
      const rest = { ...e };
      delete rest[k];
      return rest;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found = createErrors(form);
    setErrors(found);
    setProblem(null);
    if (ORDER.some((k) => found[k])) {
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    const res = await createInvite(createBody(form));
    setBusy(false);
    if (!res.ok) {
      const onBoxes = serverErrors(res.issues);
      setErrors(onBoxes);
      if (!ORDER.some((k) => onBoxes[k])) setProblem(A5.failed);
      setAttempt((n) => n + 1);
      return;
    }
    reset();
    setOpen(false);
    onMade(A5.made(res.name || name.trim()));
    router.refresh();
  };

  const problems: Problem[] = [
    ...ORDER.flatMap((k) => (errors[k] ? [{ fieldId: fieldId(k), message: errors[k]! }] : [])),
    ...(problem ? [{ message: problem }] : []),
  ];

  return (
    <>
      <Button aria-haspopup="dialog" aria-controls={SHEET_ID} onClick={() => setOpen(true)}>
        {A5.newLink}
      </Button>
      <Sheet
        id={SHEET_ID}
        open={open}
        onClose={() => setOpen(false)}
        title={A5.sheetTitle}
        closeLabel={SHEETS.close(A5.sheetTitle)}
        footer={
          <Button variant="commit" block type="submit" form={FORM_ID} busy={busy ? A5.saving : undefined}>
            {A5.save}
          </Button>
        }
      >
        <form method="post" id={FORM_ID} noValidate onSubmit={submit}>
          <ErrorSummary problems={problems} attempt={attempt} />
          <div className="a5-preview" data-testid="a5-preview">
            <p className="cap muted">{A5.willSee(name.trim())}</p>
            {/* aria-hidden: a picture of what the guest sees; the boxes below are the real controls. */}
            <div className="a5-preview-in" aria-hidden="true" inert>
              <PersonalHero model={model} dish={picked} gate={{ kind: 'book' }} />
            </div>
          </div>
          <Field
            id={fieldId('name')}
            label={A5.name}
            help={A5.nameHelp}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              fix('name');
            }}
            error={errors.name}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            maxLength={NAME_MAX}
          />
          <div className={errors.dish ? 'field bad' : 'field'}>
            <label htmlFor={fieldId('dish')}>{A5.dish}</label>
            <select
              id={fieldId('dish')}
              className="input"
              value={dish}
              aria-describedby={`${fieldId('dish')}-e`}
              aria-invalid={errors.dish ? true : undefined}
              onChange={(e) => {
                setDish(e.target.value);
                fix('dish');
              }}
            >
              <option value="">{A5.noDish}</option>
              {dishes.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
            <p className="err" id={`${fieldId('dish')}-e`} hidden={!errors.dish}>
              {errors.dish}
            </p>
          </div>
          <Field
            id={fieldId('email')}
            label={A5.email}
            help={A5.emailHelp}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              fix('email');
            }}
            error={errors.email}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <label className="check" style={{ marginTop: 'var(--s3)' }}>
            <input type="checkbox" checked={hopedFor} onChange={(e) => setHopedFor(e.target.checked)} />
            <span>{A5.hopedFor}</span>
          </label>
        </form>
      </Sheet>
    </>
  );
}
