/**
 * CANONICAL ANALYTICS POPULATIONS — Add Trade contract §25 and §28.
 *
 * Canonical analytics answer the approved questions under the approved
 * definitions, and never silently combine them with legacy ones:
 *
 * - **Canonical Actual R** is `Final Net P&L / Risk at Entry`. Only a Trade
 *   recorded under the contract (`recording_contract = 'add_trade_v1'`) carries
 *   that definition. Every older row's Actual R used its historical Actual Risk
 *   or Price geometry as 1R, so it is legacy R: kept on the Trade, excluded from
 *   R metrics by default.
 *
 * - **Canonical Trader Outcome** is the outcome the trader CHOSE — today
 *   written by Save Closed Trade (`trader_outcome_selected_at`). A derived
 *   outcome (every legacy row, and a contract row closed by the pre-contract
 *   Final Close) is never read. Outcome metrics need no Actual R: a selected
 *   outcome on a Trade with no Risk at Entry still counts in Win Rate.
 *
 * - **A final exit time is needed only where time is.** A closed Trade saved
 *   without one (contract §13) is in every total; only a date range, a
 *   calendar day, the equity curve and drawdown leave it out, and the coverage
 *   below says how many.
 *
 * - **Canonical System Result** is the trader-confirmed System Result in Money
 *   or R. The System Assessment that produces it is not implemented, so every
 *   resolved System result today — on a legacy row or a contract row — is
 *   legacy System R. No System, paired System-vs-Actual or Execution Gap figure
 *   has eligible evidence yet.
 *
 * The SQL form of these rules lives in
 * `src/server/dal/canonical-analytics-population.ts`; this module holds the
 * shared vocabulary so presentation and composition speak about the same thing.
 */

/** How much evidence canonical analytics left out, and why. */
export interface LegacyAnalyticsCoverage {
  /** Closed Trades in scope whose Actual R is legacy R, so they are not in R figures. */
  readonly excludedActualCount: number;
  /** Resolved System results in scope, all legacy today, so they are not in System figures. */
  readonly excludedSystemCount: number;
  /** Closed Trades in scope with no final exit time (contract §13). */
  readonly undatedClosedCount: number;
  /**
   * A date range is active: undated Trades cannot be placed in it and are in
   * no figure. Without one they are in every total, and only time-ordered
   * figures (equity curve, drawdown, calendar) leave them out.
   */
  readonly dateRangeActive: boolean;
}

export const NO_LEGACY_EXCLUSIONS: LegacyAnalyticsCoverage = {
  excludedActualCount: 0,
  excludedSystemCount: 0,
  undatedClosedCount: 0,
  dateRangeActive: false,
};

export function hasLegacyExclusions(coverage: LegacyAnalyticsCoverage): boolean {
  return (
    coverage.excludedActualCount > 0 ||
    coverage.excludedSystemCount > 0 ||
    coverage.undatedClosedCount > 0
  );
}
