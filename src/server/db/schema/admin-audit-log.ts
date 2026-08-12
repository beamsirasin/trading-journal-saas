import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { users } from './auth';
import { platformAdmins } from './platform-admins';
import { workspaces } from './workspaces';

/**
 * The dedicated PLATFORM ADMIN audit trail — deliberately separate from the
 * workspace-tenant `audit_logs` table (CLAUDE.md's Phase 11 contract). That
 * table's actor is "the workspace member who acted on their own data"; this
 * table's actor is a platform operator acting on someone ELSE's data, which
 * needs a different subject model (a user, a workspace, or a platform-level
 * event with neither — e.g. a VAT rate change) and a mandatory reason plus
 * structural before/after snapshot that `audit_logs` has no columns for.
 *
 * Append-only in TWO senses, both enforced below by migration 0009's
 * triggers (Drizzle has no DDL for triggers — see 0006/0007's precedent):
 *   1. No row's content columns may ever be UPDATEd once inserted.
 *   2. No row may ever be DELETEd directly.
 * The one narrow exception the UPDATE trigger allows: `subject_user_id`/
 * `subject_workspace_id` transitioning to NULL, because their FKs are
 * `ON DELETE SET NULL` (matching `audit_logs`' own subject-nulling
 * precedent) — a future user/workspace deletion must be able to sever the
 * pointer without mutating the audit CONTENT (actor, action, reason,
 * before/after all stay exactly as recorded) and without being blocked by
 * the immutability trigger it would otherwise collide with.
 *
 * `before_state`/`after_state` are NOT raw row dumps — every caller must
 * supply the narrow, allowlisted `AdminAuditStateSnapshot` shape from
 * `src/server/services/admin-audit-log.ts`, which is what actually keeps
 * PII, tokens, and Trade/journal content out of this table. The jsonb column
 * itself cannot enforce that; the service's typed public API does.
 */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    /** 'platform_admin' | 'system' — see the actor-invariant CHECK below. */
    actorKind: text('actor_kind').notNull(),
    /**
     * Identifies which platform-admin GRANT (not merely which user) acted —
     * the `adminGrantId` a `PlatformAdminContext` carries. NULL only when
     * `actor_kind = 'system'` (the operational bootstrap/revoke script,
     * which has no authenticated platform-admin session to attribute to).
     */
    actorAdminId: uuid('actor_admin_id').references(() => platformAdmins.id, {
      onDelete: 'restrict',
    }),
    action: text('action').notNull(),
    /** SET NULL on subject deletion — see the module comment's immutability note. */
    subjectUserId: text('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
    subjectWorkspaceId: uuid('subject_workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    reasonCode: text('reason_code').notNull(),
    /** Optional, bounded plain text — never required merely to satisfy validation when the code is enough. Max length enforced by both this CHECK and the service's Zod-equivalent guard. */
    reasonNote: text('reason_note'),
    /** Allowlisted structural snapshot only — see the module comment. */
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The bounded, ordered admin-audit list Phase 11's own DoD requires
    // ("show recent admin activity") — same shape as `audit_logs_workspace_
    // created_idx`'s justification, minus the workspace scope.
    index('admin_audit_log_created_idx').on(table.createdAt),
    // A future admin user/workspace detail page's "audit involving this
    // subject" query (Phase 11A's oversight-contract recommendation).
    index('admin_audit_log_subject_user_idx').on(table.subjectUserId),
    index('admin_audit_log_subject_workspace_idx').on(table.subjectWorkspaceId),
    check(
      'admin_audit_log_actor_kind_check',
      sql`${table.actorKind} IN ('platform_admin', 'system')`,
    ),
    check(
      'admin_audit_log_actor_invariant_check',
      sql`(${table.actorKind} = 'platform_admin' AND ${table.actorAdminId} IS NOT NULL) OR (${table.actorKind} = 'system' AND ${table.actorAdminId} IS NULL)`,
    ),
    // Mirrors `src/config/admin-audit-actions.ts`'s ADMIN_AUDIT_ACTIONS —
    // keep both in sync, the same convention `workspace_entitlements.
    // plan_key`'s CHECK already follows against `config/plan-catalog.ts`.
    check(
      'admin_audit_log_action_check',
      sql`${table.action} IN (
        'platform_admin.granted',
        'platform_admin.revoked',
        'subscription.trial_extended',
        'subscription.complimentary_granted',
        'subscription.complimentary_revoked',
        'vat.configuration_changed'
      )`,
    ),
    // Mirrors ADMIN_AUDIT_REASON_CODES.
    check(
      'admin_audit_log_reason_code_check',
      sql`${table.reasonCode} IN (
        'bootstrap',
        'access_grant',
        'access_revoke',
        'trial_extension_goodwill',
        'complimentary_access',
        'support_adjustment',
        'configuration_change',
        'other'
      )`,
    ),
    check(
      'admin_audit_log_reason_note_length_check',
      sql`${table.reasonNote} IS NULL OR char_length(${table.reasonNote}) <= 500`,
    ),
  ],
);
