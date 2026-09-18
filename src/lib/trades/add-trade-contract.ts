/**
 * ADD TRADE CONTRACT v1 — shared vocabulary for contract-era Trade rows.
 *
 * A Trade with `recording_contract = 'add_trade_v1'` carries the approved Add
 * Trade semantics (docs/product-contracts/add-trade.md). Every other row is
 * legacy and keeps its historical meaning; nothing here converts one into the
 * other.
 *
 * Pure: no I/O. Shared by the Zod boundary, services and UI.
 */

import type { ExitHistoryCompleteness, OutcomeValue } from './constants';

export const RECORDING_CONTRACT_ADD_TRADE_V1 = 'add_trade_v1' as const;
export type RecordingContract = typeof RECORDING_CONTRACT_ADD_TRADE_V1;

/** NULL / absent is Unanswered. */
export const TARGET_STATES = ['fixed', 'no_fixed'] as const;
export type TargetState = (typeof TARGET_STATES)[number];

/** At Entry writes `matched` or `different`; `unknown` is the After Trade "Don't know". */
export const ACTUAL_RISK_ANSWERS = ['matched', 'different', 'unknown'] as const;
export type ActualRiskAnswer = (typeof ACTUAL_RISK_ANSWERS)[number];

/** NULL / absent is Not recorded. */
export const EXIT_PLAN_STATES = ['saved', 'customized', 'no_rule'] as const;
export type ExitPlanState = (typeof EXIT_PLAN_STATES)[number];

/** `strategy_default` = inherited without an explicit choice; `selected` = the trader's choice. */
export const EXIT_PLAN_PROVENANCES = ['strategy_default', 'selected'] as const;
export type ExitPlanProvenance = (typeof EXIT_PLAN_PROVENANCES)[number];

export const CAPTURE_ORIGINS = [
  'recorded_at_entry',
  'recorded_during_trade',
  'recalled_after_trade',
] as const;
export type CaptureOrigin = (typeof CAPTURE_ORIGINS)[number];

export const ENTERED_AT_SOURCES = ['default_now', 'trader'] as const;
export type EnteredAtSource = (typeof ENTERED_AT_SOURCES)[number];

export function isContractRow(trade: { readonly recordingContract: string | null }): boolean {
  return trade.recordingContract === RECORDING_CONTRACT_ADD_TRADE_V1;
}

/**
 * THE ACTUAL R DENOMINATOR.
 *
 * A contract row measures Actual R against Risk at Entry, the common 1R
 * baseline (contract §4): Actual Risk is Risk Discipline evidence and never
 * redefines Actual R. A legacy row keeps its historical denominator,
 * `actual_initial_risk_minor`, so its stored R is never silently rewritten.
 */
export function actualRDenominatorMinor(trade: {
  readonly recordingContract: string | null;
  readonly plannedRiskMinor: bigint | null;
  readonly actualInitialRiskMinor: bigint | null;
}): bigint | null {
  return isContractRow(trade) ? trade.plannedRiskMinor : trade.actualInitialRiskMinor;
}

/**
 * THE STORED ACTUAL RISK AMOUNT for a contract write (contract §4).
 *
 * Matched copies Risk at Entry; Different keeps the stated amount, or NULL
 * when the amount is unknown; Don't know and Unanswered store no amount. It is
 * Risk Discipline evidence only — never the Actual R denominator.
 */
export function contractActualRiskMinor(params: {
  readonly answer: ActualRiskAnswer | undefined;
  readonly riskAtEntryMinor: bigint | null;
  readonly statedMinor: bigint | null;
}): bigint | null {
  if (params.answer === 'matched') return params.riskAtEntryMinor;
  if (params.answer === 'different') return params.statedMinor;
  return null;
}

/**
 * A TRADER-SELECTED OUTCOME SURVIVES RECALCULATION (contract §12, §22).
 *
 * Writers that recompute Actual R after an edit may also re-derive the legacy
 * outcome. Once the trader has chosen Win / BE / Loss, that choice is kept
 * whatever the new P&L or R — only a derived outcome follows the numbers.
 */
