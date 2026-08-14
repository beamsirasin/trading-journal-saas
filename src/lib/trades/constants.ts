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

/**
 * `confidence` — an optional bounded 0–100 integer rating, never a financial
 * value; plain `number` is safe here. Widened from a 1–5 rating in migration
 * 0010 (Founder-UAT Trade Plan UX correction slice); every existing value
 * was backfilled 1→10, 2→30, 3→50, 4→70, 5→90 — the qualitative center of
 * each old bucket — see `drizzle/0010_trade_plan_price_money_confidence.sql`.
 */
export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 100;

/**
 * The five qualitative ranges every Confidence value maps to (locked
 * product copy: Very Low/Low/Neutral/High/Very High), shared by the
 * create-form's interactive control and every read surface (Trade detail,
 * Review step) so the boundary math lives in exactly one place, never
 * re-derived per call site. Boundaries are inclusive of their upper bound —
 * `0` itself is `veryLow`.
 */
export const CONFIDENCE_LEVELS = [
  { key: 'veryLow', max: 20 },
  { key: 'low', max: 40 },
  { key: 'neutral', max: 60 },
  { key: 'high', max: 80 },
  { key: 'veryHigh', max: 100 },
] as const;
export type ConfidenceLevelKey = (typeof CONFIDENCE_LEVELS)[number]['key'];

const VERY_HIGH_LEVEL_KEY: ConfidenceLevelKey = 'veryHigh';

export function confidenceLevelKey(value: number): ConfidenceLevelKey {
  const level = CONFIDENCE_LEVELS.find((candidate) => value <= candidate.max);
  return level?.key ?? VERY_HIGH_LEVEL_KEY;
}

/**
 * `system_exit_reason` values legal on a RESOLVE (`pending -> resolved`, or a
 * `no_trade -> resolved` correction) — `setup_invalidated` is exclusive to
 * `system_status = 'no_trade'` (`trades_system_status_consistency_check`),
 * so it is never a member of this subset. Declared as its own literal tuple
 * (not derived via `.filter()` from {@link SYSTEM_EXIT_REASONS}) so the Zod
 * enum built from it (`src/lib/trades/schemas.ts`) keeps a real const-tuple
 * type rather than widening to `string[]`.
 */
export const RESOLVABLE_SYSTEM_EXIT_REASONS = [
  'target_hit',
  'stop_hit',
  'break_even_rule',
  'trailing_exit',
  'time_exit',
  'rule_exit',
  'manual_system_valid_exit',
] as const;

/**
 * Phase 08C's Zod schema text-length bounds — this domain's equivalent of
 * `src/lib/strategies/constants.ts`'s `STRATEGY_NAME_MAX_LENGTH`/etc. Not DB
 * CHECK-enforced (`trades.symbol`/`notes`/etc. carry no length CHECK), so
 * these bounds exist purely to reject pathological input at the boundary,
 * generous enough never to reject genuine trading data.
 */
export const SYMBOL_MAX_LENGTH = 20;
export const TIMEFRAME_MAX_LENGTH = 20;
export const SESSION_MAX_LENGTH = 40;

/**
 * Founder-UAT correction slice — quick-select SUGGESTIONS only, never a
 * closed enum: `timeframe`/`session` remain free-text columns with no CHECK
 * constraint, and the create-form quick-select control always accepts a
 * custom value. Symbol intentionally has no equivalent constant — the brief
 * is explicit that Symbol suggestions come only from the user's own
 * Favorites/Recents, never a hard-coded assumption about what everyone
 * trades.
 */
export const TIMEFRAME_QUICK_SUGGESTIONS = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const;
export const SESSION_QUICK_SUGGESTIONS = ['Asia', 'London', 'New York'] as const;
export const CONFIRMATION_NOTES_MAX_LENGTH = 2000;
export const NOTES_MAX_LENGTH = 4000;
export const TRADINGVIEW_URL_MAX_LENGTH = 2000;
export const MISTAKE_NOTE_MAX_LENGTH = 1000;
