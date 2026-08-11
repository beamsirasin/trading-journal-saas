import { getAdminUserList } from '@/server/services/admin/user-oversight';
import { AdminUserListPage } from '@/components/admin/admin-user-list-page';

/**
 * `getAdminUserList()` re-checks `requirePlatformAdmin()` itself (Phase 11's
 * "the layout guard alone is not sufficient" instruction). Read-only: no
 * Server Action, no form beyond the search box's plain navigation, no
 * mutation surface exists on this page (Phase 11D is read-only by contract).
 */
export default async function AdminUsersRoute({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const { q, cursor } = await searchParams;
  const query = q ?? '';
  const page = await getAdminUserList({ q: query, cursor: cursor ?? null });
  return (
    <AdminUserListPage
      page={page}
      query={query}
      hasCursor={cursor !== undefined && cursor !== ''}
    />
  );
}