export function recalculatedTraderOutcome(
  trade: {
    readonly traderOutcome: string | null;
    readonly traderOutcomeSelectedAt: Date | null;
  },
  derived: OutcomeValue | null,
): OutcomeValue | null {
  return trade.traderOutcomeSelectedAt !== null
    ? (trade.traderOutcome as OutcomeValue | null)
    : derived;
}

/**
 * A CLOSED CONTRACT ROW WITH A STATED RESULT — Save Closed Trade's record,
 * whose outcome is the trader's own or still Unanswered (never derived). Its
 * Final Net P&L is what the trader stated; live exit and execution
 * corrections, which rebuild the result from exit legs, never apply to it.
 */
export function hasStatedClosedResult(trade: {
  readonly recordingContract: string | null;
  readonly status: string;
  readonly traderOutcome: string | null;
  readonly traderOutcomeSelectedAt?: Date | null;
  readonly traderOutcomeSelected?: boolean;
}): boolean {
  if (!isContractRow(trade) || trade.status !== 'closed') return false;
  const selected =
    trade.traderOutcomeSelected === true ||
    (trade.traderOutcomeSelectedAt !== undefined && trade.traderOutcomeSelectedAt !== null);
  return selected || trade.traderOutcome === null;
}

/**
 * THE QUIET SIGN NOTICE (contract §12; UX Rules §7.7). Only Win beside a
 * negative Final Net P&L, or Loss beside a positive one. BE never carries it,
 * and an unknown P&L never does.
 */
export function traderOutcomeContradictsPnl(
  outcome: OutcomeValue | null,
  finalNetPnlMinor: bigint | null,
): boolean {
  if (outcome === null || finalNetPnlMinor === null) return false;
  return (
    (outcome === 'win' && finalNetPnlMinor < 0n) || (outcome === 'loss' && finalNetPnlMinor > 0n)
  );
}

export interface ExitHistoryReconciliation {
  /** The recorded exit subtotal — only when every recorded exit carries P&L. */
  readonly subtotalMinor: bigint | null;
  /** "Use recorded exits as final result" may be offered (contract §11). */
  readonly adoptable: boolean;
  /** A discrepancy in the contract's sense: Complete, fully priced, and different. */
  readonly discrepancy: boolean;
}

/**
 * EXIT HISTORY AGAINST FINAL NET P&L (contract §11).
 *
 * Adoption and discrepancy both need an explicitly Complete history in which
 * every recorded exit has P&L. With Incomplete, Unknown or Unanswered history,
 * a difference between the two figures is not a discrepancy, and the subtotal
 * is not offered as the final result. Neither figure is ever overwritten here.
 */
export function reconcileExitHistory(params: {
  readonly completeness: ExitHistoryCompleteness | null;
  readonly exitPnlMinor: readonly (bigint | null)[];
  readonly finalNetPnlMinor: bigint | null;
}): ExitHistoryReconciliation {
  const everyExitPriced =
    params.exitPnlMinor.length > 0 && params.exitPnlMinor.every((pnl) => pnl !== null);
  const subtotalMinor = everyExitPriced
    ? params.exitPnlMinor.reduce<bigint>((sum, pnl) => sum + (pnl ?? 0n), 0n)
    : null;
  const complete = params.completeness === 'complete' && subtotalMinor !== null;
  return {
    subtotalMinor,
    adoptable: complete && subtotalMinor !== params.finalNetPnlMinor,
    discrepancy:
      complete && params.finalNetPnlMinor !== null && subtotalMinor !== params.finalNetPnlMinor,
  };
}

/**
 * The origin of an answer supplied for the first time AFTER creation:
 * during the trade while it is still open, recalled once it has closed
 * (contract §7, §9). A `planned` legacy row has no entry yet and counts as
 * during the trade.
 */
export function laterCaptureOrigin(status: string): CaptureOrigin {
  return status === 'closed' || status === 'canceled'
    ? 'recalled_after_trade'
    : 'recorded_during_trade';
}
