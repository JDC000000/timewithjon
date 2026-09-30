'use client';
// src/app/admin/_requests/NoteField.tsx — T2.8.U1: one autosaving note on A3 (Before 60, or Jon's own note),
// PATCH /api/admin/requests/[id] with only its own field, so the two never overwrite each other (T2.8.01).
// The status line is polite: "Saving…" / "Saved 7:42 pm" / "Couldn't save." + Try again (wireframe 09 A3k/A3k2).
import { useEffect, useRef, useState } from 'react';
import { Field, TextButton } from '@/ui';
import { NOTES } from '@/content/ui/admin-requests';
import { send } from './api';
import { createAutosaver, type SaveState } from './autosave';
import { clockLabel } from './format';

export function NoteField({
  requestId,
  field,
  id,
  label,
  help,
  initial,
}: {
  requestId: string;
  field: 'before60Note' | 'jonNote';
  id: string;
  label: string;
  help: string;
  initial: string;
}) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const saver = useRef<ReturnType<typeof createAutosaver> | null>(null);

  useEffect(() => {
    const s = createAutosaver({
      initial,
      onState: setState,
      save: async (value) =>
        (await send('PATCH', `/api/admin/requests/${requestId}`, { [field]: value }, { keepalive: true }))
          .status === 200,
    });
    saver.current = s;
    // Closing the tab or leaving the site unmounts nothing: save the pending edit on pagehide too (F3).
    const leave = () => s.flush();
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      s.dispose();
    };
    // One saver per request and field; `initial` only seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, field]);

  const status =
    state.kind === 'saving'
      ? NOTES.saving
      : state.kind === 'saved'
        ? NOTES.saved(clockLabel(state.at))
        : state.kind === 'failed'
          ? NOTES.failed
          : '';

  return (
    <>
      <Field
        id={id}
        label={label}
        help={help}
        multiline
        autoCapitalize="sentences"
        value={text}
        maxLength={2000}
        onChange={(e) => {
          setText(e.currentTarget.value);
          saver.current?.change(e.currentTarget.value);
        }}
        onBlur={() => saver.current?.flush()}
      />
      <p className="help" role="status" style={{ marginTop: 'var(--s1)' }}>
        {status}
      </p>
      {state.kind === 'failed' ? (
        <p>
          <TextButton onClick={() => saver.current?.retry()}>{NOTES.retry}</TextButton>
        </p>
      ) : null}
    </>
  );
}
