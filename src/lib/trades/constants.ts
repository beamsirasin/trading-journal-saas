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
 * `confidence` — an optional Confidence rating restricted to exactly five
 * steps (Founder-UAT Confidence redesign — locked product decision).
 * Migration 0010 has not been committed/merged yet, so its schema and
 * backfill were updated IN PLACE rather than superseded by a new migration
 * — see `drizzle/0010_trade_plan_price_money_confidence.sql`'s own doc
 * comment. This supersedes BOTH earlier uncommitted drafts of that same
 * migration: a continuous 0–100 range, and before that a 1–5 rating. No
 * integer outside `CONFIDENCE_STEPS` is ever a valid persisted value —
 * enforced at every layer (`trades_confidence_check`, the Zod schemas, and
 * this control itself never producing anything else).
 */
export const CONFIDENCE_STEPS = [0, 25, 50, 75, 100] as const;
export type ConfidenceStep = (typeof CONFIDENCE_STEPS)[number];
export function isConfidenceStep(value: number): value is ConfidenceStep {
  return (CONFIDENCE_STEPS as readonly number[]).includes(value);
}

/**
 * One semantic label per step (locked product copy: Very Low/Low/Neutral/
 * High/Very High), shared by the interactive control and every read surface
 * (Trade detail, Review step, correction dialog) so the mapping lives in
 * exactly one place, never re-derived per call site. A 1:1 mapping, not a
 * range — every step has exactly one label, and no other value can occur.
 */
export const CONFIDENCE_LEVELS = [
  { key: 'veryLow', value: 0 },
  { key: 'low', value: 25 },
  { key: 'neutral', value: 50 },
  { key: 'high', value: 75 },
  { key: 'veryHigh', value: 100 },
] as const satisfies readonly { key: string; value: ConfidenceStep }[];
export type ConfidenceLevelKey = (typeof CONFIDENCE_LEVELS)[number]['key'];

/**
 * Throws for anything outside the five allowed steps rather than guessing a
 * nearest label — every caller either already validated the value (a Zod
 * schema, the DB's own CHECK constraint, or this control's own onChange) or
 * has a genuine bug worth surfacing loudly, never silently mislabeling
 * corrupted data.
 */
export function confidenceLevelKey(value: number): ConfidenceLevelKey {
  const level = CONFIDENCE_LEVELS.find((candidate) => candidate.value === value);
  if (level === undefined) {
    throw new Error(`confidenceLevelKey: ${value} is not one of the five allowed Confidence steps`);
  }
  return level.key;
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
