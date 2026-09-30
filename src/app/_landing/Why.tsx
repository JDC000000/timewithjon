// src/app/_landing/Why.tsx — S3 why line + S14 closing line (T1.2.U1; pack v2.2 s01, wireframe 01). v2.2: no words
// on a photo. The why line sits below its band (decision 41b); the closing line comes first, then its photo (47c).
import { CLOSING_LINE, WHY_LINE } from '@/content';
import { LANDING_LABELS } from '@/content/ui/landing';
import { PhotoSlot } from '@/ui';

export function Why() {
  return (
    <section className="why" aria-label={LANDING_LABELS.why}>
      <PhotoSlot slot="why" kind="band" />
      <div className="wrap grid">
        <p className="lead">{WHY_LINE}</p>
      </div>
    </section>
  );
}

/** S14: once, small (D-2 default). `quiet` (the /menu page, Jon's menu polish): the line drops to the lead size so it sits
 *  in one calm hierarchy with the menu foot above it; the landing keeps the large closing line (47c). */
export function Closing({ quiet = false }: { quiet?: boolean }) {
  return (
    <section className={quiet ? 'closing closing--quiet' : 'closing'} aria-label={LANDING_LABELS.closing}>
      <div className="wrap">
        <p>{CLOSING_LINE}</p>
      </div>
      <PhotoSlot slot="close" kind="close" />
    </section>
  );
}
