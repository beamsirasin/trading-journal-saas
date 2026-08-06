/**
 * Stable, non-sensitive domain error codes for the Strategy/Setup/Rule
 * services (`src/server/services/strategy-management.ts`,
 * `strategy-versioning.ts`). Suitable for a future Phase 06D Server Action's
 * user-facing message mapping — never a name, description, note, change
 * note, rule title, workspace ID, or SQL detail.
 *
 * `read_only_workspace`/`over_limit_workspace` are not redefined here — they
 * are `MutationDenialReason` values from `@/lib/entitlements/resolve`,
 * reused directly in every service's result type
 * (`{ ok: false; code: StrategyDomainErrorCode | MutationDenialReason }`),
 * the same pattern `trading-account-management.ts` already establishes. They
 * are listed in this module's exported set purely so one import gives a
 * caller (or a test) the complete surface of codes this domain can ever
 * return, without duplicating the entitlement mutation matrix itself.
 */

export const STRATEGY_DOMAIN_ERROR_CODES = [
  'strategy_not_found',
  'strategy_archived',
  'strategy_current_version_missing',
  'setup_not_found',
  'setup_archived',
  'setup_snapshot_missing',
  'rule_not_found',
  'change_note_required',
  'invalid_rule_category',
  'blank_name',
  'blank_title',
  'read_only_workspace',
  'over_limit_workspace',
  'workspace_access_denied',
] as const;

export type StrategyDomainErrorCode = (typeof STRATEGY_DOMAIN_ERROR_CODES)[number];

export function isStrategyDomainErrorCode(value: unknown): value is StrategyDomainErrorCode {
  return (
    typeof value === 'string' && (STRATEGY_DOMAIN_ERROR_CODES as readonly string[]).includes(value)
  );
}
