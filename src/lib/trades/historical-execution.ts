import { composeTraderClose } from '@/lib/calc/trade';
import type { CalcFailureReason } from '@/lib/calc/types';

import type { ExitHistoryCompleteness, FinalPnlSource, OutcomeValue } from './constants';

/** The minimum monetary evidence needed by the historical transition model. */
export interface HistoricalExitEvidence {
  readonly realizedPnlMinor: bigint | null;
}

/**
 * Persisted facts which decide ownership of a historical closed Money result.
 * Reconciliation and eligibility are deliberately derived from this state.
 */
export interface HistoricalExecutionState {
  readonly actualInitialRiskMinor: bigint | null;
  readonly finalPnlMinor: bigint | null;
  readonly finalPnlSource: FinalPnlSource | null;
  readonly exitHistoryCompleteness: ExitHistoryCompleteness | null;
  readonly exits: readonly HistoricalExitEvidence[];
}

export type HistoricalReconciliationStatus =
  'not_recorded' | 'unreconciled' | 'matched' | 'conflict' | 'not_applicable';

export interface HistoricalExecutionSnapshot {
  readonly actualR: string | null;
  readonly traderOutcome: OutcomeValue | null;
  readonly calcVersion?: number;
  readonly exitSubtotalMinor: bigint | null;
  readonly reconciliation: HistoricalReconciliationStatus;
  readonly canAdoptExitSubtotal: boolean;
}

export type HistoricalExecutionTransition =
  | {
      readonly ok: true;
      readonly state: HistoricalExecutionState;
      readonly snapshot: HistoricalExecutionSnapshot;
    }
  | {
      readonly ok: false;
      readonly code:
        'exit_history_not_adoptable' | 'historical_exit_conflict' | 'invalid_execution_context';
      readonly calcReason?: CalcFailureReason;
    };

/** Exact minor-unit subtotal. Unknown when there are no legs or any leg is unpriced. */
export function historicalExitSubtotal(exits: readonly HistoricalExitEvidence[]): bigint | null {
  if (exits.length === 0) return null;
  let subtotal = 0n;
  for (const exit of exits) {
    if (exit.realizedPnlMinor === null) return null;
    subtotal += exit.realizedPnlMinor;
  }
  return subtotal;
}

export function deriveHistoricalReconciliation(
  state: HistoricalExecutionState,
): HistoricalReconciliationStatus {
  if (state.exits.length === 0) return 'not_recorded';
  if (state.exitHistoryCompleteness !== 'complete') return 'unreconciled';
  const subtotal = historicalExitSubtotal(state.exits);
  if (subtotal === null || state.finalPnlMinor === null) return 'not_applicable';
  return subtotal === state.finalPnlMinor ? 'matched' : 'conflict';
}

function outcomeOf(finalPnlMinor: bigint): OutcomeValue {
  if (finalPnlMinor === 0n) return 'break_even';
  return finalPnlMinor > 0n ? 'win' : 'loss';
}

function deriveActual(
  finalPnlMinor: bigint | null,
  actualInitialRiskMinor: bigint | null,
):
  | {
      readonly ok: true;
      readonly actualR: string | null;
      readonly traderOutcome: OutcomeValue | null;
      readonly calcVersion?: number;
    }
  | { readonly ok: false; readonly calcReason: CalcFailureReason } {
  if (finalPnlMinor === null) {
    return { ok: true, actualR: null, traderOutcome: null };
  }
  if (actualInitialRiskMinor === null) {
    return { ok: true, actualR: null, traderOutcome: outcomeOf(finalPnlMinor) };
  }
  const calculated = composeTraderClose(finalPnlMinor, actualInitialRiskMinor);
  if (!calculated.ok) return { ok: false, calcReason: calculated.reason };
  return { ok: true, ...calculated.value };
}

