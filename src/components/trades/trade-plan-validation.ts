import { isValidTradingViewUrl } from '@/lib/trades/validation';

/**
 * Pure, framework-independent validation/navigation rules for the Trade
 * creation wizard — no React, no translation. `TradeCreateForm` translates
 * the returned error CODES and never re-derives the rules itself, so the
 * clickable stepper and the Continue button can never disagree about which
 * steps are reachable (Founder-UAT correction slice requirement).
 *
 * Money fields (`plannedRiskMinor`/`plannedRewardMinor`) are validated here
 * only for DECIMAL SHAPE — the same non-negative-decimal check Price fields
 * get. Real minor-unit/currency-precision parsing (`parseTradeMoneyInput`,
 * `src/components/trades/trade-form-values.ts`) needs a currency code this
 * module deliberately does not depend on, and happens once, at submit time,
 * exactly like every other money field in this domain (the correction
 * dialogs never validate money shape per keystroke either).
 */

export type PlanStage = 0 | 1 | 2 | 3;
export const PLAN_STAGES: readonly PlanStage[] = [0, 1, 2, 3];

export interface PlanValidationValues {
  readonly tradingAccountId: string;
  readonly strategyId: string;
  readonly setupId: string;
  readonly symbol: string;
  readonly direction: string;
  readonly plannedEntry: string;
  readonly plannedStop: string;
  readonly plannedTarget: string;
  readonly plannedPositionSize: string;
  readonly plannedRiskMinor: string;
  readonly plannedRewardMinor: string;
  readonly tradingviewUrl: string;
}

export type PlanFieldKey =
  | 'tradingAccountId'
  | 'strategyId'
  | 'setupId'
  | 'symbol'
  | 'direction'
  | 'plannedEntry'
  | 'plannedStop'
  | 'plannedTarget'
  | 'plannedPositionSize'
  | 'plannedRiskMinor'
  | 'plannedRewardMinor'
  | 'tradingviewUrl';

export type PlanErrorCode =
  | 'required_account'
  | 'setup_requires_strategy'
  | 'required_symbol'
  | 'required_direction'
  | 'required_entry'
  | 'required_stop'
  | 'invalid_decimal'
  | 'incomplete_price_plan'
  | 'incomplete_money_plan'
  | 'invalid_tradingview_url';

export type PlanErrorMap = Partial<Record<PlanFieldKey, PlanErrorCode>>;

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

/**
 * Cumulative errors for every field required to consider `stage` itself
 * complete — stage N's result is a strict superset of stage N-1's checks.
 * This monotonicity is what makes {@link furthestReachableStage} well-defined
 * as "the first stage that fails its own check."
 *
 * Price and Money are independent, both-optional Plan representations
 * (Founder-UAT correction slice, migration 0010) — neither Entry/Stop nor
 * Risk is required, and neither being present at all is valid (Phase 14C.1
 * — Quick Capture Persistence Completion: Trading Account + Symbol +
 * Direction alone is a sufficient, persistable Trade). What IS enforced:
 *   - Entry/Stop arrive as a complete pair or not at all;
 *   - a Target requires that pair;
 *   - a Reward requires a Risk.
 * This mirrors `applyPlanShapeRefinements` in `src/lib/trades/schemas.ts`
 * exactly, so client and server validation can never quietly diverge on
 * what "a valid Plan" means.
 *
 * Strategy/Setup are optional (Phase 14C, following Phase 14B's persistence
 * change) — never `required_*`. The one shape rule kept is Setup requiring
 * Strategy, mirroring `trades_setup_requires_strategy_check` and
 * `CreateTradeSchema`'s `setup_requires_strategy` refine exactly, so client
 * and server can never quietly diverge on that either.
 */
export function stageErrors(stage: PlanStage, values: PlanValidationValues): PlanErrorMap {
  const errors: PlanErrorMap = {};

  if (stage >= 0 && values.tradingAccountId === '') errors.tradingAccountId = 'required_account';

  if (stage >= 1) {
    if (values.setupId !== '' && values.strategyId === '') {
      errors.setupId = 'setup_requires_strategy';
    }
  }

  if (stage >= 2) {
    if (values.symbol.trim() === '') errors.symbol = 'required_symbol';
    if (values.direction === '') errors.direction = 'required_direction';

    const entryProvided = values.plannedEntry.trim() !== '';
    const stopProvided = values.plannedStop.trim() !== '';
    const targetProvided = values.plannedTarget.trim() !== '';
    const riskProvided = values.plannedRiskMinor.trim() !== '';
    const rewardProvided = values.plannedRewardMinor.trim() !== '';

    if (entryProvided !== stopProvided) {
      if (!entryProvided) errors.plannedEntry = 'required_entry';
      if (!stopProvided) errors.plannedStop = 'required_stop';
    } else if (entryProvided && stopProvided) {
      if (!DECIMAL_PATTERN.test(values.plannedEntry.trim()))
        errors.plannedEntry = 'invalid_decimal';
      if (!DECIMAL_PATTERN.test(values.plannedStop.trim())) errors.plannedStop = 'invalid_decimal';
    }

    if (targetProvided) {
      if (!entryProvided || !stopProvided) errors.plannedTarget = 'incomplete_price_plan';
      else if (!DECIMAL_PATTERN.test(values.plannedTarget.trim()))
        errors.plannedTarget = 'invalid_decimal';
    }
    if (
      values.plannedPositionSize.trim() !== '' &&
      !DECIMAL_PATTERN.test(values.plannedPositionSize.trim())
    ) {
      errors.plannedPositionSize = 'invalid_decimal';
    }

    if (riskProvided && !DECIMAL_PATTERN.test(values.plannedRiskMinor.trim())) {
      errors.plannedRiskMinor = 'invalid_decimal';
    }
    if (rewardProvided) {
      if (!riskProvided) errors.plannedRewardMinor = 'incomplete_money_plan';
      else if (!DECIMAL_PATTERN.test(values.plannedRewardMinor.trim()))
        errors.plannedRewardMinor = 'invalid_decimal';
    }

    if (
      values.tradingviewUrl.trim() !== '' &&
      !isValidTradingViewUrl(values.tradingviewUrl.trim())
    ) {
      errors.tradingviewUrl = 'invalid_tradingview_url';
    }
  }

  return errors;
}

export function isStageComplete(stage: PlanStage, values: PlanValidationValues): boolean {
  return Object.keys(stageErrors(stage, values)).length === 0;
}

/**
 * The first stage (in order) whose own required fields are not yet
 * satisfied — every stage at or before this index is reachable; every stage
 * after it is not, because its prerequisites are unmet.
 */
export function furthestReachableStage(values: PlanValidationValues): PlanStage {
  if (!isStageComplete(0, values)) return 0;
  if (!isStageComplete(1, values)) return 1;
  if (!isStageComplete(2, values)) return 2;
  return 3;
}

/**
 * The single rule shared by the clickable stepper and the Continue button:
 * a stage is only ever navigable — forward OR backward — when every stage
 * before it is complete. Backward navigation always satisfies this by
 * construction (a user cannot reach `stage` without having completed every
 * earlier one), so this needs no special-casing per direction.
 */
export function canNavigateToStage(target: PlanStage, values: PlanValidationValues): boolean {
  return target <= furthestReachableStage(values);
}
