/**
 * The one valid password every integration test that performs a REAL
 * `signUp.email`/`signUpEmail` call must use. Anything weaker is now
 * rejected by `src/lib/auth/server.ts`'s `enforceSignUpPasswordPolicy`
 * before-hook (Phase 2.1) before the endpoint body — and therefore the
 * intended test behavior (a provisioning hook, a rate limit, a duplicate
 * check, …) — ever runs.
 *
 * Satisfies `evaluatePasswordPolicy` (`src/lib/auth/password-policy.ts`) in
 * full: 12-128 characters, lowercase, uppercase, number, and an ASCII
 * special character. A single shared constant — not a private literal
 * per test file — so a future policy change only needs updating here, and
 * no test can silently drift back to a weak, pre-Phase-2.1 password by
 * copy-paste.
 *
 * Tests that specifically assert weak-password REJECTION must keep using
 * their own deliberately-invalid literal instead of this constant.
 */
export const VALID_TEST_PASSWORD = 'Correct-Horse9!';