export function deriveHistoricalExecutionSnapshot(
  state: HistoricalExecutionState,
): HistoricalExecutionSnapshot {
  const actual = deriveActual(state.finalPnlMinor, state.actualInitialRiskMinor);
  if (!actual.ok) {
    throw new Error(`Invalid historical execution state: ${actual.calcReason}`);
  }
  const subtotal = historicalExitSubtotal(state.exits);
  return {
    actualR: actual.actualR,
    traderOutcome: actual.traderOutcome,
    exitSubtotalMinor: subtotal,
    reconciliation: deriveHistoricalReconciliation(state),
    canAdoptExitSubtotal:
      state.exitHistoryCompleteness === 'complete' &&
      subtotal !== null &&
      state.finalPnlMinor === null &&
      state.finalPnlSource === null,
  };
}

function completeTransition(state: HistoricalExecutionState): HistoricalExecutionTransition {
  const actual = deriveActual(state.finalPnlMinor, state.actualInitialRiskMinor);
  if (!actual.ok) {
    return { ok: false, code: 'invalid_execution_context', calcReason: actual.calcReason };
  }
  return {
    ok: true,
    state,
    snapshot: {
      ...actual,
      exitSubtotalMinor: historicalExitSubtotal(state.exits),
      reconciliation: deriveHistoricalReconciliation(state),
      canAdoptExitSubtotal:
        state.exitHistoryCompleteness === 'complete' &&
        historicalExitSubtotal(state.exits) !== null &&
        state.finalPnlMinor === null &&
        state.finalPnlSource === null,
    },
  };
}

/** Explicitly makes one complete, fully priced history the canonical final result. */
export function adoptHistoricalExitSubtotal(
  state: HistoricalExecutionState,
): HistoricalExecutionTransition {
  const view = deriveHistoricalExecutionSnapshot(state);
  if (!view.canAdoptExitSubtotal || view.exitSubtotalMinor === null) {
    return { ok: false, code: 'exit_history_not_adoptable' };
  }
  return completeTransition({
    ...state,
    finalPnlMinor: view.exitSubtotalMinor,
    finalPnlSource: 'exit_history',
  });
}

/** A direct whole-Trade edit always takes manual ownership, even on equality. */
export function beginHistoricalManualFinalEdit(
  state: HistoricalExecutionState,
  finalPnlMinor: bigint | null,
): HistoricalExecutionTransition {
  const next: HistoricalExecutionState = {
    ...state,
    finalPnlMinor,
    finalPnlSource: finalPnlMinor === null ? null : 'manual_total',
  };
  if (deriveHistoricalReconciliation(next) === 'conflict') {
    return { ok: false, code: 'historical_exit_conflict' };
  }
  return completeTransition(next);
}

/**
 * Applies the desired supporting history atomically. An adopted result follows a
 * still-complete subtotal; losing that basis freezes the previously accepted
 * final and corrects its provenance to manual ownership.
 */
export function applyHistoricalExitCorrection(
  state: HistoricalExecutionState,
  correction: Pick<HistoricalExecutionState, 'exitHistoryCompleteness' | 'exits'>,
): HistoricalExecutionTransition {
  const nextSubtotal = historicalExitSubtotal(correction.exits);
  let finalPnlMinor = state.finalPnlMinor;
  let finalPnlSource = state.finalPnlSource;

  if (state.finalPnlSource === 'exit_history') {
    if (correction.exitHistoryCompleteness === 'complete' && nextSubtotal !== null) {
      finalPnlMinor = nextSubtotal;
    } else {
      finalPnlSource = state.finalPnlMinor === null ? null : 'manual_total';
    }
  }

  const next: HistoricalExecutionState = {
    ...state,
    exitHistoryCompleteness: correction.exitHistoryCompleteness,
    exits: correction.exits,
    finalPnlMinor,
    finalPnlSource,
  };
  if (deriveHistoricalReconciliation(next) === 'conflict') {
    return { ok: false, code: 'historical_exit_conflict' };
  }
  return completeTransition(next);
}
