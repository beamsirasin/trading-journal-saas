import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { getActiveWorkspaceContext } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import {
  setupConditions,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
} from '@/server/db/schema';

/**
 * Authenticated Strategy/Setup/Rule reads — Phase 06D. Every export derives
 * workspace scope exclusively from `getActiveWorkspaceContext()` (never a
 * client-supplied `workspaceId`), matching `src/server/auth/dal.ts`'s
 * existing trading-account read functions (`listWorkspaceTradingAccounts`,
 * `getWorkspaceTradingAccountById`) — this file exists separately only
 * because the Strategy domain's read shapes are large enough to warrant
 * their own module, not because the authorization posture differs.
 *
 * Reads are never gated by entitlement/access mode — `writable`, `over_limit`,
 * and `read_only` workspaces all read identically; only mutations are gated
 * (`src/server/services/strategy-management.ts`). A cross-workspace or
 * missing Strategy/Setup ID is rejected identically as "not found" — never
 * distinguishable from the caller's perspective, so a forged ID can never
 * reveal that a record exists in someone else's tenant.
 *
 * Never returned: `mutation_key`, `workspace_id`, audit metadata, or any
 * fabricated trade count/win-rate/P&L figure — none of that exists yet, and
 * inventing a placeholder here would be exactly the kind of demo-data
 * formula CLAUDE.md's `lib/demo/` boundary exists to prevent.
 */

// ---------------------------------------------------------------------------
// Strategy list
// ---------------------------------------------------------------------------

export interface StrategyListCurrentVersion {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly name: string;
  readonly description: string | null;
  readonly notes: string | null;
  readonly isCurrentVersionLocked: boolean;
}

export interface StrategySetupCounts {
  readonly total: number;
  /** Non-archived Setups, but zero whenever the Strategy itself is archived — never "usable" merely because `setup.is_archived` is false. */
  readonly effectiveAvailable: number;
  readonly individuallyArchived: number;
}

export interface StrategyListItem {
  readonly strategyId: string;
  readonly isStrategyArchived: boolean;
  readonly currentVersion: StrategyListCurrentVersion;
  readonly setupCounts: StrategySetupCounts;
  readonly ruleCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type ListWorkspaceStrategiesResult =
  | { readonly ok: true; readonly strategies: readonly StrategyListItem[] }
  | { readonly ok: false; readonly code: 'strategy_current_version_missing' };

/**
 * Every Strategy (archived and active) in the caller's active workspace,
 * with its current Version's presentation, Setup counts, and current-Version
 * Rule count — the one data source for the future `/app/strategies` list.
 * Fixed-count batched queries regardless of how many Strategies exist (no
 * N+1): one for the Strategy rows, one for their current Versions, one
 * grouped count for Setups, one grouped count for Rules.
 *
 * Fails closed with `strategy_current_version_missing` for the WHOLE list —
 * never crashes, never silently drops the malformed row — if any persisted
 * Strategy has a null `current_version_id` (only ever legitimate transiently
 * inside `createStrategy`'s own transaction; a row visible here has already
 * committed and must be well-formed).
 */
export async function listWorkspaceStrategies(): Promise<ListWorkspaceStrategiesResult> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();

  const strategyRows = await db
    .select()
    .from(strategies)
    .where(eq(strategies.workspaceId, workspaceId));

  if (strategyRows.length === 0) {
    return { ok: true, strategies: [] };
  }

  const currentVersionIds: string[] = [];
  for (const row of strategyRows) {
    if (row.currentVersionId === null) {
      return { ok: false, code: 'strategy_current_version_missing' };
    }
    currentVersionIds.push(row.currentVersionId);
  }

  const versionRows = await db
    .select()
    .from(strategyVersions)
    .where(inArray(strategyVersions.id, currentVersionIds));
  const versionById = new Map(versionRows.map((v) => [v.id, v]));

  const strategyIds = strategyRows.map((s) => s.id);
  const setupCountRows = await db
    .select({
      strategyId: setups.strategyId,
      total: sql<number>`count(*)::int`,
      archivedCount: sql<number>`count(*) filter (where ${setups.isArchived})::int`,
    })
    .from(setups)
    .where(inArray(setups.strategyId, strategyIds))
    .groupBy(setups.strategyId);
  const setupCountsByStrategy = new Map(setupCountRows.map((r) => [r.strategyId, r]));

  const ruleCountRows = await db
    .select({
      strategyVersionId: strategyRules.strategyVersionId,
      total: sql<number>`count(*)::int`,
    })
    .from(strategyRules)
    .where(inArray(strategyRules.strategyVersionId, currentVersionIds))
    .groupBy(strategyRules.strategyVersionId);
  const ruleCountByVersion = new Map(ruleCountRows.map((r) => [r.strategyVersionId, r.total]));

