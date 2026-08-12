import { adminCopy } from '@/components/admin/admin-copy';
import { AdminWorkspaceDetailSkeleton } from '@/components/admin/admin-workspace-detail-page';

export default function AdminWorkspaceDetailLoading() {
  return (
    <>
      <AdminWorkspaceDetailSkeleton />
      <span className="sr-only" role="status">
        {adminCopy.workspaces.detail.loadingLabel}
      </span>
    </>
  );
}
