import {
  planOutcomeCase,
  planOutcomeChoices,
  planOutcomeNeedsAmount,
  type PlanOutcome,
  type PlanOutcomePlan,
} from '@/lib/trades/plan-outcome';

import { parseTradeMoneyInput } from './trade-form-values';

/**
 * THE PLAN OUTCOME AS TYPED — one answer and, where the plan cannot derive
 * one, the amount the trader states (Add Trade contract decision 55).
 *
 * `outcome: null` is Unanswered: nothing is saved for it, and it is never
 * Cannot Determine. The typed amount is kept through a change of answer, as
 * other drafts keep a typed value, but only an answer that needs an amount
 * ever sends one.
 */
export interface PlanOutcomeDraft {
  readonly outcome: PlanOutcome | null;
  readonly amount: string;
}

export const UNANSWERED_PLAN_OUTCOME: PlanOutcomeDraft = { outcome: null, amount: '' };

export function choosePlanOutcome(
  draft: PlanOutcomeDraft,
  outcome: PlanOutcome | null,
): PlanOutcomeDraft {
  return { ...draft, outcome };
}

export function setPlanOutcomeAmount(draft: PlanOutcomeDraft, amount: string): PlanOutcomeDraft {
  return { ...draft, amount };
}

export type PlanOutcomeDraftError =
  /** The answer was given against a plan that has since changed shape. */
  | 'plan_outcome_stale'
  | 'plan_outcome_amount_required'
  | 'plan_outcome_invalid_money'
  | 'plan_outcome_amount_positive';

export type ResolvedPlanOutcome =
  | {
      readonly ok: true;
      /** `null`: Unanswered — send nothing. */
      readonly value: { readonly outcome: PlanOutcome; readonly amountMinor: string | null } | null;
    }
  | { readonly ok: false; readonly error: PlanOutcomeDraftError };

/**
 * What a Save would send, checked by the same rule the server applies. An
 * answer the current plan no longer offers is never silently dropped: it waits
 * for the trader to answer again or remove it.
 */
export function resolvePlanOutcomeDraft(
  draft: PlanOutcomeDraft,
  plan: PlanOutcomePlan,
  currency: string,
): ResolvedPlanOutcome {
  const { outcome } = draft;
  if (outcome === null) return { ok: true, value: null };
  if (!planOutcomeChoices(planOutcomeCase(plan)).includes(outcome)) {
    return { ok: false, error: 'plan_outcome_stale' };
  }
  if (!planOutcomeNeedsAmount(outcome, plan)) {
    return { ok: true, value: { outcome, amountMinor: null } };
  }
  if (draft.amount.trim() === '') return { ok: false, error: 'plan_outcome_amount_required' };
  const parsed = parseTradeMoneyInput(draft.amount, currency, {
    allowNegative: outcome === 'exit_plan_result',
    allowZero: outcome === 'exit_plan_result',
  });
  if (!parsed.ok) {
    return {
      ok: false,
      error:
        parsed.code === 'negative_not_allowed' || parsed.code === 'zero_not_allowed'
          ? 'plan_outcome_amount_positive'
          : 'plan_outcome_invalid_money',
    };
  }
  return { ok: true, value: { outcome, amountMinor: parsed.value } };
}

/** The saved answer, read back into a draft for the trader to change. */
export function planOutcomeDraftOf(
  outcome: PlanOutcome | null,
  amountInput: string,
): PlanOutcomeDraft {
  return { outcome, amount: amountInput };
}
