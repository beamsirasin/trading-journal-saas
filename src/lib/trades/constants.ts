/**
 * Trade domain constants — framework independent, mirrors the CHECK
 * constraints installed in `drizzle/0008_trade_domain_and_discipline.sql`.
 * Kept in sync by hand, the same pattern
 * `src/lib/strategies/constants.ts` establishes against
 * `strategy_rules_category_check`: the CHECK is the real, database-enforced
 * boundary; these lists are what future service/action/UI code shares so
 * client and server cannot drift on what "valid" means.
 */

export const TRADE_DIRECTIONS = ['long', 'short'] as const;
export type TradeDirection = (typeof TRADE_DIRECTIONS)[number];
export function isTradeDirection(value: unknown): value is TradeDirection {
  return typeof value === 'string' && (TRADE_DIRECTIONS as readonly string[]).includes(value);
}

/**
 * Trade execution lifecycle. Deliberately excludes `invalidated` — a Trade
 * that never should have been taken is represented on the *System* axis
 * (`system_status = 'no_trade'`), never as a Trade-execution state of its
 * own. `canceled` (American spelling, matching the rest of this codebase) is
 * terminal and excluded from Trader metrics by query, not by schema shape.
 */
export const TRADE_STATUSES = ['planned', 'open', 'closed', 'canceled'] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];
export function isTradeStatus(value: unknown): value is TradeStatus {
  return typeof value === 'string' && (TRADE_STATUSES as readonly string[]).includes(value);
}

/**
 * The System axis's own lifecycle, independent of `TRADE_STATUSES`. `pending`
 * (no System R/outcome yet) is distinct from `no_trade` (the approved
 * Strategy/Setup would not have permitted the Trade at all) — collapsing
 * these was the exact stale-design defect Phase 07A's audit found in the
 * original phase-document sketch.
 */
export const SYSTEM_STATUSES = ['pending', 'resolved', 'no_trade'] as const;
export type SystemStatus = (typeof SYSTEM_STATUSES)[number];
export function isSystemStatus(value: unknown): value is SystemStatus {
  return typeof value === 'string' && (SYSTEM_STATUSES as readonly string[]).includes(value);
}

/**
 * `setup_invalidated` is valid only under `system_status = 'no_trade'`; every
 * other value belongs only to `system_status = 'resolved'`. Enforced by
 * `trades_system_status_consistency_check`, not merely by convention.
 * Deliberately no `still_open` — an unresolved System counterfactual is
 * represented by `system_status = 'pending'` with null terminal fields, not
 * by a reason value describing an in-progress market.
 */
export const SYSTEM_EXIT_REASONS = [
  'target_hit',
  'stop_hit',
  'break_even_rule',
  'trailing_exit',
  'time_exit',
  'rule_exit',
  'manual_system_valid_exit',
  'setup_invalidated',
] as const;
export type SystemExitReason = (typeof SYSTEM_EXIT_REASONS)[number];
export function isSystemExitReason(value: unknown): value is SystemExitReason {
  return typeof value === 'string' && (SYSTEM_EXIT_REASONS as readonly string[]).includes(value);
}

/**
 * Shared by `trader_outcome` and `system_outcome` — CLAUDE.md §1's outcome
 * matrix requires both axes to use the same three-value classification,
 * computed independently. `no_trade` is never a member here; it belongs to
 * `system_status`, not to the outcome classification itself.
 */
export const OUTCOME_VALUES = ['win', 'loss', 'break_even'] as const;
export type OutcomeValue = (typeof OUTCOME_VALUES)[number];
export function isOutcomeValue(value: unknown): value is OutcomeValue {
  return typeof value === 'string' && (OUTCOME_VALUES as readonly string[]).includes(value);
}

/**
 * `trade_rule_checks.check_status` — deliberately not a boolean
 * `was_satisfied`. A Rule may be genuinely inapplicable to a given Trade
 * (`not_applicable`) or simply never reviewed (`not_checked`), and collapsing
 * either into a boolean would misrepresent both as "violated."
 */
export const RULE_CHECK_STATUSES = [
  'followed',
  'violated',
  'not_applicable',
  'not_checked',
] as const;
export type RuleCheckStatus = (typeof RULE_CHECK_STATUSES)[number];
export function isRuleCheckStatus(value: unknown): value is RuleCheckStatus {
  return typeof value === 'string' && (RULE_CHECK_STATUSES as readonly string[]).includes(value);
}

/** Shared with `mistake_types.severity` (CLAUDE.md A2). */
export const MISTAKE_SEVERITIES = ['minor', 'moderate', 'severe'] as const;
export type MistakeSeverity = (typeof MISTAKE_SEVERITIES)[number];
export function isMistakeSeverity(value: unknown): value is MistakeSeverity {
  return typeof value === 'string' && (MISTAKE_SEVERITIES as readonly string[]).includes(value);
}

/** `confidence` — a bounded 1–5 rating, never a financial value; plain `number` is safe here. */
export const CONFIDENCE_MIN = 1;
export const CONFIDENCE_MAX = 5;
