// src/app/admin/(app)/invites/_a5/data.ts — T2.6.U1: what A5 reads (server-only): every invite (T2.6.02) and the
// dishes a link can pick (bookable now: the create route refuses any other, `not_bookable`).
import 'server-only';
import { DISHES } from '@/content/menu';
import { isBookable } from '@/content/menu-helpers';
import { listInvites, type InviteListItem } from '@/features/admin/invites';
import type { DishOption } from './model';

export async function invitesPage(
  now = new Date(),
): Promise<{ invites: InviteListItem[]; dishes: DishOption[] }> {
  const invites = await listInvites(now);
  const dishes = DISHES.filter((d) => isBookable(d, now)).map((d) => ({
    slug: d.slug,
    name: d.name,
    section: d.section,
  }));
  return { invites, dishes };
}
