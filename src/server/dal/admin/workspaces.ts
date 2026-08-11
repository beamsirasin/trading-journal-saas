import 'server-only';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  clampAdminPageSize,
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '@/lib/admin/cursor';
import { escapeLikePrefix, parseAdminSearchQuery } from '@/lib/admin/search';
import type { Database } from '@/server/db/client';
import {
  billingTransactions,
  strategies,
  trades,
  tradingAccounts,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';

/**
 * Cross-tenant admin read queries for Workspace oversight — a sibling to
 * `src/server/dal/admin/metrics.ts` and `users.ts`. No `workspaceId?`/
 * `skipTenantCheck?`/`adminMode?` escape hatch. `requirePlatformAdmin()` is
 * called one layer up, in `src/server/services/admin/workspace-oversight.ts`.
 */

export interface AdminWorkspaceRow {
  readonly workspaceId: string;
  readonly name: string;
  readonly createdAt: Date;
}

export interface AdminWorkspaceListPage {
  readonly items: readonly AdminWorkspaceRow[];
  readonly nextCursor: string | null;
}

export type AdminWorkspacePlanFilter = 'starter' | 'trader' | 'professional' | 'none';
export type AdminWorkspaceSourceFilter = 'trial' | 'paid' | 'complimentary';

export interface ListAdminWorkspacesParams {
  readonly q?: string | null;
  readonly plan?: AdminWorkspacePlanFilter | null;
  readonly source?: AdminWorkspaceSourceFilter | null;
  readonly cursor?: string | null;
  readonly limit?: number;
}

/**
 * Newest-first, `(created_at, id)` keyset-paginated. `plan`/`source` filter
 * on `workspace_entitlements`' own closed-set columns directly — never a
 * one-off re-implementation of `resolveEffectiveEntitlement`'s expiry/
 * materialization rules in SQL (Phase 11's own locked instruction). Rendered
 * effective status per row is still resolved by the real function, in the
 * service layer, from a separate fixed entitlement query — filtering and
 * display are deliberately different concerns here.
 */
export async function listAdminWorkspaces(
  db: Database,
  params: ListAdminWorkspacesParams,
): Promise<AdminWorkspaceListPage> {
  const limit = clampAdminPageSize(params.limit);
  const cursor = params.cursor ? decodeCreatedAtCursor(params.cursor) : null;
  const query = parseAdminSearchQuery(params.q);

  const conditions = [];
  if (cursor !== null) {
    conditions.push(
      sql`(${workspaces.createdAt}, ${workspaces.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  }
  if (query.kind === 'id') {
    conditions.push(eq(workspaces.id, query.id));
  } else if (query.kind === 'prefix') {
    const pattern = escapeLikePrefix(query.text);
    conditions.push(sql`${workspaces.name} ILIKE ${pattern} ESCAPE '\\'`);
  }
  if (params.plan !== undefined && params.plan !== null) {
    conditions.push(
      params.plan === 'none'
        ? isNull(workspaceEntitlements.planKey)
        : eq(workspaceEntitlements.planKey, params.plan),
    );
  }
  if (params.source !== undefined && params.source !== null) {
    conditions.push(eq(workspaceEntitlements.source, params.source));
  }

  const rows = await db
    .select({ workspaceId: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt })
    .from(workspaces)
    .leftJoin(workspaceEntitlements, eq(workspaceEntitlements.workspaceId, workspaces.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(workspaces.createdAt), desc(workspaces.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow !== undefined
      ? encodeCreatedAtCursor(lastRow.createdAt, lastRow.workspaceId)
      : null;

  return { items: pageRows, nextCursor };
}

export async function getAdminWorkspaceById(
  db: Database,
  workspaceId: string,
): Promise<(AdminWorkspaceRow & { readonly kind: string }) | null> {
  const [row] = await db
    .select({
      workspaceId: workspaces.id,
      name: workspaces.name,
      createdAt: workspaces.createdAt,
      kind: workspaces.kind,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
}

export interface AdminWorkspaceSummaryRow {
  readonly workspaceId: string;
  readonly name: string;
  readonly createdAt: Date;
}

/** Name + created date only, batched for a bounded set of Workspace IDs — used by User detail's Workspaces section so it never joins per-row. */
export async function listWorkspaceSummariesByIds(
  db: Database,
  workspaceIds: readonly string[],
): Promise<AdminWorkspaceSummaryRow[]> {
  if (workspaceIds.length === 0) return [];
  return db
    .select({ workspaceId: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt })
    .from(workspaces)
    .where(inArray(workspaces.id, workspaceIds));
}

export interface AdminWorkspaceOwnerRow {
  readonly workspaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
}

/** Active `role = 'owner'` memberships only — the canonical ownership signal (Phase 11's own instruction: never assume a `users.personalWorkspaceId` field). Zero or multiple rows for one Workspace is a real, safely-representable state, resolved by the service layer, not this query. */
export async function listOwnersForWorkspaces(
  db: Database,
  workspaceIds: readonly string[],
): Promise<AdminWorkspaceOwnerRow[]> {
  if (workspaceIds.length === 0) return [];
  return db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      userId: users.id,
      name: users.name,
      email: users.email,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        inArray(workspaceMembers.workspaceId, workspaceIds),
        eq(workspaceMembers.role, 'owner'),
        eq(workspaceMembers.status, 'active'),
      ),
    );
}

export interface AdminAccountCountRow {
  readonly workspaceId: string;
  readonly active: number;
  readonly archived: number;
}

export async function listTradingAccountCountsForWorkspaces(
  db: Database,
  workspaceIds: readonly string[],
): Promise<AdminAccountCountRow[]> {
  if (workspaceIds.length === 0) return [];
  return db
    .select({
      workspaceId: tradingAccounts.workspaceId,
      active: sql<number>`count(*) filter (where not ${tradingAccounts.isArchived})::int`,
      archived: sql<number>`count(*) filter (where ${tradingAccounts.isArchived})::int`,
    })
    .from(tradingAccounts)
    .where(inArray(tradingAccounts.workspaceId, workspaceIds))
    .groupBy(tradingAccounts.workspaceId);
}

export interface AdminStrategyCountRow {
  readonly workspaceId: string;
  readonly total: number;
  readonly archived: number;
}

/** COUNTS only — never a Strategy name, description, or Rule (Phase 11's locked boundary). */
export async function getStrategyCountsForWorkspace(
  db: Database,
  workspaceId: string,
): Promise<AdminStrategyCountRow> {
  const [row] = await db
    .select({
      workspaceId: strategies.workspaceId,
      total: sql<number>`count(*)::int`,
      archived: sql<number>`count(*) filter (where ${strategies.isArchived})::int`,
    })
    .from(strategies)
    .where(eq(strategies.workspaceId, workspaceId))
    .groupBy(strategies.workspaceId);
  return row ?? { workspaceId, total: 0, archived: 0 };
}

export interface AdminTradeCountRow {
  readonly workspaceId: string;
  readonly total: number;
  readonly softDeleted: number;
}

/** COUNTS only — never a symbol, direction, P&L, R, note, screenshot, or TradingView URL (Phase 11's locked boundary). `total` includes soft-deleted rows ("Trades logged" activity semantics, matching the Phase 11C Overview convention). */
export async function getTradeCountsForWorkspace(
  db: Database,
  workspaceId: string,
): Promise<AdminTradeCountRow> {
  const [row] = await db
    .select({
      workspaceId: trades.workspaceId,
      total: sql<number>`count(*)::int`,
      softDeleted: sql<number>`count(*) filter (where ${trades.deletedAt} is not null)::int`,
    })
    .from(trades)
    .where(eq(trades.workspaceId, workspaceId))
    .groupBy(trades.workspaceId);
  return row ?? { workspaceId, total: 0, softDeleted: 0 };
}

/** The exact sanitized projection `src/server/dal/workspace-export.ts` already uses for the customer-facing Workspace data export — reused, not reinvented. Provider identifiers, the idempotency key, `taxMode`, `taxJurisdiction`, and `vatRegistrationNumber` are deliberately never selected. */
export interface AdminBillingTransactionRow {
  readonly id: string;
  readonly planKey: string;
  readonly billingCurrency: string;
  readonly billingInterval: string;
  readonly subtotalMinor: bigint;
  readonly vatEnabled: boolean;
  readonly appliedVatRateBasisPoints: number;
  readonly vatAmountMinor: bigint;
  readonly totalMinor: bigint;
  readonly status: string;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;
}

export async function getLatestBillingTransactionForWorkspace(
  db: Database,
  workspaceId: string,
): Promise<AdminBillingTransactionRow | null> {
  const [row] = await db
    .select({
      id: billingTransactions.id,
      planKey: billingTransactions.planKey,
      billingCurrency: billingTransactions.billingCurrency,
      billingInterval: billingTransactions.billingInterval,
      subtotalMinor: billingTransactions.subtotalMinor,
      vatEnabled: billingTransactions.vatEnabled,
      appliedVatRateBasisPoints: billingTransactions.appliedVatRateBasisPoints,
      vatAmountMinor: billingTransactions.vatAmountMinor,
      totalMinor: billingTransactions.totalMinor,
      status: billingTransactions.status,
      createdAt: billingTransactions.createdAt,
      completedAt: billingTransactions.completedAt,
      failedAt: billingTransactions.failedAt,
    })
    .from(billingTransactions)
    .where(eq(billingTransactions.workspaceId, workspaceId))
    .orderBy(desc(billingTransactions.createdAt), desc(billingTransactions.id))
    .limit(1);
  return row ?? null;
}

export async function countBillingTransactionsForWorkspace(
  db: Database,
  workspaceId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(billingTransactions)
    .where(eq(billingTransactions.workspaceId, workspaceId));
  return row?.value ?? 0;
}
