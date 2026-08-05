/**
 * Pure billing-capability logic — no `server-only`, no database, no
 * `env.server.ts` import. Kept separate from `billing-capability.server.ts`
 * for the same reason `env.schema.ts` is kept separate from `env.server.ts`
 * (see that file's own comment): the server-only sibling imports the
 * `server-only` marker package, which throws outside a server context and
 * would make this logic untestable in the plain jsdom unit-test runner.
 *
 * Nothing here ever reads `process.env` directly — every function takes
 * already-resolved values as plain arguments, so a caller can never smuggle
 * browser input, a query parameter, or workspace data into a capability
 * decision by construction.
 */

/**
 * `development_mock`  — `NODE_ENV` is exactly `'development'` or exactly
 *                        `'test'` (a developer's own machine, or Vitest's
 *                        unit/integration runs), both inherently trusted.
 *                        The mock provider is always available.
 * `automated_test_mock` — `NODE_ENV` is exactly `'production'`, but only for
 *                          the guarded E2E test seam: `E2E_TEST_MODE=true`
 *                          (CI-only, see `env.schema.ts`), a loopback
 *                          `BETTER_AUTH_URL`, and the specific authenticated
 *                          caller matching one of the fixed e2e checkout
 *                          identities.
 * `unavailable`        — normal production, OR any runtime whose `NODE_ENV`
 *                         is not exactly one of the three values above
 *                         (missing, empty, `'staging'`, `'preview'`, or any
 *                         other value — see `classifyRuntimeEnvironment`).
 *                         No mock checkout, no reconciliation, no billing
 *                         transaction may be created through the
 *                         payment-provider boundary.
 */
export type BillingCheckoutCapability = 'development_mock' | 'automated_test_mock' | 'unavailable';

/** Mirrors `MockPaymentOutcome`'s success/decline/processing shapes without importing the provider module here. */
export type TrustedE2eCheckoutOutcome =
  'immediate_success' | 'processing_then_success' | 'immediate_decline';

export type TrustedE2eIdentityMatch =
  | { readonly matches: true; readonly outcome: TrustedE2eCheckoutOutcome }
  | { readonly matches: false; readonly outcome: null };

/**
 * Explicit allowlist for the raw `NODE_ENV` value — deliberately NOT the
 * `ServerEnv['NODE_ENV']` type from `env.schema.ts`, whose zod enum defaults
 * a missing value to `'development'` and throws for an unrecognized one.
 * Both of those behaviors are wrong for this specific decision: a missing
 * `NODE_ENV` must fail closed here rather than silently inherit the
 * schema's development default, and an unrecognized value (a staging or
 * preview deployment, a typo) must fail closed rather than crash the whole
 * app via `getServerEnv()`. Only an exact, case-sensitive match against one
 * of the three real Next.js/Vitest runtime values is ever accepted;
 * everything else — `undefined`, `''`, `'staging'`, `'preview'`, or any
 * other value — is `'unknown'`.
 */
export type RuntimeEnvironmentClass = 'development' | 'test' | 'production' | 'unknown';

export function classifyRuntimeEnvironment(nodeEnv: string | undefined): RuntimeEnvironmentClass {
  if (nodeEnv === 'development' || nodeEnv === 'test' || nodeEnv === 'production') {
    return nodeEnv;
  }
  return 'unknown';
}

/** True only for an exact loopback origin — never a substring match, never a wildcard. */
export function isLoopbackUrl(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    // The WHATWG URL parser brackets an IPv6 hostname (`[::1]`), unlike the
    // plain literal for the other two forms — normalize before comparing.
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Whether the guarded E2E test seam is armed at all — both conditions are
 * server-only trusted configuration, never client input. `E2E_TEST_MODE` is
 * set only by `.github/workflows/ci.yml`'s e2e job; a real deployment must
 * never set it (see `env.schema.ts`). Requiring loopback `BETTER_AUTH_URL` on
 * top of that closes the door if it ever were.
 */
export function isGuardedTestSeamArmed(env: {
  readonly E2E_TEST_MODE?: string | undefined;
  readonly BETTER_AUTH_URL?: string | undefined;
}): boolean {
  return env.E2E_TEST_MODE === 'true' && isLoopbackUrl(env.BETTER_AUTH_URL);
}

/**
 * The exact, closed set of Playwright project names that ever run a checkout
 * spec — `playwright.config.ts`'s `projects` array. `setup` only runs
 * `auth.setup.ts` and never reaches checkout, so it is deliberately excluded.
 * A wildcard character class here (`[a-z0-9-]+`) would let a normal user
 * self-register `e2e-checkout-success-<anything>@example.test` through
 * ordinary email/password signup and satisfy the pattern with no connection
 * to the guarded provisioning path at all — closing that gap is the entire
 * point of enumerating the finite real values instead of a shape. Renaming
 * or adding a Playwright project that runs checkout specs must update this
 * list; failing closed on a stale list is the correct default.
 */
const TRUSTED_E2E_PLAYWRIGHT_PROJECT_SEGMENTS = ['chromium', 'mobile-chrome'] as const;

/**
 * The fixed e2e checkout identities provisioned by
 * `e2e/support/provision-user.ts`, called only from `e2e/checkout.spec.ts`
 * and `e2e/subscription-management.spec.ts`'s Node-side Playwright fixture
 * setup — never reachable through the app's public registration endpoint.
 * Matching one of these patterns is necessary but not sufficient — it only
 * ever selects a mock OUTCOME; whether the mock provider is reachable at all
 * is decided first, by `isGuardedTestSeamArmed`/production posture.
 */
const TRUSTED_E2E_CHECKOUT_EMAIL_PATTERN = new RegExp(
  `^e2e-checkout-(success|processing|failed)-(${TRUSTED_E2E_PLAYWRIGHT_PROJECT_SEGMENTS.join('|')})@example\\.test$`,
);

/** `e2e/subscription-management.spec.ts`'s billing-history checkout fixture — always the `processing` outcome. */
const TRUSTED_E2E_CHECKOUT_HISTORY_EMAIL_PATTERN = new RegExp(
  `^e2e-checkout-processing-history-(${TRUSTED_E2E_PLAYWRIGHT_PROJECT_SEGMENTS.join('|')})@example\\.test$`,
);

export function matchTrustedE2eCheckoutEmail(email: string): TrustedE2eIdentityMatch {
  const match = TRUSTED_E2E_CHECKOUT_EMAIL_PATTERN.exec(email);
  if (match !== null) {
    const kind = match[1];
    const outcome: TrustedE2eCheckoutOutcome =
      kind === 'processing'
        ? 'processing_then_success'
        : kind === 'failed'
          ? 'immediate_decline'
          : 'immediate_success';
    return { matches: true, outcome };
  }
  if (TRUSTED_E2E_CHECKOUT_HISTORY_EMAIL_PATTERN.test(email)) {
    return { matches: true, outcome: 'processing_then_success' };
  }
  return { matches: false, outcome: null };
}

/** Typed safe error surfaced to server actions when checkout/reconciliation has no capability. Carries no provider detail. */
export class PaymentProviderUnavailableError extends Error {
  readonly code = 'payment_provider_unavailable' as const;

  constructor(message = 'The payment provider is not available in this environment.') {
    super(message);
    this.name = 'PaymentProviderUnavailableError';
  }
}
