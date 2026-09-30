// src/app/_landing/PersonalHero.tsx — S2 personal hero (T1.2.U2; pack v2.2 s02). Exported for U6's A5 invite preview:
// give it landingModel()'s personal variant, the picked dish (or null) and a BookGate ({ kind: 'book' } in a preview).
import { HERO_BODY } from '@/content';
import type { Dish } from '@/content';
import type { LandingModel } from '@/features/invites/landing-model';
import { Button } from '@/ui';
import { ROUTES } from '@/ui/routes';
import type { BookGate } from './book-gate';
import { FactLine, HeroFrame, HeroHeading } from './Hero';
import { around } from './text';

export type PersonalModel = Extract<LandingModel, { variant: 'personal' }>;

export interface PersonalHeroProps {
  model: PersonalModel;
  /** The invite's picked dish: its name links to its course on the activity menu (/menu#<section>). */
  dish: Pick<Dish, 'name' | 'section'> | null;
  gate: BookGate;
}

function PickedLine({ line, dish }: { line: string; dish: PersonalHeroProps['dish'] }) {
  const parts = dish ? around(line, dish.name) : null;
  if (!dish || !parts) return <>{line}</>;
  return (
    <>
      {parts[0]}
      <a className="il" href={`${ROUTES.menu}#${dish.section}`}>
        {dish.name}
      </a>
      {parts[1]}
    </>
  );
}

export function PersonalHero({ model, dish, gate }: PersonalHeroProps) {
  // The CTA is "Book {dish}" (skipping the dish sheet, G0.5 #4) or "See the whole menu" when the dish can't be
  // booked; a gate note (e.g. "Booking opens March 1.") stands in for Book. Never two identical links.
  const booking = model.cta.href !== model.secondary.href;
  return (
    <HeroFrame>
      <HeroHeading name={model.name} line={model.heroLine} />
      <FactLine />
      <p className="body hero-body">
        {model.pickedLine ? <PickedLine line={model.pickedLine} dish={dish} /> : HERO_BODY}
      </p>
      <p className="cta">
        {booking && gate.kind === 'note' ? (
          <span className="ui">{gate.text}</span>
        ) : (
          <Button href={model.cta.href}>{model.cta.label}</Button>
        )}
        {booking ? (
          <a className="textbtn" href={model.secondary.href}>
            {model.secondary.label}
          </a>
        ) : null}
      </p>
    </HeroFrame>
  );
}
