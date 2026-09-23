/**
 * PLAN OUTCOME — what the trader's original plan would have produced
 * (Add Trade contract decision 55; UX Rules §20.4).
 *
 * A FACTUAL OBSERVATION, NOT A SYSTEM ASSESSMENT. It is recorded in Stage 6
 * (After Trade) as capture evidence: which boundary the price reached first
 * under the plan the trader recorded, or what the recorded Exit Plan would
 * have produced. Review's System Assessment (`trade_system_assessments`) may
 * read it later, but keeps its own confirmation, Net / Gross and adherence
 * semantics; nothing here writes or implies a System Assessment.
 *
 * FOUR ANSWERS AND AN ABSENCE. `null` is Unanswered — never Cannot Determine,
 * and never a loss.
 *
 *   planned_target_first   The plan's Fixed Target was reached first.
 *   planned_risk_first     The plan's planned risk (the stop) was reached first.
 *   exit_plan_result       The recorded rule-based Exit Plan, followed, would
 *                          have produced a stated amount.
 *   cannot_determine       The trader cannot establish it — a complete answer.
 *
 * NEVER INFERRED from Final Net P&L, the Trader Outcome, exit legs or any
 * price. The plan decides which question may be asked; only the trader's
 * answer decides the outcome.
 */

export const PLAN_OUTCOMES = [
  'planned_target_first',
  'planned_risk_first',
  'exit_plan_result',
  'cannot_determine',
] as const;
export type PlanOutcome = (typeof PLAN_OUTCOMES)[number];

export function isPlanOutcome(value: unknown): value is PlanOutcome {
  return typeof value === 'string' && (PLAN_OUTCOMES as readonly string[]).includes(value);
}

/** The recorded plan facts the question depends on — nothing else. */
export interface PlanOutcomePlan {
  /** Risk at Entry in minor units; present only for a Defined Risk. */
  readonly plannedRiskMinor: bigint | null;
  /** The explicit decision: `defined`, `no_defined`, or NULL (Unanswered / historical). */
  readonly plannedRiskState: 'defined' | 'no_defined' | null;
  readonly targetState: 'fixed' | 'no_fixed' | null;
  /** Target Profit in minor units, when the Fixed Target was recorded as money. */
  readonly plannedRewardMinor: bigint | null;
  readonly exitPlanState: 'saved' | 'customized' | 'no_rule' | null;
}

/**
 * WHICH QUESTION THE PLAN ALLOWS.
 *
 *   bounded            Defined Risk + Fixed Target: the plan is bounded by
 *                      its 1R and its target, so "what happened first?" is
 *                      answerable and its result follows from the plan.
 *   exit_plan          Defined Risk + a recorded rule-based Exit Plan without
 *                      a Fixed Target: the Exit Plan decides the exit, so the
 *                      trader states what it would have produced.
 *   no_defined_risk    The trader said no 1R was defined: no R comparison can
 *                      exist, and no denominator is ever invented.
 *   risk_not_recorded  No 1R is on record (Unanswered): the same, said as it is.
 *   unavailable        Defined Risk but neither a Fixed Target nor a usable
 *                      Exit Plan: there is no plan outcome to establish.
 *
 * A Fixed Target takes precedence over an Exit Plan: when both are recorded,
 * the plan is bounded by the target and the stop.
 */
export type PlanOutcomeCase =
  'bounded' | 'exit_plan' | 'no_defined_risk' | 'risk_not_recorded' | 'unavailable';

export function planOutcomeCase(plan: PlanOutcomePlan): PlanOutcomeCase {
  if (plan.plannedRiskState === 'no_defined') return 'no_defined_risk';
  if (plan.plannedRiskMinor === null || plan.plannedRiskMinor <= 0n) return 'risk_not_recorded';
  if (plan.targetState === 'fixed') return 'bounded';
  if (plan.exitPlanState === 'saved' || plan.exitPlanState === 'customized') return 'exit_plan';
  return 'unavailable';
}

/** The answers each case offers. The other cases ask nothing. */
export function planOutcomeChoices(kind: PlanOutcomeCase): readonly PlanOutcome[] {
  switch (kind) {
    case 'bounded':
      return ['planned_target_first', 'planned_risk_first', 'cannot_determine'];
    case 'exit_plan':
      return ['exit_plan_result', 'cannot_determine'];
    default:
      return [];
  }
}

/**
 * WHETHER AN ANSWER NEEDS A STATED AMOUNT. An Exit Plan result always does.
 * Target first does only when the Fixed Target has no Target Profit (a TP
 * price alone): Price never calculates a result, so the trader states what the
 * target would have paid. Everything else is derived or has no amount.
 */
export function planOutcomeNeedsAmount(outcome: PlanOutcome, plan: PlanOutcomePlan): boolean {
  if (outcome === 'exit_plan_result') return true;
  if (outcome === 'planned_target_first') return plan.plannedRewardMinor === null;
  return false;
}

export type PlanOutcomeAnswerError =
  | 'plan_outcome_not_applicable'
  | 'plan_outcome_amount_required'
  | 'plan_outcome_amount_not_allowed'
  | 'plan_outcome_amount_invalid';

/**
 * THE ONE WRITE RULE, shared by the form and the server. An answer is valid
 * only where the current plan offers it; a stated amount exists exactly when
 * the answer needs one; a target reached first is a positive amount.
 */
export function validatePlanOutcomeAnswer(
  outcome: PlanOutcome,
  amountMinor: bigint | null,
  plan: PlanOutcomePlan,
): PlanOutcomeAnswerError | null {
  if (!planOutcomeChoices(planOutcomeCase(plan)).includes(outcome)) {
    return 'plan_outcome_not_applicable';
  }
  const needs = planOutcomeNeedsAmount(outcome, plan);
  if (needs && amountMinor === null) return 'plan_outcome_amount_required';
  if (!needs && amountMinor !== null) return 'plan_outcome_amount_not_allowed';
  if (outcome === 'planned_target_first' && amountMinor !== null && amountMinor <= 0n) {
    return 'plan_outcome_amount_invalid';
  }
  return null;
}
