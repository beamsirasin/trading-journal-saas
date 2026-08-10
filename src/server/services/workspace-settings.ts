import 'server-only';

import { and, eq } from 'drizzle-orm';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import type { UpdateWorkspaceNameData } from '@/lib/settings/schemas';
import { systemClock, type Clock } from '@/lib/time';
import { getDb } from '@/server/db/client';
import { workspaceMembers, workspaces } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import { lockAndResolveEntitlement } from './entitlement';

type AuditWriter = typeof insertAuditLog;

export type RenameWorkspaceErrorCode =
  'workspace_not_found' | 'owner_required' | 'read_only_workspace' | 'over_limit_workspace';

export type RenameWorkspaceResult =
  | { readonly ok: true; readonly changed: boolean; readonly name: string }
  | { readonly ok: false; readonly code: RenameWorkspaceErrorCode };

/** Owner-only ordinary write. Membership, workspace, entitlement, update, and audit share one transaction. */
export async function renameWorkspace(
  workspaceId: string,
  userId: string,
  input: UpdateWorkspaceNameData,
  dependencies: { readonly clock?: Clock; readonly auditWriter?: AuditWriter } = {},
): Promise<RenameWorkspaceResult> {
  const clock = dependencies.clock ?? systemClock;
  const auditWriter = dependencies.auditWriter ?? insertAuditLog;

  return getDb().transaction(async (tx) => {
    const [membership] = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, 'active'),
        ),
      );
    if (membership === undefined) return { ok: false, code: 'workspace_not_found' };
    if (membership.role !== 'owner') return { ok: false, code: 'owner_required' };

    const [workspace] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update');
    if (workspace === undefined) return { ok: false, code: 'workspace_not_found' };

    const lockedEntitlement = await lockAndResolveEntitlement(tx, workspaceId, clock);
    const authorization = authorizeWorkspaceMutation(
      lockedEntitlement.ok ? lockedEntitlement.effective : null,
      'ordinary_write',
    );
    if (!authorization.allowed) {
      return {
        ok: false,
        code:
          authorization.code === 'over_limit_workspace'
            ? 'over_limit_workspace'
            : 'read_only_workspace',
      };
    }

    if (workspace.name === input.name) {
      return { ok: true, changed: false, name: workspace.name };
    }

    await tx
      .update(workspaces)
      .set({ name: input.name, updatedAt: clock.now() })
      .where(eq(workspaces.id, workspaceId));
    await auditWriter(tx, {
      action: 'workspace.updated',
      workspaceId,
      actorUserId: userId,
      entityType: 'workspace',
      entityId: workspaceId,
      metadata: { changedFields: ['name'] },
    });

    return { ok: true, changed: true, name: input.name };
  });
}
