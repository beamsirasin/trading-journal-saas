import { notFound } from 'next/navigation';

import { getAdminWorkspaceDetail } from '@/server/services/admin/workspace-oversight';
import { AdminWorkspaceDetailPage } from '@/components/admin/admin-workspace-detail-page';

/**
 * An unknown `workspaceId` renders the shared `admin/not-found.tsx`
 * boundary — a privacy-limited 404, never a 403 that would confirm whether
 * the ID exists (Phase 11D's locked rule).
 */
export default async function AdminWorkspaceDetailRoute({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const workspace = await getAdminWorkspaceDetail(workspaceId);
  if (workspace === null) {
    notFound();
  }
  return <AdminWorkspaceDetailPage workspace={workspace} />;
}
