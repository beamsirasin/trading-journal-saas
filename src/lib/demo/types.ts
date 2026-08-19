/**
 * Demo fixture types.
 *
 * Everything in `src/lib/demo/` is STATIC PRESENTATION DATA for Phase 01. It
 * is fictional, it is labelled as such wherever it renders, and it is never
 * computed — no formula in this directory, ever.
 *
 * That restriction is deliberate. Real metrics live in Phase 07's
 * calculation engine (`src/lib/calc/`), and a plausible-looking formula
 * written here to make a demo chart move would become a second, untested
 * implementation of the thing the product is actually about. Literal values
 * cannot drift from a spec they do not implement.
 *
 * Representation follows the production contract (CLAUDE.md §5) even though
 * the public demo itself is static:
 *
 *   - monetary amounts  -> `Money` (bigint minor units + ISO 4217 code)
 *   - R-multiples       -> strings, as `NUMERIC(12,4)` will read back
 *   - percentages       -> strings, already rounded for display
 *   - timestamps        -> ISO 8601 with an explicit offset
 */

import type { Money } from '@/lib/money';

export type DemoRangeId = '30d' | '90d' | 'all';

export interface DemoRange {
  readonly id: DemoRangeId;
  readonly label: string;
  /** Announced to assistive tech alongside the short label. */
  readonly description: string;
}

export interface DemoAccount {
  readonly id: string;
  readonly name: string;
  readonly broker: string;
  readonly currency: 'USD';
}

/**
 * Outcome is a stored field on both axes, never inferred from profit
 * (CLAUDE.md §1). All four quadrants of the outcome matrix appear in the
 * fixture set, including the two that a conventional journal cannot express.
 */
export type DemoOutcome = 'win' | 'loss' | 'break_even';

export type DemoDirection = 'long' | 'short';

export interface DemoTrade {
  readonly id: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly direction: DemoDirection;
  readonly strategy: string;
  readonly strategyVersion: string;
  /** ISO 8601 with an explicit offset — `parseInstant` rejects anything else. */
  readonly closedAt: string;
  readonly systemOutcome: DemoOutcome;
  readonly actualOutcome: DemoOutcome;
  readonly systemR: string;
  readonly actualR: string;
  readonly net: Money;
  readonly mistakes: readonly string[];
  /** Present on some trades only — attaching a chart is optional. */
  readonly chartUrl?: string;
}

/**
 * The attribution metric set. System and actual are parallel and independent:
 * the whole product is the gap between the two columns.
 */
export interface DemoAttribution {
  readonly systemWinRatePct: string;
  readonly actualWinRatePct: string;
  readonly systemAvgR: string;
  readonly actualAvgR: string;
  readonly systemExpectancyR: string;
  readonly actualExpectancyR: string;
  readonly systemProfitFactor: string;
  readonly actualProfitFactor: string;
  readonly systemTotalR: string;
  readonly actualTotalR: string;
  readonly systemMaxDrawdownR: string;
  readonly actualMaxDrawdownR: string;
  /** actualTotalR − systemTotalR (Phase 13H sign). Negative means the Trader captured less than the System; positive means the Trader outperformed the System. */
  readonly executionGapR: string;
  readonly executionEfficiencyPct: string;
  readonly disciplineScore: string;
}

export interface DemoEquityPoint {
  readonly label: string;
  readonly systemR: string;
  readonly actualR: string;
}

export type DemoSeverity = 'minor' | 'moderate' | 'severe';

export interface DemoMistake {
  readonly id: string;
  readonly label: string;
  readonly severity: DemoSeverity;
  readonly occurrences: number;
  /** Cost in R, always positive. Ranked by cost, never by frequency. */
  readonly costR: string;
}

export interface DemoBundle {
  readonly range: DemoRangeId;
  readonly closedTrades: number;
  readonly netPnl: Money;
  readonly attribution: DemoAttribution;
  /**
   * Weekly samples of cumulative R. A weekly sample cannot show an intra-week
   * trough, so the max-drawdown figures in `attribution` are legitimately
   * deeper than this series dips — that is how per-trade drawdown works, and
   * the chart says so in its caption.
   */
  readonly equityCurve: readonly DemoEquityPoint[];
  readonly mistakes: readonly DemoMistake[];
}
