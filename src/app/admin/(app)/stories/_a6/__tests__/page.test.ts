// pr82-review F6: /admin/stories/[id] refuses a malformed id with notFound before any read, and reads a valid one
// in its one canonical (lowercase) form.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ storyPage: vi.fn() }));
vi.mock('@/features/admin/auth', () => ({
  adminFeatureOff: () => null,
  requireAdmin: async () => ({ email: 'jon@example.com' }),
}));
vi.mock('@/app/admin/(app)/stories/_a6/data', () => ({ storyPage: m.storyPage, storiesPage: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  useRouter: () => ({}),
}));

const { default: StoryPage } = await import('@/app/admin/(app)/stories/[id]/page');
const call = (id: string) =>
  StoryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

beforeEach(() => m.storyPage.mockReset());

describe('/admin/stories/[id] id guard', () => {
  it.each(['x', '123', '0b5f0d8e-3c1e-4d7e-9a53-0e8f2b1c4d5', '0b5f0d8e3c1e4d7e9a530e8f2b1c4d5a'])(
    '%s: not found, nothing read',
    async (id) => {
      await expect(call(id)).rejects.toThrow('NOT_FOUND');
      expect(m.storyPage).not.toHaveBeenCalled();
    },
  );
  it('a valid id is read lowercased; an unknown one is not found', async () => {
    m.storyPage.mockResolvedValue(null);
    await expect(call('0B5F0D8E-3C1E-4D7E-9A53-0E8F2B1C4D5A')).rejects.toThrow('NOT_FOUND');
    expect(m.storyPage).toHaveBeenCalledWith('0b5f0d8e-3c1e-4d7e-9a53-0e8f2b1c4d5a');
  });
});
