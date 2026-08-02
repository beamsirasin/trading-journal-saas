import 'server-only';

import { isAuditAction, type AuditAction } from '@/config/audit-actions';
import { auditLogs } from '@/server/db/schema';

import type { Database } from '../db/client';

/** Structurally matches both `Database` and a Drizzle transaction handle — every write goes through one or the other. */
type Executor = Pick<Database, 'insert'>;

export interface AuditLogInput {
  action: AuditAction;
  workspaceId?: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  /** Sanitized only — never a token, password hash, secret, or full request header. See `AUDIT_ACTIONS`' doc comment. */
  metadata?: Record<string, unknown>;
}

/**
 * The only way a row enters `audit_logs`. There is no update or delete
 * export anywhere in this codebase for this table — that absence, not a
 * runtime check, is what keeps the log append-only.
 */
export async function insertAuditLog(db: Executor, input: AuditLogInput): Promise<void> {
  if (!isAuditAction(input.action)) {
    // Defense in depth: TypeScript already restricts `input.action` to
    // `AuditAction` at every real call site; this only fires if something
    // bypasses the type (an `any`-typed value from an untyped boundary).
    throw new Error(`Refusing to record unknown audit action: ${String(input.action)}`);
  }

  await db.insert(auditLogs).values({
    action: input.action,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
  });
}
