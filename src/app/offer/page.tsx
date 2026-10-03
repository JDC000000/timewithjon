// src/app/offer/page.tsx — T2.4.U2 S18 "take an offered time" at /offer?t=<token> (take_offer link in E5 / E13).
// A Server Component that ONLY reads (loadOfferModel): a GET, a HEAD or a link scanner's prefetch changes nothing
// (N2). A tampered token is a 404; an expired one the "text me" frame; a spent link or an offer that has gone shows
// the request as it is now ("You're locked in for Thu May 13, …", T2.4 AC1). The one POST is ./take.tsx's button.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MANAGE_UI } from '@/content/manage';
import { loadOfferModel } from '@/features/invites/manage-model';
import { S18Current, S18Expired, S18Page, S18Shell } from './frame';
import { TakeOffer, type Choice } from './take';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: `${MANAGE_UI.title} · Time with Jon`,
  // strict-origin, as S17: no-referrer would send `Origin: null` on the POST and the route's Origin check refuses it.
  referrer: 'strict-origin',
  robots: { index: false, follow: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function OfferPage({ searchParams }: { searchParams: Search }) {
  const t = (await searchParams).t;
  const token = typeof t === 'string' ? t : null;
  const model = await loadOfferModel(token);
  if (model.kind === 'not_found') notFound();
  if (model.kind === 'expired') return <S18Shell>{<S18Expired />}</S18Shell>;
  if (model.kind === 'current')
    return (
      <S18Shell>
        <S18Page page="offer" view={model} state="current">
          <S18Current message={model.message} />
        </S18Page>
      </S18Shell>
    );
  // The take body names a slot by id, a range by its index among the offer's ranges (TakeBody).
  const slots = model.windows.filter((w) => w.slotId).length;
  const choices: Choice[] = model.windows.map((w, i) => ({
    key: w.slotId ?? `r${i - slots}`,
    label: w.label,
    startsAt: w.startsAt.toISOString(),
    pick: w.slotId ? { slotId: w.slotId } : { rangeIndex: i - slots },
  }));
  return (
    <S18Shell>
      <S18Page page="offer" view={model} state="offer">
        <TakeOffer token={token!} choices={choices} />
      </S18Page>
    </S18Shell>
  );
}
