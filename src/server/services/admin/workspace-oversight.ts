import 'server-only';

import {
  resolveEffectiveEntitlement,
  type EntitlementStatus,
  type PlanKey,
} from '@/lib/entitlements/resolve';
import { isCurrencyCode, type CurrencyCode } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';
import { systemClock, type Clock } from '@/lib/time';
import { requirePlatformAdmin } from '@/server/auth/admin-dal';
import {
  listEntitlementsByWorkspaceIds,
  toEntitlementRecord,
} from '@/server/dal/admin/entitlements';
import {
  countBillingTransactionsForWorkspace,
  getAdminWorkspaceById,
  getLatestBillingTransactionForWorkspace,
  getStrategyCountsForWorkspace,
  getTradeCountsForWorkspace,
  listAdminWorkspaces,
  listOwnersForWorkspaces,
  listTradingAccountCountsForWorkspaces,
  type AdminWorkspacePlanFilter,
  type AdminWorkspaceSourceFilter,
} from '@/server/dal/admin/workspaces';
import { getDb } from '@/server/db/client';

/**
 * Read-only Workspace oversight (Phase 11D) — sibling to
 * `user-oversight.ts`. `requirePlatformAdmin()` re-checked HERE, not only
 * the `/admin` route layout. Every exported function composes a small,
 * FIXED number of DAL queries per call — never one query per row.
 *
 * Locked privacy contract: no Strategy name/content, no Trade row or Trade
 * content, no payment-provider identifier, no idempotency key, no raw
 * billing-provider payload ever appears in any DTO this module returns —
 * only the same sanitized billing-transaction projection Phase 10's
 * Workspace export already uses.
 */

export type AdminWorkspaceOwnerSummary =
  | {
      readonly kind: 'single';
      readonly userId: string;
      readonly name: string;
      readonly email: string;
    }
  | { readonly kind: 'none' }
  | { readonly kind: 'multiple'; readonly count: number };

export interface AdminWorkspaceListItem {
  readonly workspaceId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly owner: AdminWorkspaceOwnerSummary;
  readonly effectiveStatus: EntitlementStatus | null;
  readonly effectivePlanKey: PlanKey | null;
  readonly source: 'trial' | 'paid' | 'complimentary' | null;
  readonly activeTradingAccounts: number;
  readonly archivedTradingAccounts: number;
}

export interface AdminWorkspaceListPage {
  readonly items: readonly AdminWorkspaceListItem[];
  readonly nextCursor: string | null;
}

export interface ListAdminWorkspacesServiceParams {
  readonly q?: string | null;
  readonly plan?: AdminWorkspacePlanFilter | null;
  readonly source?: AdminWorkspaceSourceFilter | null;
  readonly cursor?: string | null;
  readonly limit?: number;
}

