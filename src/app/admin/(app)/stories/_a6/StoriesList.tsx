// src/app/admin/(app)/stories/_a6/StoriesList.tsx — T2.9.U1: the A6 list pane (wireframe 09 A6): the title, "Add
// emailed story" (T3.7.U1), "Export" (T3.10.U1) and one row per story ("Priya · after The Long Lunch · OK for the
// book"). Server.
import Link from 'next/link';
import { Fragment } from 'react';
import type { StoryItem } from '@/features/admin/stories';
import { STORIES } from '@/content/ui/admin-season';
import { AddStory } from './AddStory';
import { ExportStories } from './ExportStories';
import { storyMeta, storyWho } from './model';
import { storyPath } from './paths';

export function StoriesList({ stories, current }: { stories: StoryItem[]; current?: string }) {
  return (
    <>
      <div className="pane-pad">
        <h1 className="h1" tabIndex={-1}>
          {STORIES.title}
        </h1>
        <p className="cap muted" style={{ marginTop: 'var(--s1)' }}>
          {STORIES.cap}
        </p>
        <div style={{ marginTop: 'var(--s3)', display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
          <AddStory />
          <ExportStories />
        </div>
      </div>
      <ul className="rows" style={{ marginTop: 'var(--s3)' }}>
        {stories.length === 0 ? (
          <li className="pane-pad ui muted" style={{ paddingBlock: 'var(--s5)' }}>
            {STORIES.empty}
          </li>
        ) : (
          stories.map((s) => (
            <li key={s.id}>
              <Link
                className="req"
                href={storyPath(s.id)}
                aria-current={current === s.id ? 'page' : undefined}
                // r5 N-L8 (as #64 on Links): a visually hidden ", " read "Name , OK for the book" (an out-of-flow span
                // adds a space); the name is the row's words joined plainly
                aria-label={[storyWho(s), ...storyMeta(s)].join(', ')}
              >
                <span className="who">{storyWho(s)}</span>
                <span className="meta">
                  {storyMeta(s).map((m, i) => (
                    <Fragment key={m}>
                      {i > 0 ? <span aria-hidden="true"> · </span> : null}
                      {m}
                    </Fragment>
                  ))}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
