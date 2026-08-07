/**
 * Drizzle schema root.
 *
 * Phase 2 adds the first real tables: Better Auth's own (`users`, `sessions`,
 * `accounts`, `verifications`, `rate_limits`) and the application's tenancy
 * foundation (`workspaces`, `workspace_members`, `user_preferences`,
 * `audit_logs`). Conventions every table follows are recorded in
 * `docs/data-dictionary.md`. The important one carried forward from every
 * later table: `workspace_id` on every business record, indexed first.
 */

export * from './auth';
export * from './workspaces';
export * from './trading-accounts';
export * from './user-preferences';
export * from './audit-logs';
export * from './workspace-entitlements';
export * from './billing-transactions';
export * from './strategies';
export * from './setups';
export * from './strategy-setup-versions';
export * from './strategy-rules';
export * from './trades';
export * from './mistake-types';
export * from './trade-mistakes';
export * from './trade-rule-checks';
