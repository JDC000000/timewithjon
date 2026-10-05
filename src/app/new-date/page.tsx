// src/app/new-date/page.tsx — T2.4.U2 S18 "pick a new date" at /new-date?t=<token> (the pick_new_date link in E10,
// after a weather call). A Server Component that ONLY reads (loadNewDateModel): a GET, a HEAD or a link scanner's
// prefetch changes nothing (N2). Tampered → 404; expired → the "text me" frame; spent, or the request no longer
// waiting on a new time → its current line. The one POST is ./form.tsx's Send (/api/offer/propose).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MANAGE_UI } from '@/content/manage';
import type { Dish } from '@/content';
import { dishBySlug } from '@/content/menu-helpers';
import type { InviteKind } from '@/features/availability/types';
import { loadNewDateModel } from '@/features/invites/manage-model';
import { q } from '@/lib/db';
import { loadSettings } from '@/lib/settings';
import { vancouverDate } from '@/lib/time';
import { dishView } from '../book/[dish]/_lib/flow-view';
import { loadDishAvailability } from '../book/[dish]/_lib/load';
import { S18Current, S18Expired, S18Page, S18Shell } from '../offer/frame';
import { NewDateForm } from './form';
import { newDateSpan } from './span';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: `${MANAGE_UI.title} · Time with Jon`,
  referrer: 'strict-origin', // as S17 / /offer: the POST's Origin must get through
  robots: { index: false, follow: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function NewDatePage({ searchParams }: { searchParams: Search }) {
  const t = (await searchParams).t;
  const token = typeof t === 'string' ? t : null;
  const model = await loadNewDateModel(token);
  if (model.kind === 'not_found') notFound();
  if (model.kind === 'expired') return <S18Shell>{<S18Expired />}</S18Shell>;
  if (model.kind === 'current')
    return (
      <S18Shell>
        <S18Page page="new-date" view={model} state="current">
          <S18Current message={model.message} requestId={model.requestId} />
        </S18Page>
      </S18Shell>
    );
  const dish = dishBySlug(model.dish.slug);
  if (!dish) notFound();
  const [settings, unavailable] = await Promise.all([loadSettings(), offDates(model.requestId, dish)]);
  const span = newDateSpan(
    { start: settings.season_start, end: settings.season_end },
    vancouverDate(new Date()),
  );
  return (
    <S18Shell>
      <S18Page page="new-date" view={model} state="new_date">
        <NewDateForm
          token={token!}
          dish={dishView(dish)}
          form={dish.flow === 'pitch' ? 'pitch' : 'dates'}
          span={span}
          unavailable={unavailable}
        />
      </S18Page>
    </S18Shell>
  );
}

/**
 * QA r3 M2: the dates the engine has off for this request's dish and invite (rule 11: blocks, away, the household
 * hold, pre-release, past), computed exactly as /book computes them, so the grid never offers a day Send refuses.
 */
async function offDates(requestId: string, dish: Dish): Promise<string[]> {
  const [r] = await q<{ kind: InviteKind }>(
    `select i.kind from request r join invite i on i.id = r.invite_id where r.id = $1`,
    [requestId],
  );
  return (await loadDishAvailability(dish, r?.kind ?? 'general')).engine.unavailableDates;
}
