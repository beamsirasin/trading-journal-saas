/**
 * A CHOSEN ANSWER WHOSE SOURCE WENT AWAY (Add Trade contract §2, §5, §7).
 *
 * A draft keeps the Strategy, Setup or saved Exit Plan the trader chose by its
 * id. If that item is archived or removed before Save, the id no longer
 * resolves against the offered options — and reading that as Unanswered or
 * Not recorded would silently turn an explicit answer into no answer.
 *
 * So the answer is kept in the draft, shown as no longer available, and Save
 * waits until the trader resolves it explicitly: choose another, or remove the
 * answer. Nothing is chosen for them. (A saved plan cannot be snapshotted once
 * archived — the server refuses it — so "keep it anyway" is not an option.)
 *
 * Pure: shared by At Entry and After Trade, whose drafts hold the same shapes.
 */
import type { TradeCreateOptions } from '@/server/dal/trades';

import type { AnswerState, ExitPlanDraft } from './at-entry-draft';

export interface StaleSelectionInput {
  readonly classification: {
    readonly strategy: AnswerState;
    readonly strategyId: string;
    readonly setupByStrategy: Readonly<
      Record<string, { readonly answer: AnswerState; readonly setupId: string }>
    >;
  };
  readonly exitPlan: ExitPlanDraft;
}

export interface StaleSelections {
  readonly strategy: boolean;
  readonly setup: boolean;
  readonly exitPlan: boolean;
}

export function staleSelections(
  draft: StaleSelectionInput,
  options: Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>,
): StaleSelections {
  const { classification } = draft;
  const strategy =
    classification.strategy === 'selected'
      ? (options.strategies.find((item) => item.strategyId === classification.strategyId) ?? null)
      : null;
  const strategyStale = classification.strategy === 'selected' && strategy === null;
  const setupAnswer =
    classification.strategy === 'selected'
      ? classification.setupByStrategy[classification.strategyId]
      : undefined;
  const setupStale =
    strategy !== null &&
    setupAnswer?.answer === 'selected' &&
    !strategy.setups.some((setup) => setup.setupId === setupAnswer.setupId);
  const { choice } = draft.exitPlan;
  const exitPlanStale =
    choice.kind === 'saved' &&
    !options.exitPlans.some((plan) => plan.exitPlanId === choice.exitPlanId);
  return { strategy: strategyStale, setup: setupStale, exitPlan: exitPlanStale };
}

export function hasStaleSelection(stale: StaleSelections): boolean {
  return stale.strategy || stale.setup || stale.exitPlan;
}

/** The select value standing for a kept answer whose option is no longer offered. */
export const UNAVAILABLE_OPTION = '__unavailable__';
