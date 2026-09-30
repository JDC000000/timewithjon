// src/app/admin/(app)/stories/_a6/StoriesList.tsx — T2.9.U1: the A6 list pane (wireframe 09 A6): the title, "Add
// emailed story" (T3.7.U1) and one row per story ("Priya · after The Long Lunch · OK for the book"). Server.
// T3.10.U1's Export button is GATED on the paid exports bucket: not built here.
import Link from 'next/link';
import { Fragment } from 'react';
import type { StoryItem } from '@/features/admin/stories';
import { STORIES } from '@/content/ui/admin-season';
import { AddStory } from './AddStory';
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
              >
                <span className="who">{storyWho(s)}</span>
                <span className="vh">, </span>
                <span className="meta">
                  {storyMeta(s).map((m, i) => (
                    <Fragment key={m}>
                      {i > 0 ? (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span className="vh">, </span>
                        </>
                      ) : null}
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
