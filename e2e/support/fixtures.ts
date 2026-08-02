/**
 * Fixed, deterministic e2e test identities. Provisioned by
 * `e2e/global-setup.ts` (pre-verified, real password hash — no email
 * round-trip needed) before the suite runs, and re-created on every run
 * (`provisionVerifiedUser` deletes any prior row for the same email first),
 * so these are safe to hardcode rather than generate per-run.
 *
 * Two distinct users exist specifically for cross-user isolation checks —
 * see `e2e/auth-authorization.spec.ts`.
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
