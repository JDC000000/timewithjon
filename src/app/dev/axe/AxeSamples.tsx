'use client';
// Every primitive in its states (default, disabled, busy, error, open), for axe and for the lanes to look at.
import { useState, useSyncExternalStore } from 'react';
import {
  Button,
  Field,
  FieldGroup,
  List,
  Menu,
  PhotoSlot,
  Sheet,
  SiteHeader,
  Stack,
  TextButton,
  TextLink,
  Toast,
} from '@/ui';

const ROWS = [
  { id: 'a', who: 'Sample one' },
  { id: 'b', who: 'Sample two' },
];

export function AxeSamples() {
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState(false);
  const [note, setNote] = useState('');
  // false in the server HTML, true once hydrated: tests wait for it before any input
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return (
    <>
      <SiteHeader />
      <main id="main" className="wrap">
        <Stack>
          <h1 className="h1">Primitives</h1>
          <p role="status" aria-label="Bench">
            {ready ? 'ready' : 'loading'}
          </p>
          <p className="lead">Every shared component, once.</p>
          <p>
            <Button variant="commit">Commit</Button> <Button>Default</Button>{' '}
            <Button disabled>Disabled</Button> <Button busy="Sending…">Send</Button>{' '}
            <Button size="sm">Small</Button>
          </p>
          <p>
            <Button href="#main" block>
              Link button
            </Button>
          </p>
          <p>
            <TextButton>Text button</TextButton> <TextLink href="#main">Text link</TextLink>
          </p>
          <Field id="ax-name" label="Your name" autoComplete="name" />
          <Field
            id="ax-email"
            label="Your email"
            hint="So I can send the invite."
            type="email"
            error="Check your email."
          />
          <Field
            id="ax-note"
            label="Before 60"
            help="What they said at the table. Saves as you type."
            multiline
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <FieldGroup id="ax-crew" label="Who's coming?" hint="Just you is perfect.">
            {({ labelId, hintId }) => (
              <div className="stepper" role="group" aria-labelledby={labelId} aria-describedby={hintId}>
                <button type="button" aria-label="One fewer">
                  −
                </button>
                <output aria-live="off">Just me</output>
                <button type="button" aria-label="One more">
                  +
                </button>
              </div>
            )}
          </FieldGroup>
          <List
            className="actions"
            items={ROWS}
            getKey={(r) => r.id}
            render={(r) => (
              <li>
                <a href="#main">
                  <span>{r.who}</span>
                  <span aria-hidden="true">›</span>
                </a>
              </li>
            )}
          />
          <PhotoSlot slot="sample" kind="dish" alt="Sample photo" />
          <p>
            <Button aria-haspopup="dialog" onClick={() => setSheet(true)}>
              Open sheet
            </Button>{' '}
            <Menu
              id="ax-menu"
              buttonLabel="More for Sample"
              items={[
                { key: 'go', label: 'Go somewhere', href: '#main' },
                { key: 'do', label: 'Do something', onSelect: () => undefined },
              ]}
            />{' '}
            <Button onClick={() => setToast(true)}>Show toast</Button>
          </p>
        </Stack>
        <Sheet
          id="ax-sheet"
          open={sheet}
          onClose={() => setSheet(false)}
          cap="Sample course"
          title="Sample sheet"
          closeLabel="Close Sample sheet"
          footer={
            <Button block data-close="">
              Cancel
            </Button>
          }
        >
          <p className="lead" style={{ marginTop: 'var(--s4)' }}>
            A sheet with a title, a close button and a foot row.
          </p>
        </Sheet>
        {toast && (
          <Toast
            message="Locked in: Sample, Fri May 14 · noon–2 pm."
            sub={(s) => `Invite goes out in ${s} s.`}
            pausedText="Paused. The invite goes out 10 s after you leave Undo."
            undoLabel="Undo"
            undoVh=" lock-in for Sample"
            onUndo={() => setToast(false)}
            onExpire={() => setToast(false)}
          />
        )}
      </main>
    </>
  );
}
