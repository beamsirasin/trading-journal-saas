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
