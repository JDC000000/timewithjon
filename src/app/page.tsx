// src/app/page.tsx — the landing (T1.2 / T1.9; pack v2.2 s01/s02): hero (open or personal), the why photo, the one
// #story block (Jon, 2026-10-05), the closing photo. The activity menu is its own page (S04, decision 37c). Copy
// comes from src/content; the model decides, JSX only renders. `.photo-led` = the pack's body class for the v2.2 photo layer (src/ui/site.css).
import { Closing, StoryBlock, Why } from './_landing/Why';
import { Hero } from './_landing/Hero';
import { loadLanding } from './_landing/landing-data';
import { PersonalHero } from './_landing/PersonalHero';
import { SiteHeader } from '@/ui';

export default async function HomePage() {
  const { model, dish, gate } = await loadLanding();
  return (
    <div className="photo-led">
      <SiteHeader />
      <main id="main">
        {model.variant === 'personal' ? (
          <PersonalHero model={model} dish={dish} gate={gate} />
        ) : (
          <Hero model={model} />
        )}
        <Why />
        <StoryBlock />
        <Closing />
      </main>
    </div>
  );
}
