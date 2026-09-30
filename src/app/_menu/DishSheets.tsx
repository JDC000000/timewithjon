'use client';
// src/app/_menu/DishSheets.tsx — S05 dish sheets on /menu (pack v2.2 s05): U1's Sheet (bottom sheet on phones, side
// panel from 1024 px; focus trap, Esc, focus back to the row). "Book {dish}" is pinned in the sheet and goes to
// bookHref(dish); a gate line (S16 stale, no invite, not yet open) stands in its place. Rows stay real links to
// /book/{slug} (no JS, or a new-tab click = the booking page).
import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { DishSlug } from '@/content';
import { MENU_LABELS } from '@/content';
import { Button, KeepWhole, PhotoSlot, Sheet } from '@/ui';
import type { BookGate } from '@/app/_landing/book-gate';
import type { DishRowModel, DishSheetModel } from './menu-model';
import { opensSheet, slugFromHash } from './sheet-open';

const OpenSheet = createContext<(slug: DishSlug) => void>(() => {});

export function DishLink({ slug, href, children }: { slug: DishSlug; href: string; children: ReactNode }) {
  const open = useContext(OpenSheet);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!opensSheet(e)) return;
    e.preventDefault();
    open(slug);
  };
  return (
    <a className="dish-row" href={href} aria-haspopup="dialog" onClick={onClick}>
      {children}
    </a>
  );
}

export function SheetBody({ line, sheet, gate }: { line: string; sheet: DishSheetModel; gate: BookGate }) {
  return (
    <>
      <p className="lead" style={{ marginTop: 'var(--s4)' }}>
        {line}
      </p>
      <dl className="facts">
        {sheet.facts.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>
              <KeepWhole text={v} />
            </dd>
          </Fragment>
        ))}
      </dl>
      {sheet.next ? (
        <p className="ui" style={{ marginTop: 'var(--s5)', color: 'var(--c-ink)' }}>
          {sheet.next}
        </p>
      ) : null}
      {gate.kind === 'book' ? (
        <p style={{ marginTop: 'var(--s5)' }}>
          <Button href={sheet.book.href} block>
            {sheet.book.label}
          </Button>
        </p>
      ) : gate.kind === 'note' ? (
        <p className="ui" style={{ marginTop: 'var(--s5)', color: 'var(--c-ink)' }}>
          {gate.text}
        </p>
      ) : null}
    </>
  );
}

export function DishSheets({
  dishes,
  gate,
  children,
}: {
  dishes: readonly DishRowModel[];
  gate: BookGate;
  children: ReactNode;
}) {
  const [openSlug, setOpenSlug] = useState<DishSlug | null>(null);
  const withSheet = dishes.flatMap((d) => (d.sheet ? [{ ...d, sheet: d.sheet }] : []));
  useEffect(() => {
    // On load only: a deep link (/menu#the-long-lunch) opens its sheet once, after hydration (next frame).
    const slug = slugFromHash(
      window.location.hash,
      withSheet.map((d) => d.slug),
    );
    if (!slug) return;
    const frame = requestAnimationFrame(() => setOpenSlug(slug));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <OpenSheet.Provider value={setOpenSlug}>
      {children}
      {withSheet.map((d) => (
        <Sheet
          key={d.slug}
          id={`d-${d.slug}`}
          open={openSlug === d.slug}
          onClose={() => setOpenSlug(null)}
          cap={d.sheet.cap}
          title={d.name}
          closeLabel={MENU_LABELS.close(d.name)}
          media={<PhotoSlot slot={d.slot} kind="sheet" sizes="(min-width: 1024px) 520px, 100vw" />}
        >
          <SheetBody line={d.line} sheet={d.sheet} gate={gate} />
        </Sheet>
      ))}
    </OpenSheet.Provider>
  );
}
