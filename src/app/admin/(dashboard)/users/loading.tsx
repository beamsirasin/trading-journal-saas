import { adminCopy } from '@/components/admin/admin-copy';
import { AdminUserListSkeleton } from '@/components/admin/admin-user-list-page';

export default function AdminUsersLoading() {
  return (
    <>
      <AdminUserListSkeleton />
      <span className="sr-only" role="status">
        {adminCopy.users.loadingLabel}
      </span>
    </>
  );
}
