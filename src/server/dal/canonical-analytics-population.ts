import 'server-only';

import { and, eq, isNotNull, isNull, not, or, sql, type SQL } from 'drizzle-orm';

import type { LegacyAnalyticsCoverage } from '@/lib/analytics/canonical-population';
import { RECORDING_CONTRACT_ADD_TRADE_V1 } from '@/lib/trades/add-trade-contract';
import type { OutcomeValue } from '@/lib/trades/constants';
import { getDb } from '@/server/db/client';
import { trades } from '@/server/db/schema';

/**
 * THE ONE SQL DEFINITION OF CANONICAL ANALYTICS ELIGIBILITY.
 *
 * See `src/lib/analytics/canonical-population.ts` for the product rules. Every
 * canonical R/outcome/System read composes these instead of writing its own
 * completeness clause, so the definition cannot drift between the Dashboard,
 * Analytics, the Calendar, Day Review and the insight pillars.
 *
 * NOT `entryContextAnalyticsEligible`. That predicate asks whether a Trade's
 * entry-time context was captured before it closed; this one asks whether its
 * numbers use the approved definitions. They are independent questions and a
 * behavioural read applies both.
 */

/**
 * A closed Trade with an Actual R, before canonical eligibility — shared with
 * the coverage count. A final exit time is NOT part of it: After Trade may save
 * a closed Trade without one (contract §13), and it still belongs in every
 * figure that does not need a time. A date range still excludes it, because
 * `exited_at >= start` is never true for NULL — see `selectUndatedClosedCount`.
 */
function actualCompleteConditions(): SQL[] {
  return [eq(trades.status, 'closed'), isNotNull(trades.actualR)];
}

/** A resolved System result, before canonical eligibility — shared with the coverage count. */
function systemCompleteConditions(): SQL[] {
  return [
    eq(trades.systemStatus, 'resolved'),
    isNotNull(trades.systemR),
    isNotNull(trades.systemOutcome),
  ];
}

/**
 * Actual R measured against Risk at Entry: a contract row, Money result, whose
 * Final Net P&L the trader stated (`final_pnl_source`, written by Save Closed
 * Trade and by the contract Final Close). A contract row closed by the legacy
 * live close has an R from a net P&L derived from its exit legs and no
 * `final_pnl_source`; that R is legacy evidence and counts in coverage only
 * (contract §11, §28). A row with no Actual R passes, so its selected outcome
 * still reaches the outcome figures.
 *
 * NULL-SAFE ON PURPOSE. A legacy row's `recording_contract` is NULL, so a plain
 * `=` evaluates to NULL rather than false, and `NOT (NULL)` is NULL too — which
 * would silently drop every legacy row from the coverage count below.
 */
function canonicalActualR(): SQL {
  return sql`(${trades.recordingContract} IS NOT DISTINCT FROM ${RECORDING_CONTRACT_ADD_TRADE_V1}
    AND ${trades.actualResultMode} IS NOT DISTINCT FROM 'money'
    AND (${trades.finalPnlSource} IS NOT NULL OR ${trades.actualR} IS NULL))`;
}

/**
 * No stored System result is canonical yet (the trader-confirmed System
 * Assessment is not implemented). Written as a predicate rather than an early
 * return so every System read keeps its shape and simply admits nothing, and
 * so the migration that adds canonical evidence changes exactly this line.
 */
function canonicalSystemResult(): SQL {
  return sql`false`;
}

/** Canonical Actual population: a complete Actual R under the approved definition. Outcome is NOT required. */
export function canonicalActualConditions(): SQL[] {
  return [...actualCompleteConditions(), canonicalActualR()];
}

/** The canonical Actual population a day or a timeline can place: it also needs a final exit time. */
export function canonicalDatedActualConditions(): SQL[] {
  return [...canonicalActualConditions(), isNotNull(trades.exitedAt)];
}

/**
 * THE CANONICAL TRADER POPULATION (contract §25). Two kinds of evidence share
 * it: an Actual R (for R figures) and a trader-selected outcome (for Win Rate
 * and outcome counts). A closed contract Trade with a selected outcome and no
 * Risk at Entry has no R and still counts in the outcome figures, so either
 * admits a row; each figure then reads only the rows that carry its evidence.
 */
export function canonicalTraderConditions(): SQL[] {
  return [
    eq(trades.status, 'closed'),
    canonicalActualR(),
    or(isNotNull(trades.actualR), isNotNull(trades.traderOutcomeSelectedAt)) as SQL,
  ];
}

/** Canonical System population: admits nothing until canonical System Results exist. */
export function canonicalSystemConditions(): SQL[] {
  return [...systemCompleteConditions(), canonicalSystemResult()];
}

/**
 * The Trader Outcome canonical analytics may read for a row: only one the
 * trader selected on a contract row (contract §12, §25). A derived outcome —
 * every legacy row, and a contract row closed by the pre-contract Final Close —
 * reads as NULL, which keeps the Trade's Actual R in every R metric while
 * leaving it out of outcome metrics. Unanswered is NULL too, never a loss.
 */
export function canonicalTraderOutcome(): SQL<OutcomeValue | null> {
  return sql<OutcomeValue | null>`(case when ${trades.recordingContract} is not distinct from ${RECORDING_CONTRACT_ADD_TRADE_V1}
    and ${trades.traderOutcomeSelectedAt} is not null then ${trades.traderOutcome} end)`;
}

/**
 * The System R canonical analytics may read beside a canonical Actual R:
 * none, for the same reason `canonicalSystemResult` admits nothing. Used by
 * reads that fetch both axes from one row, so a legacy System R can never pair
 * with a canonical Actual R.
 */
export function canonicalSystemR(): null {
  return null;
}

/**
 * CLOSED TRADES WITH NO FINAL EXIT TIME (contract §13). Counted so a figure
 * that could not place them — a date range, a calendar day, the equity curve —
 * says so rather than quietly showing fewer Trades.
 */
export async function selectUndatedClosedCount(scope: readonly SQL[]): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trades)
    .where(and(...scope, eq(trades.status, 'closed'), isNull(trades.exitedAt)));
  return row?.count ?? 0;
}

/**
 * How many Trades in scope canonical analytics left out as legacy evidence.
 *
 * `scope` is the caller's framework + not-deleted conditions; each axis adds
 * its own date gate, exactly as the populations it discloses are gated. A
 * Trade excluded on both axes is counted once per axis, because the figures it
 * is missing from are different figures.
 */
export async function selectLegacyAnalyticsCoverage(params: {
  readonly scope: readonly SQL[];
  readonly actualDate: readonly SQL[];
  readonly systemDate: readonly SQL[];
}): Promise<LegacyAnalyticsCoverage> {
  // `actualDate` is empty exactly when no date range is active.
  const db = getDb();
  const [row] = await db
    .select({
      excludedActualCount: sql<number>`count(*) filter (where ${and(
        ...actualCompleteConditions(),
        ...params.actualDate,
        not(canonicalActualR()),
      )})::int`,
      excludedSystemCount: sql<number>`count(*) filter (where ${and(
        ...systemCompleteConditions(),
        ...params.systemDate,
        not(canonicalSystemResult()),
      )})::int`,
    })
    .from(trades)
    .where(and(...params.scope));
  return {
    excludedActualCount: row?.excludedActualCount ?? 0,
    excludedSystemCount: row?.excludedSystemCount ?? 0,
    undatedClosedCount: await selectUndatedClosedCount(params.scope),
    dateRangeActive: params.actualDate.length > 0,
  };
}
