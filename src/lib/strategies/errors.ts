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
  'condition_not_found',
  'change_note_required',
  'invalid_rule_category',
  'blank_name',
  'blank_title',
  'blank_condition_label',
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

/**
 * Phase 06D's closed public error surface — what a Server Action ever
 * returns to the client, and what `messages/{en,th}.json`'s
 * `strategies.errors` namespace has a key for. A strict superset of
 * {@link STRATEGY_DOMAIN_ERROR_CODES} minus the two Zod-catchable
 * `blank_name`/`blank_title`/`blank_condition_label` codes (folded into
 * `validation_error`), plus
 * four action-layer-only codes (`validation_error`, `unauthenticated`,
 * `conflict`, `unexpected_error`) that no service function ever returns
 * itself.
 */
export const STRATEGY_PUBLIC_ERROR_CODES = [
  'validation_error',
  'unauthenticated',
  'workspace_access_denied',
  'read_only_workspace',
  'over_limit_workspace',
  'strategy_not_found',
  'strategy_archived',
  'strategy_current_version_missing',
  'setup_not_found',
  'setup_archived',
  'setup_snapshot_missing',
  'rule_not_found',
  'condition_not_found',
  'change_note_required',
  'invalid_rule_category',
  'conflict',
  'unexpected_error',
] as const;

export type StrategyPublicErrorCode = (typeof STRATEGY_PUBLIC_ERROR_CODES)[number];

export function isStrategyPublicErrorCode(value: unknown): value is StrategyPublicErrorCode {
  return (
    typeof value === 'string' && (STRATEGY_PUBLIC_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Maps a service result code — {@link StrategyDomainErrorCode} or a
 * `MutationDenialReason` from `@/lib/entitlements/resolve` — to the public
 * surface a Server Action returns. Blank required-text codes become
 * `validation_error` (the Zod schema layer normally catches these first;
 * this is the defensive fallback when it does not, e.g. a value Zod's
 * `.min(1)` accepts but the service's trim-then-check rejects as blank).
 *
 * Every `MutationDenialReason` member other than `read_only_workspace`/
 * `over_limit_workspace` (e.g. `trial_expired`, `entitlement_unavailable`)
 * is statically unreachable here: this domain only ever calls
 * `authorizeWorkspaceMutation(entitlement, 'ordinary_write')`, which
 * collapses every entitlement-blocked state to exactly one of those two
 * codes for that operation (see `resolve.ts`) — never a plan/trial-specific
 * reason. The `default` branch exists for type-level exhaustiveness only and
 * should never execute in practice; reaching it is reported as
 * `unexpected_error` rather than crashing.
 */
export function mapServiceErrorToPublicCode(
  code: StrategyDomainErrorCode | string,
): StrategyPublicErrorCode {
  switch (code) {
    case 'blank_name':
    case 'blank_title':
    case 'blank_condition_label':
      return 'validation_error';
    case 'strategy_not_found':
    case 'strategy_archived':
    case 'strategy_current_version_missing':
    case 'setup_not_found':
    case 'setup_archived':
    case 'setup_snapshot_missing':
    case 'rule_not_found':
    case 'condition_not_found':
    case 'change_note_required':
    case 'invalid_rule_category':
    case 'workspace_access_denied':
    case 'read_only_workspace':
    case 'over_limit_workspace':
      return code;
    default:
      return 'unexpected_error';
  }
}
