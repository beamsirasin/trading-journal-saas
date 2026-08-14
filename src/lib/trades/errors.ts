import type { CalcFailureReason } from '@/lib/calc/types';

/**
 * Stable, non-sensitive domain error codes for the Trade services
 * (`src/server/services/trade-management.ts`, `trade-discipline.ts`) — the
 * Phase 08C Server Action layer's error-mapping input. Never a symbol, note,
 * confirmation text, Rule title, price, risk amount, P&L, R value, cost,
 * TradingView URL, or workspace ID.
 *
 * `read_only_workspace`/`over_limit_workspace` are `MutationDenialReason`
 * values from `@/lib/entitlements/resolve`, reused directly — exactly
 * `src/lib/strategies/errors.ts`'s own posture, for the same reason: every
 * Trade service call is `authorizeWorkspaceMutation(entitlement,
 * 'ordinary_write')`, so no other `MutationDenialReason` member
 * (`trial_expired`, `entitlement_unavailable`, etc.) is ever reachable here.
 */
export const TRADE_DOMAIN_ERROR_CODES = [
  'workspace_access_denied',
  'read_only_workspace',
  'over_limit_workspace',
  'trade_not_found',
  'blank_symbol',
  'invalid_direction',
  'invalid_plan',
  'no_plan_representation',
  'planned_r_mismatch',
  'system_requires_price_plan',
  'trading_account_not_found',
  'trading_account_archived',
  'strategy_not_found',
  'strategy_archived',
  'strategy_current_version_missing',
  'setup_not_found',
  'setup_archived',
  'setup_snapshot_missing',
  'invalid_status_transition',
  'invalid_initial_risk',
  'invalid_exit_time',
  'no_actual_execution',
  'invalid_system_status_transition',
  'invalid_system_exit_reason',
  'rule_check_not_found',
  'invalid_check_status',
  'mistake_type_not_found',
  'mistake_type_not_usable',
] as const;

export type TradeDomainErrorCode = (typeof TRADE_DOMAIN_ERROR_CODES)[number];

