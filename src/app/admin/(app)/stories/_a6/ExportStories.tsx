'use client';
// src/app/admin/(app)/stories/_a6/ExportStories.tsx — T3.10.U1: A6 "Export" next to "Add emailed story". One press
// builds the stories zip (consented stories only, no emails: the route's defaults) and starts the download: the
// signed link in staging and production, the zip itself in the prototype. While it runs the button reads
// "Exporting…" and is aria-busy; a refusal (one already running, or any error) shows and announces ERRORS.generic.
import { useState } from 'react';
import { ERRORS } from '@/content';
import { STORIES } from '@/content/ui/admin-season';
import { Button } from '@/ui';
import { announce } from '@/ui/focus';
import { exportStories } from './api';
import { openLink, saveFile } from './download';

export function ExportStories() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(false);
    const download = await exportStories();
    setBusy(false);
    if (!download) {
      setProblem(true);
      announce(ERRORS.generic);
      return;
    }
    if (download.kind === 'link') openLink(download.url);
    else saveFile(download.blob, download.name);
  };

  return (
    <>
      <Button
        onClick={() => void run()}
        busy={busy ? STORIES.exporting : undefined}
        aria-busy={busy || undefined}
      >
        {STORIES.export}
      </Button>
      {problem ? <p className="err stories-export-err">{ERRORS.generic}</p> : null}
    </>
  );
}
