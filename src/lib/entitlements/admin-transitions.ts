/**
 * Pure, framework-independent transition-policy logic for the Phase 11E
 * Admin Subscription Support mutations — no I/O, no Drizzle, no database
 * row, matching this codebase's own `lib/calc/`-style rule ("imports
 * nothing from `server/` or `app/`") so this decision logic is fully unit-
 * testable without a database. `src/server/services/admin/subscription-
 * support.ts` is the one caller: it locks the real row, calls these
 * functions to decide WHAT to write, then performs the write + audit insert
 * itself inside its own transaction. No second Entitlement resolver/state
 * machine — `resolveEffectiveEntitlement` (`./resolve.ts`) remains the only
 * reader of "what does this row mean"; this file only decides whether an
 * ADMIN-initiated WRITE is allowed and what it should contain.
 */

import type { AdminAuditReasonCode } from '@/config/admin-audit-actions';
import { isPlanKey, type PlanKey } from '@/config/plan-catalog';

export type AdminSubscriptionMutationErrorCode =
  | 'validation_error'
  | 'unauthenticated'
  | 'admin_required'
  | 'not_found'
  | 'incompatible_state'
  | 'invalid_transition'
  | 'data_integrity_error'
  | 'unexpected_error';

export class AdminSubscriptionMutationError extends Error {
  readonly code: AdminSubscriptionMutationErrorCode;

  constructor(code: AdminSubscriptionMutationErrorCode, message: string) {
    super(message);
    this.name = 'AdminSubscriptionMutationError';
    this.code = code;
  }
}

function fail(code: AdminSubscriptionMutationErrorCode, message: string): never {
  throw new AdminSubscriptionMutationError(code, message);
}

/** The minimal `workspace_entitlements` row shape every evaluator needs — structurally satisfied by the real Drizzle-inferred row without importing it here. */
export interface AdminEntitlementTransitionRow {
  readonly source: string;
  readonly status: string;
  readonly planKey: string | null;
  readonly trialStartedAt: Date | null;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodStartedAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
}

interface AdminActorContext {
  readonly workspaceId: string;
  readonly reasonCode: AdminAuditReasonCode;
  readonly reasonNote?: string;
}

/**
 * Complimentary access has NO commercial period, currency, or interval: it
 * is an Admin-granted allowance, not a payment. `resolveEffectiveEntitlement`
 * (`./resolve.ts`) has a dedicated `source === 'complimentary'` branch that
 * requires `currentPeriodStartedAt`/`currentPeriodEndsAt`/`billingCurrency`/
 * `billingInterval` to all be `null` for the row to resolve as truthfully
 * active — the writer (`subscription-support.ts`) sets exactly that null
 * shape. No `billing_transactions` row is written, no provider identifier is
 * set, and `source:'complimentary'` is the only marker of provenance.
 * "No automatic expiry" is represented as literally no period (`null`), not
 * a distant fabricated end date — an Admin ends it only via an explicit
 * revoke.
 */
export const MAX_TRIAL_EXTENSION_DAYS = 90;
export const MAX_TRIAL_EXTENSION_MS = MAX_TRIAL_EXTENSION_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Extend Trial
// ---------------------------------------------------------------------------

export const TRIAL_EXTENSION_REASON_CODES = new Set<AdminAuditReasonCode>([
  'trial_extension_goodwill',
  'support_adjustment',
  'other',
]);

export interface ExtendTrialInput extends AdminActorContext {
  readonly newTrialEndsAt: Date;
}

export interface AdminMutationResult {
  readonly changed: boolean;
}

/**
 * Eligibility: `source === 'trial'` AND the canonical persisted trialing
 * lifecycle state — never a paid or complimentary row, regardless of
 * whether `resolveEffectiveEntitlement` currently reads it as expired (an
 * expired-but-still-`trialing` row is exactly the state a real extension
 * legitimately revives — see the module's Phase 11E brief).
 */
