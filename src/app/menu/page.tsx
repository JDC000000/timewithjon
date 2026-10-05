// src/app/menu/page.tsx — S04 the activity menu (T1.3; pack v2.2 s04 + s05 sheets; decision 37c: its own page).
// The menu, then the closing photo (Jon, 2026-10-05: no menu foot, no closing line), then the footer line.
// ROUTES.menu = '/menu'. The model decides, JSX renders.
import type { Metadata } from 'next';
import { MENU_TITLE } from '@/content';
import { SiteFooter, SiteHeader } from '@/ui';
import { Closing } from '../_landing/Why';
import { Menu } from '../_menu/Menu';
import { CourseBar } from './CourseBar';
import { loadMenuGate } from '../_menu/menu-data';
import { menuModel } from '../_menu/menu-model';

export const metadata: Metadata = { title: `${MENU_TITLE} · Time with Jon` }; // PACK v2.2 s04 <title>

export default async function MenuPage() {
  const now = new Date();
  const gate = await loadMenuGate(now);
  const model = menuModel(now);
  return (
    <div className="photo-led">
      <SiteHeader />
      <main id="main">
        <Menu model={model} gate={gate} />
        <CourseBar />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}
