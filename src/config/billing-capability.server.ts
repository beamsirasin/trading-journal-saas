import 'server-only';

import { eq } from 'drizzle-orm';

import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';

import {
  classifyRuntimeEnvironment,
  isGuardedTestSeamArmed,
  matchTrustedE2eCheckoutEmail,
  PaymentProviderUnavailableError,
  type BillingCheckoutCapability,
  type TrustedE2eCheckoutOutcome,
  type TrustedE2eIdentityMatch,
} from './billing-capability';
import { getServerEnv } from './env.server';

export { PaymentProviderUnavailableError };
export type { BillingCheckoutCapability, TrustedE2eCheckoutOutcome };

export interface BillingCheckoutCapabilityResult {
  readonly capability: BillingCheckoutCapability;
  /** `null` unless a trusted e2e checkout identity selected a specific mock outcome. */
  readonly trustedOutcome: TrustedE2eCheckoutOutcome | null;
}

const NO_MATCH: TrustedE2eIdentityMatch = { matches: false, outcome: null };

async function trustedE2eIdentity(userId: string): Promise<TrustedE2eIdentityMatch> {
  const [user] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return matchTrustedE2eCheckoutEmail(user?.email ?? '');
}

/**
 * The one server-only source of truth for whether checkout/reconciliation
 * may reach the mock payment provider (CLAUDE.md §4-style single boundary,
 * applied to billing rather than authorization).
 *
 * Depends on nothing but trusted server configuration and the caller's own
 * database-stored identity — never browser input, locale, route query
 * parameters, workspace data, plan selection, or other client-side state.
 * Both `checkoutAction` and `reconcileCheckoutAction` (via
 * `getConfiguredPaymentProvider`) and the checkout page's rendering decision
 * call through here, so a client can never reach a different answer by
 * hitting one path instead of the other.
 *
 * The runtime classification is read from raw `process.env.NODE_ENV` via
 * `classifyRuntimeEnvironment` — deliberately BEFORE any call to
 * `getServerEnv()` — for two reasons: `env.schema.ts`'s zod schema defaults a
 * missing `NODE_ENV` to `'development'` (wrong for this decision: "missing"
 * must fail closed, not silently inherit development trust), and it throws
 * for an unrecognized value such as `'staging'`/`'preview'` (which would
 * crash this function instead of letting it answer `'unavailable'`). Only
 * once the raw value is confirmed to be exactly `'development'`, `'test'`,
 * or `'production'` — never for `'unknown'` — is `getServerEnv()` consulted
 * for `E2E_TEST_MODE`/`BETTER_AUTH_URL`.
 */
export async function resolveBillingCheckoutCapability(
  userId: string,
): Promise<BillingCheckoutCapabilityResult> {
  const runtime = classifyRuntimeEnvironment(process.env.NODE_ENV);

  if (runtime === 'unknown') {
    return { capability: 'unavailable', trustedOutcome: null };
  }

  const env = getServerEnv();

  if (runtime === 'development' || runtime === 'test') {
    // Development and Vitest runs: the mock provider is always reachable.
    // The guarded-test-seam identity check only ever narrows WHICH outcome
    // is simulated, so it is skipped (no database round trip) unless the
    // same seam that gates production is also armed here.
    const identity = isGuardedTestSeamArmed(env) ? await trustedE2eIdentity(userId) : NO_MATCH;
    return { capability: 'development_mock', trustedOutcome: identity.outcome };
  }

  // runtime === 'production'
  if (!isGuardedTestSeamArmed(env)) {
    return { capability: 'unavailable', trustedOutcome: null };
  }

  // Production with the guarded test seam armed is still not enough on its
  // own — `E2E_TEST_MODE`/loopback `BETTER_AUTH_URL` could in principle both
  // be true through operator error, so the mock provider stays unavailable
  // unless THIS authenticated caller is also one of the fixed e2e checkout
  // identities `e2e/support/provision-user.ts` provisions.
  const identity = await trustedE2eIdentity(userId);
  return identity.matches
    ? { capability: 'automated_test_mock', trustedOutcome: identity.outcome }
    : { capability: 'unavailable', trustedOutcome: null };
}

export async function getBillingCheckoutCapability(
  userId: string,
): Promise<BillingCheckoutCapability> {
  return (await resolveBillingCheckoutCapability(userId)).capability;
}

/** Throws `PaymentProviderUnavailableError` rather than returning a falsy capability — the enforcement point every caller must use. */
export async function assertPaymentProviderAvailable(
  userId: string,
): Promise<BillingCheckoutCapabilityResult> {
  const result = await resolveBillingCheckoutCapability(userId);
  if (result.capability === 'unavailable') {
    throw new PaymentProviderUnavailableError();
  }
  return result;
}
