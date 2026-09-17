import 'server-only';

import { and, eq, isNotNull, not, sql, type SQL } from 'drizzle-orm';

import type { LegacyAnalyticsCoverage } from '@/lib/analytics/canonical-population';
import { RECORDING_CONTRACT_ADD_TRADE_V1 } from '@/lib/trades/add-trade-contract';
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

/** A closed Trade with a complete Actual R, before canonical eligibility — shared with the coverage count. */
function actualCompleteConditions(): SQL[] {
  return [eq(trades.status, 'closed'), isNotNull(trades.actualR), isNotNull(trades.exitedAt)];
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
 * Actual R measured against Risk at Entry: a contract row, Money result.
 *
 * NULL-SAFE ON PURPOSE. A legacy row's `recording_contract` is NULL, so a plain
 * `=` evaluates to NULL rather than false, and `NOT (NULL)` is NULL too — which
 * would silently drop every legacy row from the coverage count below.
 */
function canonicalActualR(): SQL {
  return sql`(${trades.recordingContract} IS NOT DISTINCT FROM ${RECORDING_CONTRACT_ADD_TRADE_V1}
    AND ${trades.actualResultMode} IS NOT DISTINCT FROM 'money')`;
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

/** Canonical System population: admits nothing until canonical System Results exist. */
export function canonicalSystemConditions(): SQL[] {
  return [...systemCompleteConditions(), canonicalSystemResult()];
}

/**
 * The Trader Outcome canonical analytics may read for a row: none. No column
 * records an outcome the trader chose, and a derived outcome must never be
 * counted as one (contract §25). Returning `null` keeps the Trade's Actual R in
 * every R metric while removing it from outcome metrics only.
 */
export function canonicalTraderOutcome(): null {
  return null;
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
  };
}