  const items: StrategyListItem[] = [];
  for (const strategy of strategyRows) {
    // currentVersionId non-null is already guaranteed by the loop above.
    const version = versionById.get(strategy.currentVersionId as string);
    if (version === undefined) {
      return { ok: false, code: 'strategy_current_version_missing' };
    }
    const counts = setupCountsByStrategy.get(strategy.id);
    const total = counts?.total ?? 0;
    const archivedCount = counts?.archivedCount ?? 0;
    items.push({
      strategyId: strategy.id,
      isStrategyArchived: strategy.isArchived,
      currentVersion: {
        versionId: version.id,
        versionNumber: version.versionNumber,
        name: version.name,
        description: version.description,
        notes: version.notes,
        isCurrentVersionLocked: version.lockedAt !== null,
      },
      setupCounts: {
        total,
        effectiveAvailable: strategy.isArchived ? 0 : total - archivedCount,
        individuallyArchived: archivedCount,
      },
      ruleCount: ruleCountByVersion.get(strategy.currentVersionId as string) ?? 0,
      createdAt: strategy.createdAt,
      updatedAt: strategy.updatedAt,
    });
  }

  // Non-archived before archived, then updatedAt descending, then id as a
  // stable tie-breaker — deterministic regardless of insertion order.
  items.sort((a, b) => {
    if (a.isStrategyArchived !== b.isStrategyArchived) {
      return a.isStrategyArchived ? 1 : -1;
    }
    const byUpdatedAt = b.updatedAt.getTime() - a.updatedAt.getTime();
    if (byUpdatedAt !== 0) return byUpdatedAt;
    return a.strategyId < b.strategyId ? -1 : a.strategyId > b.strategyId ? 1 : 0;
  });

  return { ok: true, strategies: items };
}

// ---------------------------------------------------------------------------
// Strategy detail
// ---------------------------------------------------------------------------

export interface StrategyRuleDetail {
  readonly ruleId: string;
  readonly ruleKey: string;
  readonly category: string;
  readonly title: string;
  readonly description: string | null;
  readonly isRequired: boolean;
  readonly isPreTradeCheck: boolean;
  readonly sortOrder: number;
}

export interface StrategySetupDetail {
  readonly setupId: string;
  readonly isSetupArchived: boolean;
  /** `!isStrategyArchived && !isSetupArchived` — never inferred from `isSetupArchived` alone. */
  readonly isEffectivelyAvailable: boolean;
  readonly setupVersionId: string;
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number;
}

export interface SetupConditionDetail {
  readonly conditionId: string;
  readonly conditionKey: string;
  readonly setupId: string;
  readonly setupVersionId: string;
  readonly label: string;
  readonly sortOrder: number;
}

export interface StrategyVersionSummary {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly isLocked: boolean;
  readonly changeNote: string | null;
  readonly createdAt: Date;
}

export interface StrategyDetail {
  readonly strategyId: string;
  readonly isStrategyArchived: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly currentVersion: StrategyListCurrentVersion;
  readonly setups: readonly StrategySetupDetail[];
  readonly setupConditionsBySetupId: Readonly<Record<string, readonly SetupConditionDetail[]>>;
  readonly strategyLevelRules: readonly StrategyRuleDetail[];
  readonly setupLevelRulesBySetupId: Readonly<Record<string, readonly StrategyRuleDetail[]>>;
  readonly versionCount: number;
  readonly versionHistory: readonly StrategyVersionSummary[];
}

export type GetStrategyDetailResult =
  | { readonly ok: true; readonly strategy: StrategyDetail }
  | {
      readonly ok: false;
      readonly code:
        'strategy_not_found' | 'strategy_current_version_missing' | 'setup_snapshot_missing';
    };

function toRuleDetail(row: typeof strategyRules.$inferSelect): StrategyRuleDetail {
  return {
    ruleId: row.id,
    ruleKey: row.ruleKey,
    category: row.category,
    title: row.title,
    description: row.description,
    isRequired: row.isRequired,
    isPreTradeCheck: row.isPreTradeCheck,
    sortOrder: row.sortOrder,
  };
}

/**
 * One Strategy's full presentation: identity lifecycle, current Version,
 * every Setup identity with its current-Version snapshot and effective
 * availability, current-Version Rules grouped Strategy-level vs Setup-level,
 * and a lightweight Version-history summary (never loading every historical
 * Version's Rules/Setups — only `id`/`version_number`/`locked_at`/
 * `change_note`/`created_at`, one query, regardless of Version count).
 *
 * `strategyId` must already be a validated UUID from the caller (the Server
 * Action's Zod schema, or a route param) — this function still independently
 * scopes every query to the authenticated workspace, so a well-formed UUID
 * belonging to another workspace is indistinguishable from one that does not
 * exist at all: both return `strategy_not_found`.
 */
