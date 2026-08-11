import { adminCopy } from '@/components/admin/admin-copy';
import { AdminWorkspaceListSkeleton } from '@/components/admin/admin-workspace-list-page';

export default function AdminWorkspacesLoading() {
  return (
    <>
      <AdminWorkspaceListSkeleton />
      <span className="sr-only" role="status">
        {adminCopy.workspaces.loadingLabel}
      </span>
    </>
  );
}
