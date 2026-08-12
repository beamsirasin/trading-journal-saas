import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { users } from './auth';

/**
 * Platform-admin authority — deliberately NOT `users.is_platform_admin` and
 * NOT derived from `workspace_members.role` (CLAUDE.md's Phase 11 contract:
 * "a Workspace owner who is not in this table is NOT an administrator").
 * A dedicated grant-history table isolates platform authority from both
 * product tenancy and Better Auth's own `users` table shape, and gives
 * revocation history for free: one row is one GRANT lifecycle
 * (grant -> optionally revoke), not a mutable flag.
 *
 * A user may accumulate several historical rows over time (grant, revoke,
 * grant again) — this is intentional and required, so there is deliberately
 * NO `UNIQUE(user_id)` constraint. Instead, `platform_admins_active_user_idx`
 * is a PARTIAL unique index that allows at most one row per user with
 * `revoked_at IS NULL` ("at most one ACTIVE grant"), while every revoked row
 * remains in the table permanently — revocation is `UPDATE ... SET
 * revoked_at`, never a delete.
 *
 * `grantedByAdminId`/`revokedByAdminId` self-reference this table's own `id`
 * (identifying which acting admin's GRANT authorized the action), not
 * `users.id` directly — this is exactly the `adminGrantId` a
 * `PlatformAdminContext` carries (`src/server/auth/admin-dal.ts`). Both are
 * nullable: the one-time operational bootstrap/revoke script
 * (`scripts/platform-admin.mjs`) has no authenticated platform-admin actor to
 * attribute to, and represents itself as `actor_kind = 'system'` in
 * `admin_audit_log` instead.
 *
 * FK behavior is deliberately RESTRICT, not CASCADE, on every reference here
 * (`userId` and both self-references): this table is security-sensitive
 * history, and account/user deletion is currently deferred (CLAUDE.md's
 * Phase 10 note) — a user with ANY grant history, even fully revoked, cannot
 * be deleted while that history exists. A future deletion feature must make
 * an explicit, reviewed decision about this table rather than silently
 * losing platform-admin provenance via an ON DELETE CASCADE written for a
 * different, ordinary tenant-owned table.
 */
export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedByAdminId: uuid('granted_by_admin_id').references((): AnyPgColumn => platformAdmins.id, {
      onDelete: 'restrict',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByAdminId: uuid('revoked_by_admin_id').references((): AnyPgColumn => platformAdmins.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    // The actual authority guarantee: at most one ACTIVE grant per user.
    // Historical revoked rows are exempt (partial index), so re-granting
    // after a revoke is always possible and always creates a new row.
    uniqueIndex('platform_admins_active_user_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
    // `requirePlatformAdmin()`'s read pattern: "does this user have an
    // active grant" scans by userId first regardless of revocation state
    // (e.g. a future admin-history view), so a plain index on userId is
    // useful in addition to the partial unique index above.
    index('platform_admins_user_idx').on(table.userId),
    check(
      'platform_admins_revoked_by_requires_revoked_at',
      sql`${table.revokedByAdminId} IS NULL OR ${table.revokedAt} IS NOT NULL`,
    ),
  ],
);
