import 'server-only';

import { isAuditAction, type AuditAction } from '@/config/audit-actions';
import { auditLogs } from '@/server/db/schema';

import type { Database } from '../db/client';

/** Structurally matches both Database and a Drizzle transaction handle. */
type Executor = Pick<Database, 'insert'>;

export interface AuditLogInput {
  action: AuditAction;
  workspaceId?: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
}

/** The only application path that inserts an append-only audit row. */
export async function insertAuditLog(db: Executor, input: AuditLogInput): Promise<void> {
  if (!isAuditAction(input.action)) {
    throw new Error(`Refusing to record unknown audit action: ${String(input.action)}`);
  }

  await db.insert(auditLogs).values({
    action: input.action,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    // No approved metadata schema exists yet; accepting arbitrary objects
    // would make token/secret leakage a caller-by-caller convention.
    metadata: {},
  });
}
