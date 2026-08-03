/**
 * Fixed, deterministic e2e test identities. Provisioned by
 * `e2e/global-setup.ts` (pre-verified, real password hash — no email
 * round-trip needed) before the suite runs, and re-created on every run
 * (`provisionVerifiedUser` deletes any prior row for the same email first),
 * so these are safe to hardcode rather than generate per-run.
 *
 * Two distinct users exist specifically for cross-user isolation checks —
 * see `e2e/auth-authorization.spec.ts`.
 *
 * Both are provisioned pre-onboarded (`provisionVerifiedUser`'s default) —
 * every EXISTING consumer of these fixtures (app-shell/i18n/theme specs via
 * `e2e/auth.setup.ts`'s shared storage state, written before Phase 3A) reaches
 * `/app/*` expecting to land there immediately, which since Phase 3A requires
 * completed onboarding (`(app)/app/(main)/layout.tsx`).
 */
export const E2E_USER_A = {
  email: 'e2e-user-a@example.test',
  password: 'e2e-user-a-password-123',
  name: 'E2E User A',
};

export const E2E_USER_B = {
  email: 'e2e-user-b@example.test',
  password: 'e2e-user-b-password-123',
  name: 'E2E User B',
};

/**
 * Verified but deliberately NOT onboarded (`provisionVerifiedUser(url, user,
 * { onboarded: false })`) — the fixed identity for the "verified user without
 * onboarding is redirected to onboarding" and "returning user skips
 * onboarding" scenarios in `e2e/onboarding.spec.ts`, which manages its own
 * login (never `e2e/auth.setup.ts`'s shared storage state) so each test
 * controls this user's onboarding state precisely.
 */
export const E2E_USER_PENDING_ONBOARDING = {
  email: 'e2e-user-pending-onboarding@example.test',
  password: 'e2e-user-pending-onboarding-password-123',
  name: 'E2E Pending Onboarding User',
};
