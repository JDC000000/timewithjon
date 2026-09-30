// src/app/_menu/menu-data.ts — the server half of /menu: the invite session decides what stands where Book would be.
import 'server-only';
import { bookGate, type BookGate } from '@/app/_landing/book-gate';
import { getInviteSession } from '@/features/invites/session';
import { loadSettings } from '@/lib/settings';

export async function loadMenuGate(now = new Date()): Promise<BookGate> {
  const session = await getInviteSession();
  // Release times matter only for a valid invite (as on the landing).
  const release = session.state === 'valid' ? await loadSettings() : null;
  return bookGate(session, release, now);
}
