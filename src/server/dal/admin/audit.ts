import 'server-only';

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import type { AdminAuditAction, AdminAuditReasonCode } from '@/config/admin-audit-actions';
import {
  clampAdminPageSize,
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '@/lib/admin/cursor';
import type { Database } from '@/server/db/client';
import { adminAuditLog, platformAdmins, users } from '@/server/db/schema';

/**
 * Cross-tenant admin read queries for the Admin Audit list (Phase 11E) — a
 * sibling to `src/server/dal/admin/{users,workspaces,metrics}.ts`. No auth
 * check here; `requirePlatformAdmin()` is called once in
 * `src/server/services/admin/audit.ts` before any of these run.
 */

export interface AdminAuditRow {
  readonly id: string;
  readonly actorKind: string;
  readonly actorAdminId: string | null;
  readonly action: string;
  readonly subjectUserId: string | null;
  readonly subjectWorkspaceId: string | null;
  readonly reasonCode: string;
  readonly reasonNote: string | null;
  readonly beforeState: unknown;
  readonly afterState: unknown;
  readonly createdAt: Date;
}

export interface AdminAuditListPage {
  readonly items: readonly AdminAuditRow[];
  readonly nextCursor: string | null;
}

export interface ListAdminAuditParams {
  readonly action?: AdminAuditAction | null;
  readonly reasonCode?: AdminAuditReasonCode | null;
  readonly actorUserId?: string | null;
  readonly subjectUserId?: string | null;
  readonly subjectWorkspaceId?: string | null;
  readonly since?: Date | null;
  readonly cursor?: string | null;
  readonly limit?: number;
}

const AUDIT_PROJECTION = {
  id: adminAuditLog.id,
  actorKind: adminAuditLog.actorKind,
  actorAdminId: adminAuditLog.actorAdminId,
  action: adminAuditLog.action,
  subjectUserId: adminAuditLog.subjectUserId,
  subjectWorkspaceId: adminAuditLog.subjectWorkspaceId,
  reasonCode: adminAuditLog.reasonCode,
  reasonNote: adminAuditLog.reasonNote,
  beforeState: adminAuditLog.beforeState,
  afterState: adminAuditLog.afterState,
  createdAt: adminAuditLog.createdAt,
} as const;

/**
 * Newest-first, `(created_at, id)` keyset-paginated — reuses the exact
 * cursor shape `src/lib/admin/cursor.ts` already defines for Users/
 * Workspaces oversight (Phase 11D): `admin_audit_log.id` is `uuid`,
 * `created_at` is `timestamptz not null`, the identical shape.
 */
export async function listAdminAuditLog(
  db: Database,
  params: ListAdminAuditParams,
): Promise<AdminAuditListPage> {
  const limit = clampAdminPageSize(params.limit);
  const cursor = params.cursor ? decodeCreatedAtCursor(params.cursor) : null;

  const conditions = [];
  if (cursor !== null) {
    conditions.push(
      sql`(${adminAuditLog.createdAt}, ${adminAuditLog.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  }
  if (params.action !== undefined && params.action !== null) {
    conditions.push(eq(adminAuditLog.action, params.action));
  }
  if (params.reasonCode !== undefined && params.reasonCode !== null) {
    conditions.push(eq(adminAuditLog.reasonCode, params.reasonCode));
  }
  if (params.subjectUserId !== undefined && params.subjectUserId !== null) {
    conditions.push(eq(adminAuditLog.subjectUserId, params.subjectUserId));
  }
  if (params.subjectWorkspaceId !== undefined && params.subjectWorkspaceId !== null) {
    conditions.push(eq(adminAuditLog.subjectWorkspaceId, params.subjectWorkspaceId));
  }
  if (params.since !== undefined && params.since !== null) {
    conditions.push(gte(adminAuditLog.createdAt, params.since));
  }
  if (params.actorUserId !== undefined && params.actorUserId !== null) {
    conditions.push(
      inArray(
        adminAuditLog.actorAdminId,
        db
          .select({ id: platformAdmins.id })
          .from(platformAdmins)
          .where(eq(platformAdmins.userId, params.actorUserId)),
      ),
    );
  }

  const rows = await db
    .select(AUDIT_PROJECTION)
    .from(adminAuditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow !== undefined ? encodeCreatedAtCursor(lastRow.createdAt, lastRow.id) : null;

  return { items: pageRows, nextCursor };
}

export interface AdminAuditActorIdentityRow {
  readonly adminGrantId: string;
  readonly name: string;
  readonly email: string;
}

/** Batched, page-scoped actor-identity lookup — one query per page, never one per row. */
export async function listActorIdentitiesByGrantIds(
  db: Database,
  adminGrantIds: readonly string[],
): Promise<AdminAuditActorIdentityRow[]> {
  if (adminGrantIds.length === 0) return [];
  return db
    .select({ adminGrantId: platformAdmins.id, name: users.name, email: users.email })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(inArray(platformAdmins.id, adminGrantIds));
}
