/**
 * The complete, typed set of audit-log action names.
 *
 * A closed list rather than a free-form string: `insertAuditLog()`
 * (`src/server/services/audit-log.ts`) only accepts a member of this set, so
 * a typo in an action name is a compile error, not a silently-unqueryable
 * row. Authentication-library-internal events (login, token refresh, …) are
 * deliberately not each given an entry — CLAUDE.md's audit scope is
 * meaningful *application* events, not every page view or library-internal
 * step (§19 of the Phase 2 brief: "Authentication-library internal events do
 * not all need to be duplicated").
 */
export const AUDIT_ACTIONS = [
  'workspace.personal_created',
  'workspace_member.owner_created',
  'user_preferences.active_workspace_initialized',
  'user_preferences.locale_changed',
  'user_preferences.theme_changed',
  'user_preferences.timezone_changed',
  'user.profile_updated',
  'trading_account.created',
  'workspace.onboarding_completed',
  'trading_account.updated',
  'trading_account.activated',
  'trading_account.archived',
  'trading_account.restored',
  'workspace.trial_started',
  'workspace.trial_expired',
  'workspace.entitlement_changed',
  'subscription.activated',
  'subscription.upgraded',
  'subscription.downgrade_scheduled',
  'subscription.downgrade_canceled',
  'subscription.cancellation_scheduled',
  'subscription.cancellation_canceled',
  'subscription.past_due',
  'subscription.recovered',
  'subscription.expired',
  'subscription.canceled',
  'subscription.pending_plan_materialized',
  'billing.checkout_created',
  'billing.checkout_processing',
  'billing.checkout_succeeded',
  'billing.checkout_failed',
  'billing.checkout_canceled',
  'billing.checkout_reconciled',
  'strategy.created',
  'strategy.updated',
  'strategy.archived',
  'strategy.restored',
  'strategy.version.created',
  'strategy.version.locked',
  'setup.created',
  'setup.updated',
  'setup.archived',
  'setup.restored',
  'strategy.rule.created',
  'strategy.rule.updated',
  'strategy.rule.removed',
  'trade.created',
  'trade.plan_updated',
  'trade.opened',
  'trade.closed',
  'trade.canceled',
  'trade.corrected',
  'trade.system_resolved',
  'trade.system_no_trade',
  'trade.rule_check_updated',
  'trade.mistake_added',
  'trade.mistake_removed',
  'trade.deleted',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}