export async function getWorkspaceStrategyDetail(
  strategyId: string,
): Promise<GetStrategyDetailResult> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();

  const [strategy] = await db
    .select()
    .from(strategies)
    .where(and(eq(strategies.id, strategyId), eq(strategies.workspaceId, workspaceId)));
  if (strategy === undefined) {
    return { ok: false, code: 'strategy_not_found' };
  }
  if (strategy.currentVersionId === null) {
    return { ok: false, code: 'strategy_current_version_missing' };
  }

  const [currentVersion] = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.id, strategy.currentVersionId));
  if (currentVersion === undefined) {
    return { ok: false, code: 'strategy_current_version_missing' };
  }

  const setupRows = await db.select().from(setups).where(eq(setups.strategyId, strategyId));
  const snapshotRows = await db
    .select()
    .from(strategySetupVersions)
    .where(eq(strategySetupVersions.strategyVersionId, currentVersion.id));
  const snapshotBySetupId = new Map(snapshotRows.map((s) => [s.setupId, s]));

  const setupDetails: StrategySetupDetail[] = [];
  const setupIdBySnapshotId = new Map<string, string>();
  for (const setup of setupRows) {
    const snapshot = snapshotBySetupId.get(setup.id);
    if (snapshot === undefined) {
      return { ok: false, code: 'setup_snapshot_missing' };
    }
    setupIdBySnapshotId.set(snapshot.id, setup.id);
    setupDetails.push({
      setupId: setup.id,
      isSetupArchived: setup.isArchived,
      isEffectivelyAvailable: !strategy.isArchived && !setup.isArchived,
      setupVersionId: snapshot.id,
      name: snapshot.name,
      description: snapshot.description,
      sortOrder: snapshot.sortOrder,
    });
  }
  setupDetails.sort((a, b) => a.sortOrder - b.sortOrder);

  const conditionRows =
    snapshotRows.length === 0
      ? []
      : await db
          .select()
          .from(setupConditions)
          .where(
            and(
              eq(setupConditions.workspaceId, workspaceId),
              inArray(
                setupConditions.setupVersionId,
                snapshotRows.map((snapshot) => snapshot.id),
              ),
            ),
          );
  const setupConditionsBySetupId: Record<string, SetupConditionDetail[]> = {};
  for (const condition of conditionRows) {
    (setupConditionsBySetupId[condition.setupId] ??= []).push({
      conditionId: condition.id,
      conditionKey: condition.conditionKey,
      setupId: condition.setupId,
      setupVersionId: condition.setupVersionId,
      label: condition.label,
      sortOrder: condition.sortOrder,
    });
  }
  for (const list of Object.values(setupConditionsBySetupId)) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const ruleRows = await db
    .select()
    .from(strategyRules)
    .where(eq(strategyRules.strategyVersionId, currentVersion.id));

  const strategyLevelRules: StrategyRuleDetail[] = [];
  const setupLevelRulesBySetupId: Record<string, StrategyRuleDetail[]> = {};
  for (const rule of ruleRows) {
    if (rule.setupVersionId === null) {
      strategyLevelRules.push(toRuleDetail(rule));
      continue;
    }
    const setupId = setupIdBySnapshotId.get(rule.setupVersionId);
    if (setupId === undefined) {
      // A rule points at a setup-version snapshot that does not belong to
      // one of this Strategy's own Setups — a tenant/parent-integrity
      // violation the database's composite FKs should make unreachable.
      // Failing closed rather than silently dropping the rule.
      return { ok: false, code: 'setup_snapshot_missing' };
    }
    (setupLevelRulesBySetupId[setupId] ??= []).push(toRuleDetail(rule));
  }
  strategyLevelRules.sort((a, b) => a.sortOrder - b.sortOrder);
  for (const list of Object.values(setupLevelRulesBySetupId)) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const [versionCountRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(strategyVersions)
    .where(eq(strategyVersions.strategyId, strategyId));

  const versionHistoryRows = await db
    .select({
      id: strategyVersions.id,
      versionNumber: strategyVersions.versionNumber,
      lockedAt: strategyVersions.lockedAt,
      changeNote: strategyVersions.changeNote,
      createdAt: strategyVersions.createdAt,
    })
    .from(strategyVersions)
    .where(eq(strategyVersions.strategyId, strategyId))
    .orderBy(desc(strategyVersions.versionNumber));

  return {
    ok: true,
    strategy: {
      strategyId: strategy.id,
      isStrategyArchived: strategy.isArchived,
      createdAt: strategy.createdAt,
      updatedAt: strategy.updatedAt,
      currentVersion: {
        versionId: currentVersion.id,
        versionNumber: currentVersion.versionNumber,
        name: currentVersion.name,
        description: currentVersion.description,
        notes: currentVersion.notes,
        isCurrentVersionLocked: currentVersion.lockedAt !== null,
      },
      setups: setupDetails,
      setupConditionsBySetupId,
      strategyLevelRules,
      setupLevelRulesBySetupId,
      versionCount: versionCountRow?.total ?? 0,
      versionHistory: versionHistoryRows.map((v) => ({
        versionId: v.id,
        versionNumber: v.versionNumber,
        isLocked: v.lockedAt !== null,
        changeNote: v.changeNote,
        createdAt: v.createdAt,
      })),
    },
  };
}
