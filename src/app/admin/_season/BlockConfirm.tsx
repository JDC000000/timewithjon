'use client';
// src/app/admin/_season/BlockConfirm.tsx — T2.5.U1: the wf09 state-block ask (ruling Q3), shared by the A4b week pane
// and the A4c away pane. Names each locked booking, says what they get (E5b, no times), and the bookings under way it
// leaves to finish (T2.5.05). Arriving lands on its title (FOC-04, through @/ui/focus).
import { useRef } from 'react';
import { BLOCK, underWayLine } from '@/content/ui/admin-season';
import { Button, KeepWhole, TextButton } from '@/ui';
import { useLandingFocus } from '@/ui/focus';
import type { Affected } from './api';

export function BlockConfirm({
  id,
  affected,
  underWay,
  when,
  busy,
  onConfirm,
  onKeep,
}: {
  id: string;
  affected: Affected[];
  underWay: Affected[];
  /** "Thu May 13 · noon–2 pm": how the pane names a booking's time */
  when: (b: Affected) => string;
  busy: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const head = useRef<HTMLHeadingElement>(null);
  useLandingFocus(head, []);
  const under = underWayLine(underWay.length);
  const lines = affected.map((b) => BLOCK.lockedFor(when(b), b.contactName)).join(' ');
  return (
    <div role="group" aria-labelledby={`${id}-h`} style={{ paddingBlock: 'var(--s4)' }}>
      <h3 className="h2" id={`${id}-h`} tabIndex={-1} ref={head}>
        {BLOCK.title}
      </h3>
      <p className="ui" style={{ marginTop: 'var(--s2)' }}>
        <KeepWhole text={`${lines} ${BLOCK.tell}`} />
      </p>
      {under ? (
        <p className="ui muted" style={{ marginTop: 'var(--s2)' }}>
          {under}
        </p>
      ) : null}
      <p className="send">
        <Button variant="commit" disabled={busy} onClick={onConfirm}>
          {BLOCK.confirm(affected.map((b) => b.contactName))}
        </Button>
        <TextButton onClick={onKeep}>{BLOCK.keep}</TextButton>
      </p>
    </div>
  );
}
