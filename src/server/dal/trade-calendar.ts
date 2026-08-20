import 'server-only';

import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';

import { totalR } from '@/lib/calc/aggregate';
import { calendarDateIn, type CalendarDate } from '@/lib/time';
import { getActiveWorkspaceContext } from '@/server/auth/dal';
import { occurredAtExpr } from '@/server/dal/trades';
import { getDb } from '@/server/db/client';
import { trades } from '@/server/db/schema';

/**
 * Trading Calendar (Phase 14D) reads. Two independent axes, matching
 * `src/server/dal/analytics.ts`'s `dateConditions` precedent exactly:
 * Trader buckets by `exited_at`, System buckets by `system_exited_at` — never
 * the same column, never forced into intersection. Both axes are computed in
 * ONE month-bounded fetch per axis (never the whole history — CLAUDE.md/Phase
 * 14D §24), then bucketed by LOCAL calendar day in application code via
 * `calendarDateIn` (never a raw SQL `date_trunc`, which would implicitly use
 * a server/UTC-relative day boundary — the exact naive-UTC-bucketing this
 * phase's brief forbids).
 */

export interface TradeCalendarDayBucket {
  readonly date: CalendarDate;
  /** `totalR` over every finalized result that local day — never fabricated when zero results exist (a day is only ever present here when count > 0). */
  readonly totalR: string;
  readonly count: number;
}

export interface WorkspaceTradeCalendarMonth {
  readonly year: number;
  readonly month: number;
  /** Sparse — only days with at least one finalized Actual result appear. */
  readonly trader: readonly TradeCalendarDayBucket[];
  /** Sparse — only days with at least one resolved System result appear. */
  readonly system: readonly TradeCalendarDayBucket[];
  /** `null` when no Trader-eligible Trade finalized this month — never a fabricated `0`. */
  readonly traderTotalR: string | null;
  /** `null` when no System-eligible Trade resolved this month. */
  readonly systemTotalR: string | null;
  /** Distinct local calendar days with at least one Trader OR System result this month. */
  readonly tradingDays: number;
}

export interface GetWorkspaceTradeCalendarMonthParams {
  readonly year: number;
  readonly month: number;
  readonly timezone: string;
  readonly tradingAccountId?: string;
  /** Pre-resolved half-open `[start, end)` UTC bound for this month, in `timezone` — see `src/lib/time`'s `monthRangeIn`. Resolving timezone is the caller's job; this DAL never converts timezones itself. */
  readonly monthRange: { readonly start: Date; readonly end: Date };
}

function bucketByLocalDay(
  rows: readonly { readonly at: Date; readonly r: string }[],
  timezone: string,
): readonly TradeCalendarDayBucket[] {
  const byDate = new Map<CalendarDate, string[]>();
  for (const row of rows) {
    const resolved = calendarDateIn(row.at, timezone);
    if (!resolved.ok) continue; // Defensive only — `timezone` is already validated by the caller's own resolution step.
    const existing = byDate.get(resolved.value);
    if (existing === undefined) byDate.set(resolved.value, [row.r]);
    else existing.push(row.r);
  }
  const buckets: TradeCalendarDayBucket[] = [];
  for (const [date, values] of byDate) {
    const summed = totalR(values);
    if (summed.ok) buckets.push({ date, totalR: summed.value, count: values.length });
  }
  return buckets.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * One calendar month's Trader and System day buckets, workspace-scoped
 * (never a client-supplied `workspaceId`), optionally Account-scoped. Two
 * bounded queries (never the whole Trade history) — a month's row count is
 * inherently small, so bucketing/summing happens in application code with
 * `decimal.js`-backed `totalR`, matching CLAUDE.md §5's money/R precision
 * rule, rather than trusting a raw SQL `SUM(numeric)`.
 */
export async function getWorkspaceTradeCalendarMonth(
  params: GetWorkspaceTradeCalendarMonthParams,
): Promise<WorkspaceTradeCalendarMonth> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();
  const { start, end } = params.monthRange;

  const scope = [eq(trades.workspaceId, workspaceId), isNull(trades.deletedAt)];
  if (params.tradingAccountId !== undefined) {
    scope.push(eq(trades.tradingAccountId, params.tradingAccountId));
  }

  const [traderRows, systemRows] = await Promise.all([
    db
      .select({ at: trades.exitedAt, r: trades.actualR })
      .from(trades)
      .where(
        and(
          ...scope,
          eq(trades.status, 'closed'),
          gte(trades.exitedAt, start),
          lt(trades.exitedAt, end),
        ),
      ),
    db
      .select({ at: trades.systemExitedAt, r: trades.systemR })
      .from(trades)
      .where(
        and(
          ...scope,
          eq(trades.systemStatus, 'resolved'),
          gte(trades.systemExitedAt, start),
          lt(trades.systemExitedAt, end),
        ),
      ),
  ]);

  // `status = 'closed'` / `system_status = 'resolved'` guarantee `exited_at`/
  // `actual_r` and `system_exited_at`/`system_r` are non-null respectively
  // (`trades_status_consistency_check`/`trades_system_status_consistency_check`)
  // — the filter cast is defensive typing only, never a runtime possibility.
  const traderInput = traderRows
    .filter((row): row is { at: Date; r: string } => row.at !== null && row.r !== null)
    .map((row) => ({ at: row.at, r: row.r }));
  const systemInput = systemRows
    .filter((row): row is { at: Date; r: string } => row.at !== null && row.r !== null)
    .map((row) => ({ at: row.at, r: row.r }));

  const trader = bucketByLocalDay(traderInput, params.timezone);
  const system = bucketByLocalDay(systemInput, params.timezone);

  const traderTotal = totalR(traderInput.map((row) => row.r));
  const systemTotal = totalR(systemInput.map((row) => row.r));

  const tradingDays = new Set([...trader.map((b) => b.date), ...system.map((b) => b.date)]).size;

  return {
    year: params.year,
    month: params.month,
    trader,
    system,
    traderTotalR: traderTotal.ok ? traderTotal.value : null,
    systemTotalR: systemTotal.ok ? systemTotal.value : null,
    tradingDays,
  };
}

