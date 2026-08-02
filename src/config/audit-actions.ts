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
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}
