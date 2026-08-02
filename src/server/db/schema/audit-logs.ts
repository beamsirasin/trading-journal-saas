import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { users } from './auth';
import { workspaces } from './workspaces';

/**
 * Append-only. `src/server/services/audit-log.ts` exposes `insertAuditLog()`
 * only — there is no update or delete export anywhere in the codebase for
 * this table, which is the actual enforcement (a database `REVOKE` would be
 * stronger still and is worth adding once a migration-owning role exists
 * separate from the application's runtime role).
 *
 * `workspace_id`/`actor_user_id` are nullable ONLY for legitimate
 * account-level or system events (the brief's own wording) — every
 * Phase 2 event this table actually records has both, but the columns stay
 * nullable so a future account-level event (e.g. "user deleted their own
 * account") does not need a migration to relax a NOT NULL constraint.
 *
 * Phase 2 writes `metadata` as `{}` and `insertAuditLog()` accepts no metadata
 * argument. A future structured schema must explicitly allow fields before
 * this boundary is widened; arbitrary objects could silently capture secrets.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The phase's actual read pattern: "show recent activity for this workspace".
    index('audit_logs_workspace_created_idx').on(table.workspaceId, table.createdAt),
  ],
);
