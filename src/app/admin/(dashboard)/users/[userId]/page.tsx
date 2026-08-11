import { notFound } from 'next/navigation';

import { getAdminUserDetail } from '@/server/services/admin/user-oversight';
import { AdminUserDetailPage } from '@/components/admin/admin-user-detail-page';

/**
 * An unknown `userId` renders the shared `admin/not-found.tsx` boundary
 * (`notFound()` bubbles up to it, the same way `(dashboard)/layout.tsx`'s
 * own `notFound()` call already does) — a privacy-limited 404, never a 403
 * that would confirm whether the ID exists (Phase 11D's locked rule).
 */
export default async function AdminUserDetailRoute({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const user = await getAdminUserDetail(userId);
  if (user === null) {
    notFound();
  }
  return <AdminUserDetailPage user={user} />;
}
