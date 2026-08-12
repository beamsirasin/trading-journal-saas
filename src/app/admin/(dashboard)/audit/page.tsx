import { isAdminAuditAction, isAdminAuditReasonCode } from '@/config/admin-audit-actions';
import { getAdminAuditList } from '@/server/services/admin/audit';
import { AdminAuditListPage } from '@/components/admin/admin-audit-list-page';

/**
 * `getAdminAuditList()` re-checks `requirePlatformAdmin()` itself. Read-only:
 * no Server Action, no mutation surface exists on this page.
 */
export default async function AdminAuditRoute({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    reason?: string;
    actor?: string;
    subjectUser?: string;
    subjectWorkspace?: string;
    date?: string;
    cursor?: string;
  }>;
}) {
  const { action, reason, actor, subjectUser, subjectWorkspace, date, cursor } = await searchParams;
  const actionFilter = action !== undefined && isAdminAuditAction(action) ? action : null;
  const reasonFilter = reason !== undefined && isAdminAuditReasonCode(reason) ? reason : null;
  const dateFilter = date === '30d' ? '30d' : null;

  const page = await getAdminAuditList({
    action: actionFilter,
    reasonCode: reasonFilter,
    actorUserId: actor ?? null,
    subjectUserId: subjectUser ?? null,
    subjectWorkspaceId: subjectWorkspace ?? null,
    ...(dateFilter === null ? {} : { datePreset: dateFilter }),
    cursor: cursor ?? null,
  });

  return (
    <AdminAuditListPage
      page={page}
      action={actionFilter ?? ''}
      reason={reasonFilter ?? ''}
      actor={actor ?? ''}
      subjectUser={subjectUser ?? ''}
      subjectWorkspace={subjectWorkspace ?? ''}
      date={dateFilter ?? ''}
      hasCursor={cursor !== undefined && cursor !== ''}
    />
  );
}
