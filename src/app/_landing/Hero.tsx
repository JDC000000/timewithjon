// src/app/_landing/Hero.tsx — S1 open hero (T1.2.U1; pack v2.2 s01). The lead-in is the FIXED OPEN_LINE (no shuffle).
// v2.2: the photo stands alone (no tag or words on it, decision 41c); words left, photo right from 1024 px.
import type { ReactNode } from 'react';
import { HEADLINE, HERO_BODY, HERO_DATE_LINE } from '@/content';
import type { LandingModel } from '@/features/invites/landing-model';
import { Button, KeepWhole, PhotoSlot } from '@/ui';

type OpenModel = Extract<LandingModel, { variant: 'open' }>;

export function HeroHeading({ name, line }: { name?: string; line: string }) {
  return (
    <h1 id="hero-h">
      {name ? <span className="name">{name}.</span> : null}
      <span className="lead-in">{line}</span>
      <span className="display">
        <span className="swipe">{HEADLINE}</span>
      </span>
    </h1>
  );
}

export function HeroFrame({ children }: { children: ReactNode }) {
  return (
    <section className="hero" aria-labelledby="hero-h">
      <div className="wrap grid">
        <div className="hero-in">{children}</div>
        <PhotoSlot slot="hero" kind="hero" sizes="(min-width: 1024px) 50vw, 100vw" priority="hero" />
      </div>
    </section>
  );
}

/** "I turn 50 on April 1. No joke.": the date never splits (pack s01 `<wbr><span class="nw">`). */
export function FactLine() {
  return (
    <p className="lead fact">
      <KeepWhole text={HERO_DATE_LINE} />
    </p>
  );
}

export function Hero({ model }: { model: OpenModel }) {
  return (
    <HeroFrame>
      <HeroHeading line={model.heroLine} />
      <FactLine />
      <p className="body hero-body">{HERO_BODY}</p>
      <p className="cta">
        <Button href={model.cta.href}>
          {model.cta.label}{' '}
          <span className="arr" aria-hidden="true">
            →
          </span>
        </Button>
      </p>
    </HeroFrame>
  );
}
