import { adminCopy } from '@/components/admin/admin-copy';
import { AdminUserDetailSkeleton } from '@/components/admin/admin-user-detail-page';

export default function AdminUserDetailLoading() {
  return (
    <>
      <AdminUserDetailSkeleton />
      <span className="sr-only" role="status">
        {adminCopy.users.detail.loadingLabel}
      </span>
    </>
  );
}
