import { isContractRow } from './add-trade-contract';
import type { OutcomeValue } from './constants';

/**
 * WHAT ONE TRADE'S RECORD MAY CLAIM ABOUT ITSELF (contract §16, §25, §28).
 *
 * The analytics populations already refuse to mix legacy evidence with
 * canonical figures (`src/server/dal/canonical-analytics-population.ts`). A
 * single Trade's record surfaces — the Trades table, the Details sheet, the
 * Dashboard Quick Preview, the Journal detail — answer the same question one
 * row at a time, and this module is the one place that answers it, so the
 * table and the sheet can never disagree about the same Trade.
 *
 * THE RULE THIS ENFORCES. A contract row (`recording_contract =
 * 'add_trade_v1'`) carries approved Add Trade semantics: its Actual R is
 * measured against Risk at Entry, and its Trader Outcome is whatever the
 * trader selected (Save Closed Trade records it). No trader-confirmed System
 * Result exists yet, so on a contract row:
 *
 * - a stored `trader_outcome` without a selection was DERIVED by the
 *   pre-contract Final Close and must never be shown as the trader's answer;
 * - a stored `system_r` came from the pre-contract System model and must
 *   never stand in for the canonical System Result;
 * - an Execution Gap between the two would compare a canonical Actual R with
 *   a legacy System R — the comparison the whole migration exists to stop.
 *
 * A legacy row keeps its historical meaning and may keep showing it, provided
 * the surface says the evidence is legacy-derived rather than letting it read
 * as an approved Add Trade answer.
 *
 * MISSING IS NEVER NEGATIVE (contract §2, §24). Every unavailable case names
 * its reason so a surface can say why; none of them is `0`, `BE`, or a loss.
 */

export type TradeOutcomeEvidence =
  /** The trader chose this outcome (After Trade, contract §12). */
  | { readonly status: 'selected'; readonly outcome: OutcomeValue }
  /** A legacy row's historical classification, derived from R or P&L sign. */
  | { readonly status: 'legacy_derived'; readonly outcome: OutcomeValue }
  | {
      readonly status: 'unavailable';
      /** A contract row whose outcome the trader has not been asked for yet. */
      readonly reason: 'outcome_not_selected' | 'not_recorded';
    };

/**
 * Whether a row's Actual R is legacy R (contract §28): every row recorded
 * before the Add Trade contract measured R against its historical risk or
 * price geometry. Record surfaces mark it rather than show it like canonical R.
 */
export function isLegacyActualR(trade: EvidenceRow & { readonly actualR: string | null }): boolean {
  return !isContractRow(trade) && trade.actualR !== null;
}

export type TradeSystemResultEvidence =
  | { readonly status: 'canonical'; readonly systemR: string }
  /** A resolved pre-contract System result: real evidence, not an approved System Result. */
  | { readonly status: 'legacy_derived'; readonly systemR: string }
  | {
      readonly status: 'unavailable';
      readonly reason: 'no_canonical_system_result' | 'not_resolved';
    };

export type TradeExecutionGapEvidence =
  | { readonly status: 'legacy_derived'; readonly executionGapR: string }
  | {
      readonly status: 'unavailable';
      readonly reason: 'no_canonical_system_result' | 'not_comparable';
    };

interface EvidenceRow {
  readonly recordingContract: string | null;
}

/**
 * The Trader Outcome a record surface may present.
 *
 * On a contract row only the trader's own choice is an outcome (contract §12):
 * After Trade records it as selected. A contract row closed by the
 * pre-contract Final Close still stores a DERIVED outcome, which is never
 * shown as an answer — it reads as not yet selected until Final Close asks the
 * trader.
 */
export function tradeOutcomeEvidence(
  trade: EvidenceRow & {
    readonly traderOutcome: OutcomeValue | null;
    readonly traderOutcomeSelected: boolean;
  },
): TradeOutcomeEvidence {
  if (isContractRow(trade)) {
    return trade.traderOutcomeSelected && trade.traderOutcome !== null
      ? { status: 'selected', outcome: trade.traderOutcome }
      : { status: 'unavailable', reason: 'outcome_not_selected' };
  }
  if (trade.traderOutcome === null) return { status: 'unavailable', reason: 'not_recorded' };
  return { status: 'legacy_derived', outcome: trade.traderOutcome };
}

/**
 * The System Result a record surface may present.
 *
 * No canonical System Result exists anywhere yet (the trader-confirmed System
 * Assessment is unimplemented), so a contract row has none — the same fact
 * `canonicalSystemConditions()` states for analytics. A legacy row's resolved
 * System R stays visible as legacy evidence.
 */
export function tradeSystemResultEvidence(
  trade: EvidenceRow & {
    readonly systemStatus: string;
    readonly systemR: string | null;
  },
): TradeSystemResultEvidence {
  if (isContractRow(trade)) return { status: 'unavailable', reason: 'no_canonical_system_result' };
  if (trade.systemStatus !== 'resolved' || trade.systemR === null) {
    return { status: 'unavailable', reason: 'not_resolved' };
  }
  return { status: 'legacy_derived', systemR: trade.systemR };
}

/**
 * The per-Trade Execution Gap a record surface may present.
 *
 * `Actual R − System R` is only meaningful when both sides mean the same
 * thing. On a contract row the Actual side is canonical and the System side
 * is legacy, so there is no Gap to show — not a zero, and not the subtraction
 * done anyway.
 */
export function tradeExecutionGapEvidence(
  trade: EvidenceRow & {
    readonly systemStatus: string;
    readonly systemR: string | null;
    readonly executionGapR: string | null;
  },
): TradeExecutionGapEvidence {
  if (isContractRow(trade)) return { status: 'unavailable', reason: 'no_canonical_system_result' };
  if (trade.executionGapR === null) return { status: 'unavailable', reason: 'not_comparable' };
  return { status: 'legacy_derived', executionGapR: trade.executionGapR };
}
