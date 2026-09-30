// src/app/page.tsx — the landing (T1.2 / T1.9; pack v2.2 s01/s02): hero (open or personal), why, the #story block, the
// closing line. The activity menu is its own page (S04, decision 37c). Copy comes from src/content; the model
// decides, JSX only renders. `.photo-led` = the pack's body class for the v2.2 photo layer (src/ui/site.css).
import { Closing, Why } from './_landing/Why';
import { Hero } from './_landing/Hero';
import { loadLanding } from './_landing/landing-data';
import { PersonalHero } from './_landing/PersonalHero';
import { SendAStory } from './_landing/SendAStory';
import { SiteFooter, SiteHeader } from '@/ui';

/** Every photo slot the landing shows (both hero variants). */
const LANDING_PHOTOS = ['hero', 'why', 'close'] as const;

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
        <SendAStory />
        <Closing />
      </main>
      <SiteFooter photos={LANDING_PHOTOS} />
    </div>
  );
}