export interface WorkspaceTradeDaySummary {
  /**
   * Sum of finalized Actual R for Trades whose `exited_at` falls on this
   * local day — `null` when none finalized (never a fabricated `0`).
   */
  readonly actualR: string | null;
  /** Sum of resolved System R for Trades whose `system_exited_at` falls on this local day — independent of `actualR`'s population; see the module doc comment. */
  readonly systemR: string | null;
  /**
   * Every count below shares ONE population: Trades whose journal
   * chronology (`coalesce(exited_at, entered_at, created_at)` — the exact
   * expression `listWorkspaceTrades` already sorts/paginates by) falls on
   * this local day. This is deliberately the SAME population the filtered
   * Trade Log below the Calendar shows, regardless of which Trader/System
   * axis is currently selected in the Calendar view (Phase 14D §9) — so
   * `trades`, `open`, `pendingSystem`, and `unclassified` are always exactly
   * "how many of the Trades in today's Log are open/pending/unclassified,"
   * never a different, axis-scoped population.
   */
  readonly trades: number;
  readonly open: number;
  readonly pendingSystem: number;
  readonly unclassified: number;
}

export interface GetWorkspaceTradeDaySummaryParams {
  readonly tradingAccountId?: string;
  /** Pre-resolved half-open `[start, end)` UTC bound for the selected local day — see `src/lib/time`'s `dayRangeIn`. */
  readonly dayRange: { readonly start: Date; readonly end: Date };
}

/**
 * The Calendar's selected-day summary — two independent-axis R sums plus one
 * batched `count(*) filter (where …)` aggregate over the Log's own
 * journal-chronology population (`occurredAtExpr`, imported from
 * `trades.ts` — never hand-duplicated), workspace- (and optionally
 * Account-) scoped identically to `getWorkspaceTradeCalendarMonth` and
 * `getWorkspaceTradeAttentionCounts`. See {@link WorkspaceTradeDaySummary}
 * for the exact, load-bearing population rule each field follows.
 */
export async function getWorkspaceTradeDaySummary(
  params: GetWorkspaceTradeDaySummaryParams,
): Promise<WorkspaceTradeDaySummary> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();
  const { start, end } = params.dayRange;

  const scope = [eq(trades.workspaceId, workspaceId), isNull(trades.deletedAt)];
  if (params.tradingAccountId !== undefined) {
    scope.push(eq(trades.tradingAccountId, params.tradingAccountId));
  }

  const [actualRows, systemRows, [logRow]] = await Promise.all([
    db
      .select({ r: trades.actualR })
      .from(trades)
      .where(
        and(
          ...scope,
          eq(trades.status, 'closed'),
          gte(trades.exitedAt, start),
          lt(trades.exitedAt, end),
        ),
      ),
    db
      .select({ r: trades.systemR })
      .from(trades)
      .where(
        and(
          ...scope,
          eq(trades.systemStatus, 'resolved'),
          gte(trades.systemExitedAt, start),
          lt(trades.systemExitedAt, end),
        ),
      ),
    db
      .select({
        trades: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${trades.status} = 'open')::int`,
        pendingSystem: sql<number>`count(*) filter (where ${trades.systemStatus} = 'pending')::int`,
        unclassified: sql<number>`count(*) filter (where ${trades.strategyId} is null)::int`,
      })
      .from(trades)
      .where(
        and(
          ...scope,
          sql`${occurredAtExpr} >= ${start.toISOString()}::timestamptz`,
          sql`${occurredAtExpr} < ${end.toISOString()}::timestamptz`,
        ),
      ),
  ]);

  const actualR = totalR(
    actualRows.filter((row): row is { r: string } => row.r !== null).map((row) => row.r),
  );
  const systemR = totalR(
    systemRows.filter((row): row is { r: string } => row.r !== null).map((row) => row.r),
  );

  return {
    actualR: actualR.ok ? actualR.value : null,
    systemR: systemR.ok ? systemR.value : null,
    trades: logRow?.trades ?? 0,
    open: logRow?.open ?? 0,
    pendingSystem: logRow?.pendingSystem ?? 0,
    unclassified: logRow?.unclassified ?? 0,
  };
}
