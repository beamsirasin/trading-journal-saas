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
 * - **Canonical Trader Outcome** is the outcome the trader CHOSE. No stored
 *   column records a chosen outcome yet — every `trader_outcome` today, contract
 *   rows included, was derived from R on close — so canonical analytics read no
 *   outcome at all. Win Rate and the other outcome metrics are unavailable,
 *   never 0% and never a loss, until Final Close records the trader's choice.
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

/** How much evidence canonical analytics left out because it uses legacy definitions. */
export interface LegacyAnalyticsCoverage {
  /** Closed Trades in scope whose Actual R is legacy R, so they are not in R figures. */
  readonly excludedActualCount: number;
  /** Resolved System results in scope, all legacy today, so they are not in System figures. */
  readonly excludedSystemCount: number;
}

export const NO_LEGACY_EXCLUSIONS: LegacyAnalyticsCoverage = {
  excludedActualCount: 0,
  excludedSystemCount: 0,
};

export function hasLegacyExclusions(coverage: LegacyAnalyticsCoverage): boolean {
  return coverage.excludedActualCount > 0 || coverage.excludedSystemCount > 0;
}
