/**
 * PLAN OUTCOME RESULT — the money and R the trader's original plan would have
 * produced, from their recorded Plan Outcome answer (Add Trade contract
 * decision 55). Pure; no I/O.
 *
 *   planned_target_first   amount = the stated amount, else Target Profit
 *                          R      = amount / Risk at Entry
 *   planned_risk_first     amount = −Risk at Entry
 *                          R      = −1R exactly
 *   exit_plan_result       amount = the stated amount
 *                          R      = amount / Risk at Entry
 *   cannot_determine       no amount, no R
 *
 * DERIVED WHEN READ, NOT STORED. Target first and risk first record WHICH
 * boundary came first; their amounts follow from the plan as it is now, so a
 * later correction of Risk at Entry or Target Profit is never contradicted by
 * a stale copy. Only a stated amount is stored.
 *
 * NEVER A NET / GROSS CLAIM. These are the plan's own figures, not a
 * confirmed System Assessment result; Review decides comparability there.
 *
 * Risk at Entry is the one R baseline (contract §4), so a plan with no Defined
 * Risk has no R here — never an invented denominator.
 */

import {
  planOutcomeCase,
  planOutcomeChoices,
  type PlanOutcome,
  type PlanOutcomePlan,
} from '@/lib/trades/plan-outcome';

import { bigintToCalcDecimal, toCanonicalR } from './decimal';

export type PlanOutcomeResult =
  | {
      readonly status: 'known';
      readonly outcome: Exclude<PlanOutcome, 'cannot_determine'>;
      readonly amountMinor: bigint;
      /** `NUMERIC(12,4)`-shaped R against Risk at Entry. */
      readonly r: string;
      /** Where the amount came from: the plan, or the trader's own statement. */
      readonly amountSource: 'plan' | 'stated';
    }
  | { readonly status: 'cannot_determine' }
  | { readonly status: 'unanswered' }
  /** An answer recorded against a plan that has since changed shape. */
  | { readonly status: 'plan_changed'; readonly outcome: PlanOutcome };

export function planOutcomeResult(
  outcome: PlanOutcome | null,
  statedAmountMinor: bigint | null,
  plan: PlanOutcomePlan,
): PlanOutcomeResult {
  if (outcome === null) return { status: 'unanswered' };
  if (!planOutcomeChoices(planOutcomeCase(plan)).includes(outcome)) {
    return { status: 'plan_changed', outcome };
  }
  if (outcome === 'cannot_determine') return { status: 'cannot_determine' };

  // `bounded` and `exit_plan` both guarantee a positive Risk at Entry.
  const risk = plan.plannedRiskMinor as bigint;
  if (outcome === 'planned_risk_first') {
    return {
      status: 'known',
      outcome,
      amountMinor: -risk,
      r: toCanonicalR(bigintToCalcDecimal(-1n)),
      amountSource: 'plan',
    };
  }
  const amount =
    statedAmountMinor ?? (outcome === 'planned_target_first' ? plan.plannedRewardMinor : null);
  if (amount === null) return { status: 'plan_changed', outcome };
  return {
    status: 'known',
    outcome,
    amountMinor: amount,
    r: toCanonicalR(bigintToCalcDecimal(amount).dividedBy(bigintToCalcDecimal(risk))),
    amountSource: statedAmountMinor === null ? 'plan' : 'stated',
  };
}
