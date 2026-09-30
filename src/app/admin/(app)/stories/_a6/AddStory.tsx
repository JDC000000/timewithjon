'use client';
// src/app/admin/(app)/stories/_a6/AddStory.tsx — T3.7.U1: A6 "Add emailed story" (wireframe 09 A6): the sheet with
// From (name), Their email, The story, up to 5 photos and "They said yes in email". Saves through T3.7.02 (sends
// nothing), then each photo through T3.7.03's sign -> upload -> finalise. FOC-04: on success the page moves to the
// new story, whose heading takes focus; a send with problems lands on the pack's "Things to fix" box (via @/ui/focus).
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { ERRORS } from '@/content';
import { ADD_STORY, STORIES } from '@/content/ui/admin-season';
import { SHEETS } from '@/content/ui/admin-requests';
import { Button, Field, FieldGroup, Sheet } from '@/ui';
import { addEmailedStory, uploadPhoto } from './api';
import { emailedStoryErrors, type EmailedStoryField } from './model';
import { ADDED_PARAM, storyPath } from './paths';
import { ErrorSummary, type Problem } from '@/app/admin/_requests/ErrorSummary';

const SHEET_ID = 'add-story';
const FORM_ID = `${SHEET_ID}-form`;
const ids: Record<EmailedStoryField, string> = {
  name: 'as-name',
  email: 'as-email',
  story: 'as-story',
  photos: 'as-photos',
};
const ORDER: EmailedStoryField[] = ['name', 'email', 'story', 'photos'];

export function AddStory() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [story, setStory] = useState('');
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Partial<Record<EmailedStoryField, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  /**
   * One key per story payload being added: kept across retries of the same payload (pr82-review F5); a new one when
   * the payload changes, the sheet closes, the server answers 409 or the story is added (pr83-review M1).
   */
  const idempotency = useRef<{ key: string; payload: string } | null>(null);

  const reset = () => {
    idempotency.current = null;
    setName('');
    setEmail('');
    setStory('');
    setConsent(false);
    setFiles([]);
    setErrors({});
    setProblem(null);
    setAttempt(0);
  };
  /** A field's error clears as soon as Jon edits it (the summary follows). */
  const fix = (k: EmailedStoryField) =>
    setErrors((e) => {
      if (!e[k]) return e;
      const rest = { ...e };
      delete rest[k];
      return rest;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found = emailedStoryErrors({ name, email, story, photos: files.length });
    setErrors(found);
    setProblem(null);
    if (ORDER.some((k) => found[k])) {
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    const payload = { fromName: name.trim(), fromEmail: email.trim(), body: story.trim(), consent };
    const signature = JSON.stringify(payload);
    if (idempotency.current?.payload !== signature)
      idempotency.current = { key: crypto.randomUUID(), payload: signature };
    const { id, status } = await addEmailedStory(payload, idempotency.current.key);
    if (!id) {
      if (status === 409) idempotency.current = null;
      setBusy(false);
      setProblem(ERRORS.generic);
      setAttempt((n) => n + 1);
      return;
    }
    let failed = 0;
    for (const f of files) if ((await uploadPhoto(id, f)) === 'failed') failed++;
    setBusy(false);
    reset();
    setOpen(false);
    router.push(`${storyPath(id)}?${ADDED_PARAM}=${failed}`);
  };

  const problems: Problem[] = [
    ...ORDER.flatMap((k) => {
      const message = errors[k];
      return message ? [{ fieldId: k === 'photos' ? `${ids.photos}-btn` : ids[k], message }] : [];
    }),
    ...(problem ? [{ message: problem }] : []),
  ];

  return (
    <>
      <Button aria-haspopup="dialog" aria-controls={SHEET_ID} onClick={() => setOpen(true)}>
        {STORIES.add}
      </Button>
      <Sheet
        id={SHEET_ID}
        open={open}
        onClose={() => {
          idempotency.current = null;
          setOpen(false);
        }}
        title={STORIES.add}
        closeLabel={SHEETS.close(STORIES.add)}
        footer={
          <Button
            variant="commit"
            block
            type="submit"
            form={FORM_ID}
            busy={busy ? ADD_STORY.busy : undefined}
          >
            {ADD_STORY.submit}
          </Button>
        }
      >
        <form id={FORM_ID} noValidate onSubmit={submit}>
          <ErrorSummary problems={problems} attempt={attempt} />
          <Field
            id={ids.name}
            label={ADD_STORY.name}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              fix('name');
            }}
            error={errors.name}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            maxLength={80}
          />
          <Field
            id={ids.email}
            label={ADD_STORY.email}
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
            enterKeyHint="next"
          />
          <Field
            id={ids.story}
            label={ADD_STORY.story}
            help={ADD_STORY.storyHelp}
            multiline
            value={story}
            onChange={(e) => {
              setStory(e.target.value);
              fix('story');
            }}
            error={errors.story}
            autoCapitalize="sentences"
            maxLength={5000}
          />
          <FieldGroup id={ids.photos} label={ADD_STORY.photos}>
            {({ labelId }) => (
              <>
                <input
                  ref={picker}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    setFiles(Array.from(e.target.files ?? []));
                    fix('photos');
                  }}
                />
                <div style={{ marginTop: 'var(--s2)' }}>
                  <Button
                    id={`${ids.photos}-btn`}
                    aria-describedby={`${labelId} ${ids.photos}-n ${ids.photos}-e`}
                    onClick={() => picker.current?.click()}
                  >
                    {ADD_STORY.addPhotos}
                  </Button>
                </div>
                <p className="help" id={`${ids.photos}-n`} style={{ marginTop: 'var(--s1)' }}>
                  {files.length > 0 ? ADD_STORY.picked(files.length) : null}
                </p>
                <p className="err" id={`${ids.photos}-e`} hidden={!errors.photos}>
                  {errors.photos}
                </p>
              </>
            )}
          </FieldGroup>
          <label className="check" style={{ marginTop: 'var(--s3)' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{ADD_STORY.consent}</span>
          </label>
        </form>
      </Sheet>
    </>
  );
}