function resolveOwnerSummary(
  owners: readonly { readonly userId: string; readonly name: string; readonly email: string }[],
): AdminWorkspaceOwnerSummary {
  if (owners.length === 0) return { kind: 'none' };
  if (owners.length === 1) {
    const owner = owners[0];
    if (owner === undefined) return { kind: 'none' };
    return { kind: 'single', userId: owner.userId, name: owner.name, email: owner.email };
  }
  return { kind: 'multiple', count: owners.length };
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

export async function getAdminWorkspaceList(
  params: ListAdminWorkspacesServiceParams,
  clock: Clock = systemClock,
): Promise<AdminWorkspaceListPage> {
  await requirePlatformAdmin();

  const db = getDb();
  const now = clock.now();
  const page = await listAdminWorkspaces(db, params);
  const workspaceIds = page.items.map((row) => row.workspaceId);

  const [ownerRows, entitlementRows, accountCountRows] = await Promise.all([
    listOwnersForWorkspaces(db, workspaceIds),
    listEntitlementsByWorkspaceIds(db, workspaceIds),
    listTradingAccountCountsForWorkspaces(db, workspaceIds),
  ]);
  const ownersByWorkspace = groupBy(ownerRows, (row) => row.workspaceId);
  const entitlementByWorkspace = new Map(entitlementRows.map((row) => [row.workspaceId, row]));
  const accountCountByWorkspace = new Map(accountCountRows.map((row) => [row.workspaceId, row]));

  const items = page.items.map((row): AdminWorkspaceListItem => {
    const entitlementRow = entitlementByWorkspace.get(row.workspaceId);
    const effective =
      entitlementRow === undefined
        ? null
        : resolveEffectiveEntitlement(toEntitlementRecord(entitlementRow), 0, now);
    const accountCounts = accountCountByWorkspace.get(row.workspaceId);

    return {
      workspaceId: row.workspaceId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      owner: resolveOwnerSummary(ownersByWorkspace.get(row.workspaceId) ?? []),
      effectiveStatus: effective?.effectiveStatus ?? null,
      effectivePlanKey: effective?.effectivePlanKey ?? null,
      source: (entitlementRow?.source as 'trial' | 'paid' | 'complimentary' | undefined) ?? null,
      activeTradingAccounts: accountCounts?.active ?? 0,
      archivedTradingAccounts: accountCounts?.archived ?? 0,
    };
  });

  return { items, nextCursor: page.nextCursor };
}

export interface AdminWorkspaceBillingTransactionSummary {
  readonly planKey: string;
  readonly billingInterval: string;
  readonly currency: string;
  readonly subtotal: string;
  readonly vatEnabled: boolean;
  readonly appliedVatRateBasisPoints: number;
  readonly vatAmount: string;
  readonly total: string;
  readonly status: string;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly failedAt: string | null;
}

export interface AdminWorkspaceBillingSummary {
  readonly latestTransaction: AdminWorkspaceBillingTransactionSummary | null;
  readonly transactionCount: number;
}

export interface AdminWorkspaceDetail {
  readonly workspaceId: string;
  readonly name: string;
  readonly kind: string;
  readonly createdAt: string;
  readonly owner: AdminWorkspaceOwnerSummary;
  readonly tradingAccounts: { readonly active: number; readonly archived: number };
  readonly strategies: { readonly total: number; readonly archived: number };
  readonly trades: { readonly total: number; readonly softDeleted: number };
  readonly subscription: {
    readonly effectiveStatus: EntitlementStatus | null;
    readonly effectivePlanKey: PlanKey | null;
    readonly source: 'trial' | 'paid' | 'complimentary' | null;
    readonly trialEndsAt: string | null;
    readonly currentPeriodEndsAt: string | null;
    readonly cancelAtPeriodEnd: boolean | null;
  };
  readonly billing: AdminWorkspaceBillingSummary;
}

function formatMinor(amountMinor: bigint, currency: string): string {
  if (!isCurrencyCode(currency)) return `${amountMinor.toString()} ${currency}`;
  return formatMoney({ amountMinor, currency: currency as CurrencyCode }, { style: 'code' });
}

/** Returns `null` for an unknown `workspaceId` — the caller renders a privacy-limited 404, never a 403. */
export async function getAdminWorkspaceDetail(
  workspaceId: string,
  clock: Clock = systemClock,
): Promise<AdminWorkspaceDetail | null> {
  await requirePlatformAdmin();

  const db = getDb();
  const now = clock.now();
  const workspace = await getAdminWorkspaceById(db, workspaceId);
  if (workspace === null) {
    return null;
  }

  const [
    ownerRows,
    entitlementRows,
    accountCountRows,
    strategyCounts,
    tradeCounts,
    latestTransaction,
    transactionCount,
  ] = await Promise.all([
    listOwnersForWorkspaces(db, [workspaceId]),
    listEntitlementsByWorkspaceIds(db, [workspaceId]),
    listTradingAccountCountsForWorkspaces(db, [workspaceId]),
    getStrategyCountsForWorkspace(db, workspaceId),
    getTradeCountsForWorkspace(db, workspaceId),
    getLatestBillingTransactionForWorkspace(db, workspaceId),
    countBillingTransactionsForWorkspace(db, workspaceId),
  ]);

  const entitlementRow = entitlementRows[0];
  const effective =
    entitlementRow === undefined
      ? null
      : resolveEffectiveEntitlement(toEntitlementRecord(entitlementRow), 0, now);
  const accountCounts = accountCountRows[0];

  return {
    workspaceId: workspace.workspaceId,
    name: workspace.name,
    kind: workspace.kind,
    createdAt: workspace.createdAt.toISOString(),
    owner: resolveOwnerSummary(ownerRows),
    tradingAccounts: { active: accountCounts?.active ?? 0, archived: accountCounts?.archived ?? 0 },
    strategies: { total: strategyCounts.total, archived: strategyCounts.archived },
    trades: { total: tradeCounts.total, softDeleted: tradeCounts.softDeleted },
    subscription: {
      effectiveStatus: effective?.effectiveStatus ?? null,
      effectivePlanKey: effective?.effectivePlanKey ?? null,
      source: (entitlementRow?.source as 'trial' | 'paid' | 'complimentary' | undefined) ?? null,
      trialEndsAt: entitlementRow?.trialEndsAt?.toISOString() ?? null,
      currentPeriodEndsAt: entitlementRow?.currentPeriodEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: entitlementRow?.cancelAtPeriodEnd ?? null,
    },
    billing: {
      latestTransaction:
        latestTransaction === null
          ? null
          : {
              planKey: latestTransaction.planKey,
              billingInterval: latestTransaction.billingInterval,
              currency: latestTransaction.billingCurrency,
              subtotal: formatMinor(
                latestTransaction.subtotalMinor,
                latestTransaction.billingCurrency,
              ),
              vatEnabled: latestTransaction.vatEnabled,
              appliedVatRateBasisPoints: latestTransaction.appliedVatRateBasisPoints,
              vatAmount: formatMinor(
                latestTransaction.vatAmountMinor,
                latestTransaction.billingCurrency,
              ),
              total: formatMinor(latestTransaction.totalMinor, latestTransaction.billingCurrency),
              status: latestTransaction.status,
              createdAt: latestTransaction.createdAt.toISOString(),
              completedAt: latestTransaction.completedAt?.toISOString() ?? null,
              failedAt: latestTransaction.failedAt?.toISOString() ?? null,
            },
      transactionCount,
    },
  };
}
