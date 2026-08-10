/**
 * The complete, typed set of PLATFORM ADMIN audit action names and reason
 * codes — the `admin_audit_log` counterpart to `src/config/audit-actions.ts`.
 * Kept in a separate closed vocabulary rather than folded into
 * `AUDIT_ACTIONS`: platform-admin actions describe an operator acting on
 * someone else's data (Phase 11's own non-negotiable), a fundamentally
 * different trust register than a workspace member acting on their own.
 *
 * Deliberately small — Phase 11B only lays the persistence and authorization
 * foundation; the trial-extension and complimentary-grant/revoke actions
 * exist here so `admin_audit_log`'s schema and this module are locked
 * together now, even though no server action calls them yet (that is
 * Phase 11E's job — see `docs/phases/PHASE-11-admin.md`).
 */

export const ADMIN_AUDIT_ACTIONS = [
  'platform_admin.granted',
  'platform_admin.revoked',
  'subscription.trial_extended',
  'subscription.complimentary_granted',
  'subscription.complimentary_revoked',
  'vat.configuration_changed',
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export function isAdminAuditAction(value: string): value is AdminAuditAction {
  return (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Shared by `admin_audit_log.reason_code` and `platform_vat_configuration.
 * reason_code` — one closed vocabulary, not two parallel lists that could
 * drift. A reason CODE is required on every administrative mutation; the
 * accompanying free-text note is optional (see `AdminAuditLogInput` in
 * `src/server/services/admin-audit-log.ts`).
 */
export const ADMIN_AUDIT_REASON_CODES = [
  /** The one-time operational bootstrap/system provisioning path. */
  'bootstrap',
  'access_grant',
  'access_revoke',
  'trial_extension_goodwill',
  'complimentary_access',
  'support_adjustment',
  'configuration_change',
  'other',
] as const;

export type AdminAuditReasonCode = (typeof ADMIN_AUDIT_REASON_CODES)[number];

export function isAdminAuditReasonCode(value: string): value is AdminAuditReasonCode {
  return (ADMIN_AUDIT_REASON_CODES as readonly string[]).includes(value);
}
