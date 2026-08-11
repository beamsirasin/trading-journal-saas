import 'server-only';

import {
  resolveEffectiveEntitlement,
  type EntitlementStatus,
  type PlanKey,
} from '@/lib/entitlements/resolve';
import { systemClock, type Clock } from '@/lib/time';
import { requirePlatformAdmin } from '@/server/auth/admin-dal';
import { toSafeProvider, type LinkedAuthProvider } from '@/server/auth/settings-dal';
import {
  listEntitlementsByWorkspaceIds,
  toEntitlementRecord,
} from '@/server/dal/admin/entitlements';
import {
  getAdminUserById,
  listActiveMembershipsForUsers,
  listAdminUsers,
  listProvidersForUsers,
  type ListAdminUsersParams,
} from '@/server/dal/admin/users';
import { listWorkspaceSummariesByIds } from '@/server/dal/admin/workspaces';
import { getDb } from '@/server/db/client';

/**
 * Read-only User oversight (Phase 11D) — `requirePlatformAdmin()` re-checked
 * HERE (not only the `/admin` route layout), the same posture
 * `services/admin/metrics.ts` established in Phase 11C. Every exported
 * function here composes a small, FIXED number of DAL queries per call —
 * never one query per row of a list page.
 *
 * Locked privacy contract (Phase 11D): no password hash, no session, no
 * OAuth token, no raw `accounts`/`sessions` row, no IP address, no provider
 * account identifier, no verification secret, no Trade content, no billing
 * provider identifier ever appears in any DTO this module returns.
 */

export type AdminUserWorkspaceSummary =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'single';
      readonly workspaceId: string;
      readonly role: string;
      readonly effectiveStatus: EntitlementStatus | null;
      readonly effectivePlanKey: PlanKey | null;
    }
  | { readonly kind: 'multiple'; readonly count: number };

export interface AdminUserListItem {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly createdAt: string;
  readonly providers: readonly LinkedAuthProvider[];
  readonly workspaceSummary: AdminUserWorkspaceSummary;
}

export interface AdminUserListPage {
  readonly items: readonly AdminUserListItem[];
  readonly nextCursor: string | null;
}

export interface AdminUserWorkspaceMembership {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceCreatedAt: string;
  readonly role: string;
  readonly effectiveStatus: EntitlementStatus | null;
  readonly effectivePlanKey: PlanKey | null;
  readonly source: 'trial' | 'paid' | 'complimentary' | null;
}

export interface AdminUserDetail {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly createdAt: string;
  readonly providers: readonly LinkedAuthProvider[];
  readonly workspaces: readonly AdminUserWorkspaceMembership[];
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const existing = map.get(key(item));
    if (existing === undefined) {
      map.set(key(item), [item]);
    } else {
      existing.push(item);
    }
  }
  return map;
}

export async function getAdminUserList(
  params: ListAdminUsersParams,
  clock: Clock = systemClock,
): Promise<AdminUserListPage> {
  await requirePlatformAdmin();

  const db = getDb();
  const now = clock.now();
  const page = await listAdminUsers(db, params);
  const userIds = page.items.map((row) => row.userId);

  const [providerRows, membershipRows] = await Promise.all([
    listProvidersForUsers(db, userIds),
    listActiveMembershipsForUsers(db, userIds),
  ]);
  const workspaceIds = [...new Set(membershipRows.map((row) => row.workspaceId))];
  const entitlementRows = await listEntitlementsByWorkspaceIds(db, workspaceIds);
  const entitlementByWorkspace = new Map(entitlementRows.map((row) => [row.workspaceId, row]));

  const providersByUser = groupBy(providerRows, (row) => row.userId);
  const membershipsByUser = groupBy(membershipRows, (row) => row.userId);

  const items = page.items.map((row): AdminUserListItem => {
    const providers = [
      ...new Set((providersByUser.get(row.userId) ?? []).map((p) => toSafeProvider(p.providerId))),
    ];
    const memberships = membershipsByUser.get(row.userId) ?? [];

    let workspaceSummary: AdminUserWorkspaceSummary;
    if (memberships.length === 0) {
      workspaceSummary = { kind: 'none' };
    } else if (memberships.length === 1) {
      const membership = memberships[0];
      if (membership === undefined) {
        workspaceSummary = { kind: 'none' };
      } else {
        const entitlementRow = entitlementByWorkspace.get(membership.workspaceId);
        const effective =
          entitlementRow === undefined
            ? null
            : resolveEffectiveEntitlement(toEntitlementRecord(entitlementRow), 0, now);
        workspaceSummary = {
          kind: 'single',
          workspaceId: membership.workspaceId,
          role: membership.role,
          effectiveStatus: effective?.effectiveStatus ?? null,
          effectivePlanKey: effective?.effectivePlanKey ?? null,
        };
      }
    } else {
      workspaceSummary = { kind: 'multiple', count: memberships.length };
    }

    return {
      userId: row.userId,
      name: row.name,
      email: row.email,
      emailVerified: row.emailVerified,
      createdAt: row.createdAt.toISOString(),
      providers,
      workspaceSummary,
    };
  });

  return { items, nextCursor: page.nextCursor };
}

/** Returns `null` for an unknown `userId` — the caller (`/admin/users/[userId]`) renders a privacy-limited 404, never a 403 (Phase 11's locked "do not reveal whether a resource exists vs. the caller lacks permission" rule). */
export async function getAdminUserDetail(
  userId: string,
  clock: Clock = systemClock,
): Promise<AdminUserDetail | null> {
  await requirePlatformAdmin();

  const db = getDb();
  const now = clock.now();
  const user = await getAdminUserById(db, userId);
  if (user === null) {
    return null;
  }

  const [providerRows, membershipRows] = await Promise.all([
    listProvidersForUsers(db, [userId]),
    listActiveMembershipsForUsers(db, [userId]),
  ]);
  const workspaceIds = membershipRows.map((row) => row.workspaceId);
  const [entitlementRows, workspaceSummaryRows] = await Promise.all([
    listEntitlementsByWorkspaceIds(db, workspaceIds),
    listWorkspaceSummariesByIds(db, workspaceIds),
  ]);
  const entitlementByWorkspace = new Map(entitlementRows.map((row) => [row.workspaceId, row]));
  const workspaceByWorkspace = new Map(workspaceSummaryRows.map((row) => [row.workspaceId, row]));

  const providers = [...new Set(providerRows.map((row) => toSafeProvider(row.providerId)))];

  const workspaces: AdminUserWorkspaceMembership[] = membershipRows.map((membership) => {
    const workspaceRow = workspaceByWorkspace.get(membership.workspaceId);
    const entitlementRow = entitlementByWorkspace.get(membership.workspaceId);
    const effective =
      entitlementRow === undefined
        ? null
        : resolveEffectiveEntitlement(toEntitlementRecord(entitlementRow), 0, now);

    return {
      workspaceId: membership.workspaceId,
      workspaceName: workspaceRow?.name ?? '(unknown workspace)',
      workspaceCreatedAt: (workspaceRow?.createdAt ?? now).toISOString(),
      role: membership.role,
      effectiveStatus: effective?.effectiveStatus ?? null,
      effectivePlanKey: effective?.effectivePlanKey ?? null,
      source: (entitlementRow?.source as 'trial' | 'paid' | 'complimentary' | undefined) ?? null,
    };
  });

  return {
    userId: user.userId,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
    providers,
    workspaces,
  };
}
