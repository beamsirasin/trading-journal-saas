import 'server-only';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { composeRealizedActual } from '@/lib/calc/trade';
import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
import type { SetupConditionCheckStatus } from '@/lib/setup-conditions/snapshots';
import { isChartAttachmentStorageConfigured } from '@/lib/storage/chart-attachment-storage';
import type {
  ActualResultMode,
  MistakeSeverity,
  OutcomeValue,
  RuleCheckStatus,
  SystemExitReason,
  SystemResolutionKind,
  SystemStatus,
  TradeDirection,
  TradeStatus,
} from '@/lib/trades/constants';
import { getActiveWorkspaceContext } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import {
  emotionTypes,
  mistakeTypes,
  setupConditions,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeEmotions,
  tradeExits,
  tradeMistakes,
  tradeRuleChecks,
  trades,
  tradeSetupConditionChecks,
  tradingAccounts,
} from '@/server/db/schema';

/**
 * Authenticated Trade reads — Phase 08C. Every export derives workspace
 * scope exclusively from `getActiveWorkspaceContext()` (never a
 * client-supplied `workspaceId`), matching `src/server/dal/strategies.ts`'s
 * exact posture. Reads are NEVER entitlement-gated — `writable`,
 * `over_limit`, and `read_only` workspaces all read identically; only
 * mutations (`src/server/services/trade-management.ts`/`trade-discipline.ts`)
 * are gated. A cross-workspace or missing Trade ID is rejected identically as
 * "not found" — never distinguishable from the caller's perspective.
 *
 * ## The historical-label rule (critical)
 *
 * Every Strategy/Setup label this file ever returns for an EXISTING Trade
 * comes from that Trade's OWN PINNED snapshot — `strategy_versions` row at
 * `trade.strategy_version_id`, `strategy_setup_versions` row at
 * `trade.setup_version_id` — joined directly on those two foreign keys.
 * Nothing here ever resolves a label via `strategies.current_version_id`
 * (that is exactly the query shape `src/server/dal/strategies.ts` uses for
 * the CURRENT Strategy presentation, deliberately not reused here). A later
 * Strategy/Setup rename, or an entirely new Version, must never rewrite what
 * an old Trade appears to have used — see
 * `trades.integration.test.ts`'s dedicated proof.
 *
 * Every returned value is already serializable — `bigint` minor units as
 * decimal-integer strings, `Date` as ISO-8601 strings, decimal/R columns as
 * the strings Drizzle/postgres.js already return them as. No caller of this
 * file (a Server Component, a Server Action) ever needs to convert anything
 * further before sending it to the client.
 */

function minorToString(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

function dateToIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * `postgres.js` does not always parse a raw `sql<Date>\`coalesce(...)\`` computed
 * column's result the same way it parses an ordinary `timestamptz` column
 * reference — it can come back as an ISO-formatted string rather than a
 * `Date` instance. Normalizing once here (rather than trusting the `sql<Date>`
 * type parameter, which is a compile-time-only assertion) is what makes
 * `.toISOString()`/`encodeCursor` safe to call on the result unconditionally.
 */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface TradeListItem {
  readonly tradeId: string;
  /**
   * `exited_at ?? entered_at ?? created_at` — the most advanced lifecycle
   * timestamp available for a Trade in ANY status. A closed Trade sorts by
   * when it closed (matching the equity-curve convention
   * `docs/calculation-spec.md` already establishes for the Trader axis); an
   * open Trade, not yet exited, sorts by when it was entered; a still-
   * `planned` Trade, with neither, sorts by when it was created. Never
   * `updated_at` — a silent edit must never reorder the list.
   */
  readonly occurredAt: string;
  readonly symbol: string;
  readonly direction: TradeDirection;
  readonly tradingAccountName: string;
  /** The pinned Strategy Version's own name — see the module's historical-label rule. */
  readonly strategyName: string;
  /** The pinned Setup Version snapshot's own name — see the module's historical-label rule. */
  readonly setupName: string;
  readonly strategyVersionNumber: number;
  readonly status: TradeStatus;
  readonly systemStatus: SystemStatus;
  readonly plannedR: string | null;
  readonly actualR: string | null;
  readonly systemR: string | null;
  readonly traderOutcome: OutcomeValue | null;
  readonly systemOutcome: OutcomeValue | null;
  /**
   * Closed/remaining basis points as of this read — `0`/`10_000` for any
   * Trade with no Exit legs (never fetched per-row; see the batched Exit
   * query in `listWorkspaceTrades`). Meaningful for a partially-exited
   * `open` Trade; a `closed` Trade's authoritative final figure is `actualR`
   * above, not this pair.
   */
  readonly closedBps: number;
  readonly remainingBps: number;
  /**
   * Realized R to date for a partially-exited `open` Trade, derived
   * in-process via `composeRealizedActual` from the same batched Exit read
   * — `null` whenever not meaningful (no exits yet, or already closed, in
   * which case `actualR` is authoritative). Never a second competing
   * calculation of the closed figure.
   */
  readonly realizedRToDate: string | null;
  /**
   * Setup Condition adherence, batched from `trade_setup_condition_checks`
   * (Phase 13G, §9/§22) — `null` whenever no Condition snapshot rows exist
   * for this Trade (historical/not-recorded or a zero-Condition Setup
   * Version). The List deliberately does not distinguish those two `null`
   * cases from each other; Trade Detail is authoritative for that
   * three-state disclosure.
   */
  readonly setupConditionMetCount: number | null;
  readonly setupConditionTotalCount: number | null;
}

export interface TradeListPage {
  readonly items: readonly TradeListItem[];
  /** Pass back as `cursor` to fetch the next page; `null` once the list is exhausted. */
  readonly nextCursor: string | null;
}

export interface ListWorkspaceTradesParams {
  readonly limit?: number;
  readonly cursor?: string | null;
  /** Optional trusted/read-scoped Account identity; workspace scope still applies independently. */
  readonly tradingAccountId?: string;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

function clampPageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_PAGE_SIZE);
}