export function isTradeDomainErrorCode(value: unknown): value is TradeDomainErrorCode {
  return (
    typeof value === 'string' && (TRADE_DOMAIN_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Phase 08C's closed public error surface. A strict superset of
 * {@link TRADE_DOMAIN_ERROR_CODES} minus the three Zod-catchable codes
 * (`blank_symbol`, `invalid_direction`, `invalid_check_status` — all three
 * are shape checks the strict schema already enforces via `.min(1)`/
 * `z.enum(...)`; the service repeats them only as defense-in-depth, exactly
 * `blank_name`/`blank_title` do for Strategy), folded into `validation_error`,
 * plus three action-layer-only codes (`validation_error`, `unauthenticated`,
 * `unexpected_error`) no service function ever returns itself.
 *
 * Deliberately NO `conflict` code — unlike `src/lib/strategies/errors.ts`'s
 * own admittedly-dead placeholder (its own comment: "should never execute in
 * practice"), no reachable Trade service condition needs that semantic, and
 * this domain does not repeat an unreachable code merely for surface parity.
 */
export const TRADE_PUBLIC_ERROR_CODES = [
  'validation_error',
  'unauthenticated',
  'workspace_access_denied',
  'read_only_workspace',
  'over_limit_workspace',
  'trade_not_found',
  'trading_account_not_found',
  'trading_account_archived',
  'strategy_not_found',
  'strategy_archived',
  'strategy_current_version_missing',
  'setup_not_found',
  'setup_archived',
  'setup_snapshot_missing',
  'invalid_plan',
  'no_plan_representation',
  'planned_r_mismatch',
  'system_requires_price_plan',
  'invalid_status_transition',
  'invalid_initial_risk',
  'invalid_exit_time',
  'no_actual_execution',
  'invalid_system_status_transition',
  'invalid_system_exit_reason',
  'rule_check_not_found',
  'mistake_type_not_found',
  'mistake_type_not_usable',
  'unexpected_error',
] as const;

export type TradePublicErrorCode = (typeof TRADE_PUBLIC_ERROR_CODES)[number];

export function isTradePublicErrorCode(value: unknown): value is TradePublicErrorCode {
  return (
    typeof value === 'string' && (TRADE_PUBLIC_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Maps a service result code — {@link TradeDomainErrorCode} or a
 * `MutationDenialReason` — to the public surface a Server Action returns.
 * The `default` branch exists for type-level exhaustiveness only; reaching it
 * is reported as `unexpected_error` rather than crashing, the same posture
 * `src/lib/strategies/errors.ts`'s own mapper takes.
 */
export function mapServiceErrorToPublicCode(
  code: TradeDomainErrorCode | string,
): TradePublicErrorCode {
  switch (code) {
    case 'blank_symbol':
    case 'invalid_direction':
    case 'invalid_check_status':
      return 'validation_error';
    case 'workspace_access_denied':
    case 'read_only_workspace':
    case 'over_limit_workspace':
    case 'trade_not_found':
    case 'trading_account_not_found':
    case 'trading_account_archived':
    case 'strategy_not_found':
    case 'strategy_archived':
    case 'strategy_current_version_missing':
    case 'setup_not_found':
    case 'setup_archived':
    case 'setup_snapshot_missing':
    case 'invalid_plan':
    case 'no_plan_representation':
    case 'planned_r_mismatch':
    case 'system_requires_price_plan':
    case 'invalid_status_transition':
    case 'invalid_initial_risk':
    case 'invalid_exit_time':
    case 'no_actual_execution':
    case 'invalid_system_status_transition':
    case 'invalid_system_exit_reason':
    case 'rule_check_not_found':
    case 'mistake_type_not_found':
    case 'mistake_type_not_usable':
      return code;
    default:
      return 'unexpected_error';
  }
}

type FieldErrors = Readonly<Record<string, readonly string[]>>;

/**
 * `invalid_plan`'s field-specific detail, for the Plan/identity-correction
 * operations (`createTrade`, `updateTradePlan`, `correctTradeIdentity`) —
 * never a duplicated formula, purely a mapping from the calc engine's own
 * closed failure-reason set to which primitive input it concerns. `reason`
 * itself (a stable identifier from `src/lib/calc/types.ts`, never a sentence)
 * is the field-error message content, exactly like a Zod field error's
 * content is a message string a future UI looks up, not raw prose baked in
 * here.
 */
export function mapPlanCalcReasonToFieldErrors(reason: CalcFailureReason): FieldErrors {
  switch (reason) {
    case 'invalid_risk_direction':
    case 'zero_risk':
      return { plannedStop: [reason] };
    case 'invalid_target_direction':
      return { plannedTarget: [reason] };
    case 'invalid_planned_risk':
      return { plannedRiskMinor: [reason] };
    case 'invalid_planned_reward':
      return { plannedRewardMinor: [reason] };
    default:
      return { plannedEntry: [reason] };
  }
}

/**
 * The System-axis equivalent of {@link mapPlanCalcReasonToFieldErrors}, for
 * `resolveSystemTrade`/`correctSystemResolution`. `invalid_risk_direction`/
 * `zero_risk` describe the pinned Plan denominator (`planned_entry`/
 * `planned_stop`), not a field this operation's own input carries — mapped
 * to `plannedStop` anyway since that is the more actionable of the two for a
 * user to go correct (via Plan correction) before retrying System
 * resolution.
 */
export function mapSystemCalcReasonToFieldErrors(reason: CalcFailureReason): FieldErrors {
  switch (reason) {
    case 'invalid_system_cost':
      return { systemCostR: [reason] };
    case 'invalid_risk_direction':
    case 'zero_risk':
      return { plannedStop: [reason] };
    default:
      return { systemExitPrice: [reason] };
  }
}