export function evaluateTrialExtension(
  row: AdminEntitlementTransitionRow,
  input: ExtendTrialInput,
  now: Date,
): { readonly changed: boolean; readonly nextTrialEndsAt: Date } {
  if (row.source !== 'trial') {
    fail('incompatible_state', 'Trial extension requires original trial provenance.');
  }
  if (row.status !== 'trialing') {
    fail('incompatible_state', 'Trial extension requires the canonical trialing lifecycle state.');
  }
  if (row.trialStartedAt === null || row.trialEndsAt === null) {
    fail('data_integrity_error', 'Trial baseline (trialStartedAt/trialEndsAt) is missing.');
  }
  if (!TRIAL_EXTENSION_REASON_CODES.has(input.reasonCode)) {
    fail('validation_error', 'Reason code is not valid for a trial extension.');
  }
  if (!Number.isFinite(input.newTrialEndsAt.getTime())) {
    fail('validation_error', 'New trial end must be a valid timestamp.');
  }
  // The exact-match no-op check runs BEFORE the future-check: a retry that
  // resubmits the identical absolute timestamp already on record must
  // always be a safe no-op (this is precisely what makes an absolute
  // timestamp idempotent-by-construction), even if that stored value has
  // since become past relative to a later `now` — nothing would be written
  // either way, so there is nothing for the future-check to protect here.
  if (input.newTrialEndsAt.getTime() === row.trialEndsAt.getTime()) {
    return { changed: false, nextTrialEndsAt: row.trialEndsAt };
  }
  if (input.newTrialEndsAt.getTime() <= now.getTime()) {
    fail('validation_error', 'New trial end must be in the future.');
  }
  if (input.newTrialEndsAt.getTime() < row.trialEndsAt.getTime()) {
    fail('invalid_transition', 'New trial end cannot be earlier than the current trial end.');
  }
  if (input.newTrialEndsAt.getTime() > now.getTime() + MAX_TRIAL_EXTENSION_MS) {
    fail(
      'validation_error',
      `New trial end cannot be more than ${MAX_TRIAL_EXTENSION_DAYS} days from now.`,
    );
  }

  return { changed: true, nextTrialEndsAt: input.newTrialEndsAt };
}

// ---------------------------------------------------------------------------
// Grant Complimentary Plan
// ---------------------------------------------------------------------------

export const COMPLIMENTARY_GRANT_REASON_CODES = new Set<AdminAuditReasonCode>([
  'complimentary_access',
  'support_adjustment',
  'other',
]);

export interface GrantComplimentaryPlanInput extends AdminActorContext {
  readonly planKey: PlanKey;
}

/**
 * Eligibility: `source === 'trial'` (fresh grant) or `source ===
 * 'complimentary'` (plan change) — NEVER `source === 'paid'`. Every
 * complimentary entitlement must retain a valid trial baseline
 * (`trialStartedAt`/`trialEndsAt`), required both for a fresh grant and,
 * defensively, for a plan change on an already-complimentary row (a
 * legacy/manually constructed row without one fails closed rather than
 * being guessed at).
 */
export function evaluateComplimentaryGrant(
  row: AdminEntitlementTransitionRow,
  input: GrantComplimentaryPlanInput,
): { readonly changed: boolean; readonly fresh: boolean } {
  if (row.source === 'paid') {
    fail('incompatible_state', 'A paid subscription cannot be converted to complimentary access.');
  }
  if (row.source !== 'trial' && row.source !== 'complimentary') {
    fail('data_integrity_error', 'Unrecognized entitlement source.');
  }
  if (!isPlanKey(input.planKey)) {
    fail('validation_error', 'Plan key is not a canonical plan.');
  }
  if (!COMPLIMENTARY_GRANT_REASON_CODES.has(input.reasonCode)) {
    fail('validation_error', 'Reason code is not valid for a complimentary grant.');
  }
  if (row.trialStartedAt === null || row.trialEndsAt === null) {
    fail(
      'data_integrity_error',
      'Complimentary access requires a preserved trial baseline for a safe future revoke.',
    );
  }

  if (row.source === 'complimentary' && row.planKey === input.planKey) {
    return { changed: false, fresh: false };
  }

  return { changed: true, fresh: row.source === 'trial' };
}

// ---------------------------------------------------------------------------
// Revoke Complimentary Plan
// ---------------------------------------------------------------------------

export const COMPLIMENTARY_REVOKE_REASON_CODES = new Set<AdminAuditReasonCode>([
  'access_revoke',
  'support_adjustment',
  'other',
]);

export type RevokeComplimentaryPlanInput = AdminActorContext;

/**
 * Eligibility: `source === 'complimentary'` only performs a real revoke.
 * `source === 'trial'` is treated as an idempotent-retry-safe no-op (the
 * revoke's own target end state). `source === 'paid'` is always rejected —
 * paid access is never touched by this action.
 */
export function evaluateComplimentaryRevoke(
  row: AdminEntitlementTransitionRow,
  input: RevokeComplimentaryPlanInput,
): 'noop' | 'revoke' {
  if (row.source === 'paid') {
    fail('incompatible_state', 'Paid subscriptions cannot be revoked through this action.');
  }
  if (!COMPLIMENTARY_REVOKE_REASON_CODES.has(input.reasonCode)) {
    fail('validation_error', 'Reason code is not valid for a complimentary revoke.');
  }
  if (row.source === 'trial') {
    return 'noop';
  }

  // row.source === 'complimentary'
  if (row.trialStartedAt === null || row.trialEndsAt === null) {
    fail(
      'data_integrity_error',
      'Complimentary access has no recoverable trial baseline to revoke to.',
    );
  }
  return 'revoke';
}
