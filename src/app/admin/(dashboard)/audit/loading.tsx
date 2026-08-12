import { AdminAuditListSkeleton } from '@/components/admin/admin-audit-list-page';
import { adminCopy } from '@/components/admin/admin-copy';

export default function AdminAuditLoading() {
  return (
    <>
      <AdminAuditListSkeleton />
      <span className="sr-only" role="status">
        {adminCopy.audit.loadingLabel}
      </span>
    </>
  );
}
