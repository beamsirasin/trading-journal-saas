/**
 * Strategy/setup domain constants — framework independent, mirrors the
 * `strategy_rules_category_check` CHECK constraint in
 * `drizzle/0007_strategies_and_setups.sql`. Kept in sync by hand, the same
 * pattern as `src/lib/trading-accounts/constants.ts`'s `ACCOUNT_MODES`
 * against `trading_accounts_account_mode_check` — the CHECK is the real,
 * database-enforced boundary; this list is what future service/action/UI
 * code shares so client and server cannot drift on what "valid" means.
 */

export const STRATEGY_RULE_CATEGORIES = [
  'entry',
  'invalidation',
  'risk',
  'management',
  'exit',
] as const;

export type StrategyRuleCategory = (typeof STRATEGY_RULE_CATEGORIES)[number];

export function isStrategyRuleCategory(value: unknown): value is StrategyRuleCategory {
  return (
    typeof value === 'string' && (STRATEGY_RULE_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Phase 06D boundary-validation bounds — generous but finite, matching
 * `src/lib/trading-accounts/constants.ts`'s `NAME_MAX_LENGTH` precedent. The
 * database has no length CHECK of its own (only non-blank), so these are the
 * only upper bound; not a normalization rule (trimming/blank-rejection stays
 * the service's job — see `src/lib/strategies/validation.ts`).
 */
export const STRATEGY_NAME_MAX_LENGTH = 120;
export const STRATEGY_TEXT_MAX_LENGTH = 2000;
export const CHANGE_NOTE_MAX_LENGTH = 500;
export const RULE_TITLE_MAX_LENGTH = 200;