interface DecodedCursor {
  readonly occurredAt: string;
  readonly tradeId: string;
}

/**
 * An opaque, Trade-list-specific keyset cursor — not a general pagination
 * framework. Encodes `(occurredAt, tradeId)`, the exact composite ordering
 * key the list query sorts by, so "the next page" is a plain, index-friendly
 * `(occurredAt, id) < (cursorOccurredAt, cursorId)` row comparison rather
 * than an `OFFSET`, which degrades under concurrent inserts (skipped or
 * duplicated rows as the list shifts underneath a paging user).
 */
function encodeCursor(occurredAt: Date, tradeId: string): string {
  return Buffer.from(`${occurredAt.toISOString()}|${tradeId}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separatorIndex = decoded.indexOf('|');
    if (separatorIndex === -1) return null;
    const occurredAt = decoded.slice(0, separatorIndex);
    const tradeId = decoded.slice(separatorIndex + 1);
    if (occurredAt === '' || tradeId === '' || Number.isNaN(Date.parse(occurredAt))) return null;
    return { occurredAt, tradeId };
  } catch {
    return null;
  }
}

const occurredAtExpr = sql<Date>`coalesce(${trades.exitedAt}, ${trades.enteredAt}, ${trades.createdAt})`;

/**
 * Every non-deleted Trade in the caller's active workspace, newest
 * `occurredAt` first, deterministically tie-broken by `id` (UUIDv7 sorts
 * chronologically as a secondary key too). One query with three inner joins
 * (Trading Account, pinned Strategy Version, pinned Setup Version snapshot)
 * — no N+1 regardless of how many Trades match, and every label already the
 * historically-pinned one (see the module doc comment).
 */
export async function listWorkspaceTrades(
  params: ListWorkspaceTradesParams = {},
): Promise<TradeListPage> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();
  const limit = clampPageSize(params.limit);
  const cursor = params.cursor ? decodeCursor(params.cursor) : null;

  const conditions = [eq(trades.workspaceId, workspaceId), isNull(trades.deletedAt)];
  if (params.tradingAccountId !== undefined) {
    conditions.push(eq(trades.tradingAccountId, params.tradingAccountId));
  }
  if (cursor !== null) {
    conditions.push(
      sql`(${occurredAtExpr}, ${trades.id}) < (${cursor.occurredAt}::timestamptz, ${cursor.tradeId}::uuid)`,
    );
  }

  const rows = await db
    .select({
      tradeId: trades.id,
      occurredAt: occurredAtExpr,
      symbol: trades.symbol,
      direction: trades.direction,
      status: trades.status,
      systemStatus: trades.systemStatus,
      plannedR: trades.plannedR,
      actualR: trades.actualR,
      systemR: trades.systemR,
      traderOutcome: trades.traderOutcome,
      systemOutcome: trades.systemOutcome,
      actualResultMode: trades.actualResultMode,
      actualEntry: trades.actualEntry,
      actualInitialStop: trades.actualInitialStop,
      actualInitialRiskMinor: trades.actualInitialRiskMinor,
      tradingAccountName: tradingAccounts.name,
      strategyVersionName: strategyVersions.name,
      strategyVersionNumber: strategyVersions.versionNumber,
      setupVersionName: strategySetupVersions.name,
    })
    .from(trades)
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, trades.tradingAccountId))
    .innerJoin(strategyVersions, eq(strategyVersions.id, trades.strategyVersionId))
    .innerJoin(strategySetupVersions, eq(strategySetupVersions.id, trades.setupVersionId))
    .where(and(...conditions))
    .orderBy(desc(occurredAtExpr), desc(trades.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow !== undefined
      ? encodeCursor(toDate(lastRow.occurredAt), lastRow.tradeId)
      : null;

  const tradeIds = pageRows.map((row) => row.tradeId);

  // One batched Exit read for the whole page (never per-row) — only ever
  // used to derive partial-close realized R for a still-`open` Trade; a
  // `closed` Trade's authoritative figure is `trades.actual_r` above.
  const exitBatchRows =
    tradeIds.length === 0
      ? []
      : await db
          .select()
          .from(tradeExits)
          .where(inArray(tradeExits.tradeId, tradeIds))
          .orderBy(asc(tradeExits.tradeId), asc(tradeExits.sequence));
  const exitsByTradeId = new Map<string, typeof exitBatchRows>();
  for (const exit of exitBatchRows) {
    const list = exitsByTradeId.get(exit.tradeId) ?? [];
    list.push(exit);
    exitsByTradeId.set(exit.tradeId, list);
  }

  // One batched, grouped Setup Condition Check count for the whole page —
  // §9/§22's sanctioned shape. `null` per Trade when no rows exist; the
  // List does not attempt to distinguish "not recorded" from "zero
  // configured Conditions" (Detail alone is authoritative for that).
  const conditionCountRows =
    tradeIds.length === 0
      ? []
      : await db
          .select({
            tradeId: tradeSetupConditionChecks.tradeId,
            checkStatus: tradeSetupConditionChecks.checkStatus,
            count: sql<number>`count(*)::int`,
          })
          .from(tradeSetupConditionChecks)
          .where(inArray(tradeSetupConditionChecks.tradeId, tradeIds))
          .groupBy(tradeSetupConditionChecks.tradeId, tradeSetupConditionChecks.checkStatus);
  const conditionCountsByTradeId = new Map<string, { met: number; total: number }>();
  for (const row of conditionCountRows) {
    const current = conditionCountsByTradeId.get(row.tradeId) ?? { met: 0, total: 0 };
    current.total += row.count;
    if (row.checkStatus === 'met') current.met += row.count;
    conditionCountsByTradeId.set(row.tradeId, current);
  }

  return {
    items: pageRows.map((row) => {
      const exits = exitsByTradeId.get(row.tradeId) ?? [];
      const closedBps = exits.reduce((total, exit) => total + exit.closedBps, 0);
      const realizedRToDate =
        row.status === 'open' && closedBps > 0
          ? (() => {
              const realized = composeRealizedActual({
                actualResultMode: row.actualResultMode,
                direction: row.direction,
                actualEntry: row.actualEntry,
                actualInitialStop: row.actualInitialStop,
                actualInitialRiskMinor: row.actualInitialRiskMinor,
                exits,
              });
              return realized.ok ? realized.value.realizedR : null;
            })()
          : null;
      const conditionCounts = conditionCountsByTradeId.get(row.tradeId) ?? null;

      return {
        tradeId: row.tradeId,
        occurredAt: toDate(row.occurredAt).toISOString(),
        symbol: row.symbol,
        direction: row.direction as TradeDirection,
        tradingAccountName: row.tradingAccountName,
        strategyName: row.strategyVersionName,
        setupName: row.setupVersionName,
        strategyVersionNumber: row.strategyVersionNumber,
        status: row.status as TradeStatus,
        systemStatus: row.systemStatus as SystemStatus,
        plannedR: row.plannedR,
        actualR: row.actualR,
        systemR: row.systemR,
        traderOutcome: row.traderOutcome as OutcomeValue | null,
        systemOutcome: row.systemOutcome as OutcomeValue | null,
        closedBps,
        remainingBps: 10_000 - closedBps,
        realizedRToDate,
        setupConditionMetCount: conditionCounts?.met ?? null,
        setupConditionTotalCount: conditionCounts?.total ?? null,
      };
    }),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface TradeRuleCheckDetail {
  readonly ruleKey: string;
  /** Derived from the pinned Rule's own `setup_version_id` — `strategyRuleId`/the internal row id are never exposed. */
  readonly scope: 'strategy' | 'setup';
  readonly title: string;
  readonly category: string;
  readonly isRequired: boolean;
  readonly isPreTradeCheck: boolean;
  readonly sortOrder: number;
  readonly checkStatus: RuleCheckStatus;
}

export interface TradeMistakeDetail {
  readonly mistakeTypeId: string;
  readonly key: string;
  readonly label: string;
  readonly severityAtTime: MistakeSeverity;
  readonly weightAtTime: string;
  readonly note: string | null;
}

export interface TradeMistakeOption {
  readonly mistakeTypeId: string;
  readonly key: string;
  readonly label: string;
}

export interface TradeSetupConditionCheckDetail {
  readonly conditionKey: string;
  readonly label: string;
  readonly sortOrder: number;
  readonly checkStatus: SetupConditionCheckStatus;
}

/**
 * The three-state Setup Condition disclosure (Phase 13G §5/§9) — derived
 * read-only from two already-existing sources, never a new persisted flag:
 * `recorded` when this Trade has its own immutable
 * `trade_setup_condition_checks` snapshot rows; `not_configured` when the
 * pinned Setup Version itself has zero `setup_conditions` rows (a genuinely
 * empty checklist, never `0%`); `not_recorded` when the Setup Version DID
 * have Conditions but this Trade predates/skipped capturing an answer for
 * them (a historical/pre-13C Trade).
 */
export type TradeSetupConditionState = 'recorded' | 'not_recorded' | 'not_configured';

export interface TradeDetail {
  readonly tradeId: string;
  readonly tradingAccountId: string;
  readonly tradingAccountName: string;
  /** Account currency code used to format the minor-unit execution amounts. */
  readonly tradingAccountBaseCurrency: string;
  readonly tradingAccountIsArchived: boolean;
  readonly strategyId: string;
  /** The pinned Strategy Version's own name — see the module's historical-label rule. */
  readonly strategyName: string;
  readonly strategyVersionNumber: number;
  /** Whether the LIVE Strategy (not this Trade's pinned Version) is archived today — a truthful disclosure, never a reason to hide the pinned historical label. */
  readonly strategyIsArchived: boolean;
  readonly setupId: string;
  /** The pinned Setup Version snapshot's own name — see the module's historical-label rule. */
  readonly setupName: string;
  /** Whether the LIVE Setup is archived today — see `strategyIsArchived`. */
  readonly setupIsArchived: boolean;
  readonly status: TradeStatus;
  readonly systemStatus: SystemStatus;

  readonly symbol: string;
  readonly direction: TradeDirection;
  readonly timeframe: string | null;
  readonly session: string | null;
  readonly confidence: number | null;
  readonly confirmationNotes: string | null;
  readonly tradingviewUrl: string | null;
  readonly notes: string | null;
  readonly reviewNotes: string | null;
  /** Null means the historical Trade predates explicit emotion capture. */
  readonly emotionsRecordedAt: string | null;
  /**
   * Never the storage key or a URL (Founder review, private-storage
   * correction) — presentation-only presence flag. When `true`, the client
   * renders an `<img>` pointing at the authenticated delivery route
   * (`/api/trades/[tradeId]/chart-attachment`), which re-derives its own
   * session + Workspace authorization independently of this read.
   */
  readonly hasChartAttachment: boolean;
  readonly chartAttachmentUploadedAt: string | null;

  readonly plannedEntry: string | null;
  readonly plannedStop: string | null;
  readonly plannedTarget: string | null;
  readonly plannedPositionSize: string | null;
  /** Account-currency minor units, in `tradingAccountBaseCurrency` — the Money-mode Plan (migration 0010). */
  readonly plannedRiskMinor: string | null;
  readonly plannedRewardMinor: string | null;
  readonly plannedR: string | null;

  readonly actualResultMode: ActualResultMode | null;
  readonly actualEntry: string | null;
  readonly actualInitialStop: string | null;
  readonly actualPositionSize: string | null;
  readonly actualInitialRiskMinor: string | null;
  readonly actualExit: string | null;
  readonly grossPnlMinor: string | null;
  readonly commissionMinor: string;
  readonly feesMinor: string;
  readonly swapMinor: string;
  readonly netPnlMinor: string | null;
  readonly actualR: string | null;
  readonly traderOutcome: OutcomeValue | null;
  readonly enteredAt: string | null;
  readonly exitedAt: string | null;
  readonly exits: readonly {
    readonly exitId: string;
    readonly sequence: number;
    readonly closedBps: number;
    readonly exitPrice: string | null;
    readonly realizedPnlMinor: string | null;
    readonly exitReason: string | null;
    readonly exitedAt: string;
  }[];
  readonly closedBps: number;
  readonly remainingBps: number;
  readonly realizedRToDate: string | null;

  readonly systemExitPrice: string | null;
  readonly systemResolutionKind: SystemResolutionKind | null;
  readonly systemGrossRInput: string | null;
  readonly systemExitedAt: string | null;
  readonly systemExitReason: SystemExitReason | null;
  readonly systemCostR: string;
  readonly systemR: string | null;
  readonly systemOutcome: OutcomeValue | null;
  readonly systemResolvedAt: string | null;

  readonly setupConditionState: TradeSetupConditionState;
  /** Populated only when `setupConditionState === 'recorded'`; empty otherwise. */
  readonly setupConditionChecks: readonly TradeSetupConditionCheckDetail[];

  readonly ruleChecks: readonly TradeRuleCheckDetail[];
  readonly mistakes: readonly TradeMistakeDetail[];
  /** The nine active, platform-owned mistake types available in the Phase 08 journal UI. */
  readonly mistakeCatalog: readonly TradeMistakeOption[];
  readonly emotions: readonly TradeEmotionOption[];
  readonly emotionCatalog: readonly TradeEmotionOption[];

  readonly createdAt: string;
  readonly updatedAt: string;
}

export type GetTradeDetailResult =
  | { readonly ok: true; readonly trade: TradeDetail }
  | { readonly ok: false; readonly code: 'trade_not_found' };

/**
 * One Trade's full presentation, scoped to the caller's active workspace. A
 * soft-deleted Trade is `trade_not_found`, identically to one that never
 * existed or belongs to another workspace. `tradeId` must already be a
 * validated UUID from the caller — this function still independently scopes
 * every query to the authenticated workspace.
 */
export async function getWorkspaceTradeDetail(tradeId: string): Promise<GetTradeDetailResult> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();

  const [row] = await db
    .select({
      trade: trades,
      tradingAccountName: tradingAccounts.name,
      tradingAccountBaseCurrency: tradingAccounts.baseCurrency,
      tradingAccountIsArchived: tradingAccounts.isArchived,
      strategyVersionName: strategyVersions.name,
      strategyVersionNumber: strategyVersions.versionNumber,
      strategyIsArchived: strategies.isArchived,
      setupVersionName: strategySetupVersions.name,
      setupIsArchived: setups.isArchived,
    })
    .from(trades)
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, trades.tradingAccountId))
    .innerJoin(strategyVersions, eq(strategyVersions.id, trades.strategyVersionId))
    .innerJoin(strategySetupVersions, eq(strategySetupVersions.id, trades.setupVersionId))
    .innerJoin(strategies, eq(strategies.id, trades.strategyId))
    .innerJoin(setups, eq(setups.id, trades.setupId))
    .where(
      and(eq(trades.id, tradeId), eq(trades.workspaceId, workspaceId), isNull(trades.deletedAt)),
    );
  if (row === undefined) return { ok: false, code: 'trade_not_found' };
  const { trade } = row;

  const ruleCheckRows = await db
    .select({
      ruleKey: tradeRuleChecks.ruleKey,
      title: tradeRuleChecks.title,
      category: tradeRuleChecks.category,
      isRequired: tradeRuleChecks.isRequired,
      isPreTradeCheck: tradeRuleChecks.isPreTradeCheck,
      sortOrder: tradeRuleChecks.sortOrder,
      checkStatus: tradeRuleChecks.checkStatus,
      // Internal only — used to derive `scope` below, never returned.
      setupVersionId: strategyRules.setupVersionId,
    })
    .from(tradeRuleChecks)
    .innerJoin(strategyRules, eq(strategyRules.id, tradeRuleChecks.strategyRuleId))
    .where(eq(tradeRuleChecks.tradeId, tradeId))
    .orderBy(asc(tradeRuleChecks.sortOrder));

  const mistakeRows = await db
    .select({
      mistakeTypeId: tradeMistakes.mistakeTypeId,
      key: mistakeTypes.key,
      label: mistakeTypes.label,
      severityAtTime: tradeMistakes.severityAtTime,
      weightAtTime: tradeMistakes.weightAtTime,
      note: tradeMistakes.note,
    })
    .from(tradeMistakes)
    .innerJoin(mistakeTypes, eq(mistakeTypes.id, tradeMistakes.mistakeTypeId))
    .where(eq(tradeMistakes.tradeId, tradeId));

  const mistakeCatalogRows = await db
    .select({
      mistakeTypeId: mistakeTypes.id,
      key: mistakeTypes.key,
      label: mistakeTypes.label,
    })
    .from(mistakeTypes)
    .where(and(eq(mistakeTypes.isSystem, true), eq(mistakeTypes.isArchived, false)))
    .orderBy(asc(mistakeTypes.sortOrder), asc(mistakeTypes.key));

  const emotionRows = await db
    .select({ key: emotionTypes.key, label: emotionTypes.label })
    .from(tradeEmotions)
    .innerJoin(emotionTypes, eq(emotionTypes.id, tradeEmotions.emotionTypeId))
    .where(eq(tradeEmotions.tradeId, tradeId))
    .orderBy(asc(emotionTypes.sortOrder), asc(emotionTypes.key));

  const emotionCatalogRows = await db
    .select({ key: emotionTypes.key, label: emotionTypes.label })
    .from(emotionTypes)
    .where(and(eq(emotionTypes.isSystem, true), eq(emotionTypes.isArchived, false)))
    .orderBy(asc(emotionTypes.sortOrder), asc(emotionTypes.key));

  const exitRows = await db
    .select()
    .from(tradeExits)
    .where(and(eq(tradeExits.tradeId, tradeId), eq(tradeExits.workspaceId, workspaceId)))
    .orderBy(asc(tradeExits.sequence), asc(tradeExits.id));

  // Setup Condition three-state read (§9/§5): this Trade's own immutable
  // snapshot rows (if it has any), plus — only needed to distinguish
  // "not configured" from "not recorded" when there are none — a count of
  // the pinned Setup Version's OWN authoritative Conditions.
  const conditionCheckRows = await db
    .select({
      conditionKey: tradeSetupConditionChecks.conditionKey,
      label: tradeSetupConditionChecks.label,
      sortOrder: tradeSetupConditionChecks.sortOrder,
      checkStatus: tradeSetupConditionChecks.checkStatus,
    })
    .from(tradeSetupConditionChecks)
    .where(eq(tradeSetupConditionChecks.tradeId, tradeId))
    .orderBy(asc(tradeSetupConditionChecks.sortOrder));
  const setupConditionState: TradeSetupConditionState = await (async () => {
    if (conditionCheckRows.length > 0) return 'recorded';
    const [configuredCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(setupConditions)
      .where(eq(setupConditions.setupVersionId, trade.setupVersionId));
    return (configuredCountRow?.count ?? 0) === 0 ? 'not_configured' : 'not_recorded';
  })();
  const realized =
    trade.actualResultMode === null
      ? null
      : composeRealizedActual({
          actualResultMode: trade.actualResultMode,
          direction: trade.direction,
          actualEntry: trade.actualEntry,
          actualInitialStop: trade.actualInitialStop,
          actualInitialRiskMinor: trade.actualInitialRiskMinor,
          exits: exitRows,
        });
  const closedBps = exitRows.reduce((total, exit) => total + exit.closedBps, 0);

  return {
    ok: true,
    trade: {
      tradeId: trade.id,
      tradingAccountId: trade.tradingAccountId,
      tradingAccountName: row.tradingAccountName,
      tradingAccountBaseCurrency: row.tradingAccountBaseCurrency,
      tradingAccountIsArchived: row.tradingAccountIsArchived,
      strategyId: trade.strategyId,
      strategyName: row.strategyVersionName,
      strategyVersionNumber: row.strategyVersionNumber,
      strategyIsArchived: row.strategyIsArchived,
      setupId: trade.setupId,
      setupName: row.setupVersionName,
      setupIsArchived: row.setupIsArchived,
      status: trade.status as TradeStatus,
      systemStatus: trade.systemStatus as SystemStatus,

      symbol: trade.symbol,
      direction: trade.direction as TradeDirection,
      timeframe: trade.timeframe,
      session: trade.session,
      confidence: trade.confidence,
      confirmationNotes: trade.confirmationNotes,
      tradingviewUrl: trade.tradingviewUrl,
      notes: trade.notes,
      reviewNotes: trade.reviewNotes,
      emotionsRecordedAt: dateToIso(trade.emotionsRecordedAt),
      hasChartAttachment: trade.chartAttachmentStorageKey !== null,
      chartAttachmentUploadedAt: dateToIso(trade.chartAttachmentUploadedAt),

      plannedEntry: trade.plannedEntry,
      plannedStop: trade.plannedStop,
      plannedTarget: trade.plannedTarget,
      plannedPositionSize: trade.plannedPositionSize,
      plannedRiskMinor: minorToString(trade.plannedRiskMinor),
      plannedRewardMinor: minorToString(trade.plannedRewardMinor),
      plannedR: trade.plannedR,

      actualResultMode: trade.actualResultMode as ActualResultMode | null,
      actualEntry: trade.actualEntry,
      actualInitialStop: trade.actualInitialStop,
      actualPositionSize: trade.actualPositionSize,
      actualInitialRiskMinor: minorToString(trade.actualInitialRiskMinor),
      actualExit: trade.actualExit,
      grossPnlMinor: minorToString(trade.grossPnlMinor),
      commissionMinor: trade.commissionMinor.toString(),
      feesMinor: trade.feesMinor.toString(),
      swapMinor: trade.swapMinor.toString(),
      netPnlMinor: minorToString(trade.netPnlMinor),
      actualR: trade.actualR,
      traderOutcome: trade.traderOutcome as OutcomeValue | null,
      enteredAt: dateToIso(trade.enteredAt),
      exitedAt: dateToIso(trade.exitedAt),
      exits: exitRows.map((exit) => ({
        exitId: exit.id,
        sequence: exit.sequence,
        closedBps: exit.closedBps,
        exitPrice: exit.exitPrice,
        realizedPnlMinor: minorToString(exit.realizedPnlMinor),
        exitReason: exit.exitReason,
        exitedAt: exit.exitedAt.toISOString(),
      })),
      closedBps,
      remainingBps: 10_000 - closedBps,
      realizedRToDate: realized?.ok ? realized.value.realizedR : null,

      systemExitPrice: trade.systemExitPrice,
      systemResolutionKind: trade.systemResolutionKind as SystemResolutionKind | null,
      systemGrossRInput: trade.systemGrossRInput,
      systemExitedAt: dateToIso(trade.systemExitedAt),
      systemExitReason: trade.systemExitReason as SystemExitReason | null,
      systemCostR: trade.systemCostR,
      systemR: trade.systemR,
      systemOutcome: trade.systemOutcome as OutcomeValue | null,
      systemResolvedAt: dateToIso(trade.systemResolvedAt),

      setupConditionState,
      setupConditionChecks:
        setupConditionState === 'recorded'
          ? conditionCheckRows.map((c) => ({
              conditionKey: c.conditionKey,
              label: c.label,
              sortOrder: c.sortOrder,
              checkStatus: c.checkStatus as SetupConditionCheckStatus,
            }))
          : [],

      ruleChecks: ruleCheckRows.map((r) => ({
        ruleKey: r.ruleKey,
        scope: r.setupVersionId === null ? 'strategy' : 'setup',
        title: r.title,
        category: r.category,
        isRequired: r.isRequired,
        isPreTradeCheck: r.isPreTradeCheck,
        sortOrder: r.sortOrder,
        checkStatus: r.checkStatus as RuleCheckStatus,
      })),
      mistakes: mistakeRows.map((m) => ({
        mistakeTypeId: m.mistakeTypeId,
        key: m.key,
        label: m.label,
        severityAtTime: m.severityAtTime as MistakeSeverity,
        weightAtTime: m.weightAtTime,
        note: m.note,
      })),
      mistakeCatalog: mistakeCatalogRows,
      emotions: emotionRows,
      emotionCatalog: emotionCatalogRows,

      createdAt: trade.createdAt.toISOString(),
      updatedAt: trade.updatedAt.toISOString(),
    },
  };
}

export type GetTradeChartAttachmentKeyResult =
  | { readonly ok: true; readonly storageKey: string }
  | { readonly ok: false; readonly code: 'trade_not_found' | 'no_attachment' };

/**
 * The one lookup behind the authenticated Chart-attachment delivery route
 * (`src/app/api/trades/[tradeId]/chart-attachment/route.ts`) — deliberately
 * separate from `getWorkspaceTradeDetail` (which fetches Rule checks and
 * Mistakes this narrow read never needs). Identical workspace-scoping
 * posture: a Trade belonging to another Workspace, a nonexistent Trade, and
 * a soft-deleted Trade all resolve to the SAME `trade_not_found` — the same
 * privacy-safe denial `getWorkspaceTradeDetail` already establishes, so a
 * caller can never distinguish "not yours" from "doesn't exist" by probing
 * this endpoint. `no_attachment` is returned only once the Trade is already
 * proven to belong to the caller's own Workspace, so it carries no
 * cross-tenant information.
 */
export async function getWorkspaceTradeChartAttachmentKey(
  tradeId: string,
): Promise<GetTradeChartAttachmentKeyResult> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();

  const [row] = await db
    .select({ chartAttachmentStorageKey: trades.chartAttachmentStorageKey })
    .from(trades)
    .where(
      and(eq(trades.id, tradeId), eq(trades.workspaceId, workspaceId), isNull(trades.deletedAt)),
    );
  if (row === undefined) return { ok: false, code: 'trade_not_found' };
  if (row.chartAttachmentStorageKey === null) return { ok: false, code: 'no_attachment' };
  return { ok: true, storageKey: row.chartAttachmentStorageKey };
}

// ---------------------------------------------------------------------------
// Trade-creation selectors
// ---------------------------------------------------------------------------

export interface TradeCreateAccountOption {
  readonly tradingAccountId: string;
  readonly name: string;
  readonly accountMode: string;
  readonly baseCurrency: string;
}

export interface TradeCreateSetupOption {
  readonly setupId: string;
  /** The CURRENT Setup Version's name — a live selector value, not a historical label; see the module doc comment for why Trade list/detail use the pinned name instead. */
  readonly name: string;
  readonly sortOrder: number;
  /** Opaque concurrency guard only; the server still resolves the authoritative Version under lock. */
  readonly conditionSetToken: string;
  readonly conditions: readonly TradeCreateConditionOption[];
}

export interface TradeCreateConditionOption {
  readonly conditionKey: string;
  readonly label: string;
  readonly sortOrder: number;
}

export interface TradeCreateStrategyOption {
  readonly strategyId: string;
  /** The CURRENT Strategy Version's name. */
  readonly name: string;
  readonly currentVersionNumber: number;
  readonly setups: readonly TradeCreateSetupOption[];
}

export interface TradeCreateOptions {
  readonly tradingAccounts: readonly TradeCreateAccountOption[];
  readonly strategies: readonly TradeCreateStrategyOption[];
  readonly emotionCatalog: readonly TradeEmotionOption[];
  /**
   * Not a secret — already implicit in the authenticated session/cookies and
   * used elsewhere client-side (e.g. `/app/strategies?strategy=` links).
   * Exposed here so the client-only Symbol/Timeframe/Session favorites
   * (`localStorage`, Founder-UAT correction slice) can scope their storage
   * key per Workspace instead of leaking across Workspaces sharing one
   * browser.
   */
  readonly workspaceId: string;
  /**
   * Trade-creation Upload's truthful capability check (Founder-UAT Trade
   * Plan UX correction slice §10) — `false` whenever `BLOB_READ_WRITE_TOKEN`
   * is unset, in which case the client hides the Upload option entirely
   * rather than showing a permanently-disabled fake control. See
   * `src/lib/storage/chart-attachment-storage.ts`.
   */
  readonly chartUploadConfigured: boolean;
}

export interface TradeEmotionOption {
  readonly key: string;
  readonly label: string;
}

/**
 * The minimum authenticated read `/app/trades/new` needs: every active
 * (non-archived) Trading Account, and every active Strategy with its active
 * Setups, current-Version-scoped. `strategy_version_id`/`setup_version_id`
 * are NEVER included here — the UI may display a current Version NUMBER, but
 * `createTradeAction` sends only `strategyId`/`setupId`,
 * and `createTrade` resolves and pins the real Version IDs again under lock
 * (this selector's data is a preview, never a trusted write value). A
 * Strategy whose `current_version_id` fails to resolve (only ever legitimate
 * transiently, mid-transaction) is silently excluded from the options list
 * rather than failing the whole selector — unlike `listWorkspaceStrategies`,
 * this read backs an unrelated creation flow that must stay available even
 * if one other Strategy is momentarily malformed.
 *
 * Fixed-count batched queries regardless of how many Strategies/Setups exist
 * (no N+1): accounts, Strategies, current Versions, Setups, current Setup
 * snapshots, then all Conditions for those snapshots.
 */
export async function getTradeCreateOptions(): Promise<TradeCreateOptions> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();

  const accountRows = await db.query.tradingAccounts.findMany({
    where: and(eq(tradingAccounts.workspaceId, workspaceId), eq(tradingAccounts.isArchived, false)),
    orderBy: [asc(tradingAccounts.createdAt), asc(tradingAccounts.id)],
  });
  const emotionCatalog = await db
    .select({ key: emotionTypes.key, label: emotionTypes.label })
    .from(emotionTypes)
    .where(and(eq(emotionTypes.isSystem, true), eq(emotionTypes.isArchived, false)))
    .orderBy(asc(emotionTypes.sortOrder), asc(emotionTypes.key));

  const strategyRows = await db
    .select()
    .from(strategies)
    .where(and(eq(strategies.workspaceId, workspaceId), eq(strategies.isArchived, false)));

  const currentVersionIds = strategyRows
    .map((s) => s.currentVersionId)
    .filter((id): id is string => id !== null);

  const versionRows =
    currentVersionIds.length === 0
      ? []
      : await db
          .select()
          .from(strategyVersions)
          .where(inArray(strategyVersions.id, currentVersionIds));
  const versionById = new Map(versionRows.map((v) => [v.id, v]));

  const strategyIds = strategyRows.map((s) => s.id);
  const setupRows =
    strategyIds.length === 0
      ? []
      : await db
          .select()
          .from(setups)
          .where(and(inArray(setups.strategyId, strategyIds), eq(setups.isArchived, false)));
  const setupIdSet = new Set(setupRows.map((s) => s.id));
  const setupsByStrategyId = new Map<string, typeof setupRows>();
  for (const setup of setupRows) {
    const list = setupsByStrategyId.get(setup.strategyId) ?? [];
    list.push(setup);
    setupsByStrategyId.set(setup.strategyId, list);
  }

  const snapshotRows =
    currentVersionIds.length === 0
      ? []
      : await db
          .select()
          .from(strategySetupVersions)
          .where(inArray(strategySetupVersions.strategyVersionId, currentVersionIds));
  const snapshotBySetupId = new Map(snapshotRows.map((s) => [s.setupId, s]));
  const snapshotIds = snapshotRows.map((snapshot) => snapshot.id);
  const conditionRows =
    snapshotIds.length === 0
      ? []
      : await db
          .select({
            setupVersionId: setupConditions.setupVersionId,
            conditionKey: setupConditions.conditionKey,
            label: setupConditions.label,
            sortOrder: setupConditions.sortOrder,
          })
          .from(setupConditions)
          .where(
            and(
              eq(setupConditions.workspaceId, workspaceId),
              inArray(setupConditions.setupVersionId, snapshotIds),
            ),
          )
          .orderBy(asc(setupConditions.sortOrder), asc(setupConditions.conditionKey));
  const conditionsBySetupVersionId = new Map<string, TradeCreateConditionOption[]>();
  for (const condition of conditionRows) {
    const list = conditionsBySetupVersionId.get(condition.setupVersionId) ?? [];
    list.push({
      conditionKey: condition.conditionKey,
      label: condition.label,
      sortOrder: condition.sortOrder,
    });
    conditionsBySetupVersionId.set(condition.setupVersionId, list);
  }

  const strategyOptions: TradeCreateStrategyOption[] = [];
  for (const strategy of strategyRows) {
    if (strategy.currentVersionId === null) continue;
    const version = versionById.get(strategy.currentVersionId);
    if (version === undefined) continue;

    const setupOptions: TradeCreateSetupOption[] = [];
    for (const setup of setupsByStrategyId.get(strategy.id) ?? []) {
      if (!setupIdSet.has(setup.id)) continue;
      const snapshot = snapshotBySetupId.get(setup.id);
      if (snapshot === undefined) continue;
      setupOptions.push({
        setupId: setup.id,
        name: snapshot.name,
        sortOrder: snapshot.sortOrder,
        conditionSetToken: createConditionSetToken(snapshot.id),
        conditions: conditionsBySetupVersionId.get(snapshot.id) ?? [],
      });
    }
    setupOptions.sort((a, b) => a.sortOrder - b.sortOrder);

    strategyOptions.push({
      strategyId: strategy.id,
      name: version.name,
      currentVersionNumber: version.versionNumber,
      setups: setupOptions,
    });
  }

  return {
    tradingAccounts: accountRows.map((a) => ({
      tradingAccountId: a.id,
      name: a.name,
      accountMode: a.accountMode,
      baseCurrency: a.baseCurrency,
    })),
    strategies: strategyOptions,
    emotionCatalog,
    workspaceId,
    chartUploadConfigured: isChartAttachmentStorageConfigured(),
  };
}
