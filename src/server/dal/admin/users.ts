import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  clampAdminPageSize,
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '@/lib/admin/cursor';
import { escapeLikePrefix, parseAdminSearchQuery } from '@/lib/admin/search';
import type { Database } from '@/server/db/client';
import { accounts, users, workspaceMembers } from '@/server/db/schema';

/**
 * Cross-tenant admin read queries for User oversight — a sibling to
 * `src/server/dal/admin/metrics.ts` and `workspaces.ts`, never a change to
 * ordinary tenant DAL. No `workspaceId?`/`skipTenantCheck?`/`adminMode?`
 * escape hatch exists anywhere in this file or in `src/server/dal/*.ts`.
 * `requirePlatformAdmin()` is NOT called here — see that module's own
 * comment for why the boundary belongs one layer up, in
 * `src/server/services/admin/user-oversight.ts`.
 */

export interface AdminUserRow {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly createdAt: Date;
}

export interface AdminUserListPage {
  readonly items: readonly AdminUserRow[];
  readonly nextCursor: string | null;
}

export interface ListAdminUsersParams {
  readonly q?: string | null;
  readonly cursor?: string | null;
  readonly limit?: number;
}

/**
 * Newest-signup-first, `(created_at, id)` keyset-paginated, optionally
 * narrowed by `q` (exact user-ID match, or a case-insensitive escaped-prefix
 * match on email/name — see `src/lib/admin/search.ts`). One query; the
 * page's provider/membership/entitlement summaries are separate fixed
 * queries in the service layer, never per-row.
 */
export async function listAdminUsers(
  db: Database,
  params: ListAdminUsersParams,
): Promise<AdminUserListPage> {
  const limit = clampAdminPageSize(params.limit);
  const cursor = params.cursor ? decodeCreatedAtCursor(params.cursor) : null;
  const query = parseAdminSearchQuery(params.q);

  const conditions = [];
  if (cursor !== null) {
    conditions.push(
      sql`(${users.createdAt}, ${users.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`,
    );
  }
  if (query.kind === 'id') {
    conditions.push(eq(users.id, query.id));
  } else if (query.kind === 'prefix') {
    const pattern = escapeLikePrefix(query.text);
    conditions.push(
      sql`(${users.email} ILIKE ${pattern} ESCAPE '\\' OR ${users.name} ILIKE ${pattern} ESCAPE '\\')`,
    );
  }

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow !== undefined
      ? encodeCreatedAtCursor(lastRow.createdAt, lastRow.userId)
      : null;

  return { items: pageRows, nextCursor };
}

export async function getAdminUserById(db: Database, userId: string): Promise<AdminUserRow | null> {
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export interface AdminUserProviderRow {
  readonly userId: string;
  readonly providerId: string;
}

/**
 * Only `user_id`/`provider_id` — never a raw `accounts` row (Phase 11's own
 * "do not return raw accounts rows" rule). No password hash, no access/
 * refresh/ID token is ever selected here.
 */
export async function listProvidersForUsers(
  db: Database,
  userIds: readonly string[],
): Promise<AdminUserProviderRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select({ userId: accounts.userId, providerId: accounts.providerId })
    .from(accounts)
    .where(inArray(accounts.userId, userIds));
}

export interface AdminUserMembershipRow {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: string;
}

/** Active memberships only — a `status = 'active'` row is the canonical membership signal, matching `requireWorkspaceMembership`'s own tenant-side definition. */
export async function listActiveMembershipsForUsers(
  db: Database,
  userIds: readonly string[],
): Promise<AdminUserMembershipRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select({
      userId: workspaceMembers.userId,
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .where(and(inArray(workspaceMembers.userId, userIds), eq(workspaceMembers.status, 'active')));
}
