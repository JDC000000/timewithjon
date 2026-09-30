// src/app/_landing/landing-data.ts — the server half of the landing: session -> model, picked dish, book gate.
import 'server-only';
import type { Dish } from '@/content';
import { dishBySlug } from '@/content/menu-helpers';
import { landingModel, type LandingModel } from '@/features/invites/landing-model';
import { getInviteSession } from '@/features/invites/session';
import { loadSettings } from '@/lib/settings';
import { bookGate, type BookGate } from './book-gate';

export interface LandingData {
  model: LandingModel;
  dish: Dish | null;
  gate: BookGate;
}

export async function loadLanding(now = new Date()): Promise<LandingData> {
  const session = await getInviteSession();
  // Settings (release times) matter only for a valid invite; a stale or missing one never reaches the DB twice.
  const release = session.state === 'valid' ? await loadSettings() : null;
  const dish =
    session.state === 'valid' && session.invite.picked_dish
      ? (dishBySlug(session.invite.picked_dish) ?? null)
      : null;
  return {
    model: landingModel(session, now),
    dish,
    gate: bookGate(session, release, now, dish ?? undefined),
  };
}
