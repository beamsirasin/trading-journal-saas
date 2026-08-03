/**
 * The pure decision behind Phase 3A's onboarding route guards —
 * `src/app/[locale]/(app)/app/(main)/layout.tsx` (redirects to `/app/onboarding`
 * when this is `false`) and `src/app/[locale]/(app)/app/onboarding/page.tsx`
 * (redirects to `/app` when this is `true`). Extracted so the boundary
 * condition itself is unit-testable without rendering a Server Component —
 * the actual `redirect()` call and route composition remain covered by E2E.
 */
export function isOnboardingComplete(onboardingCompletedAt: Date | null): boolean {
  return onboardingCompletedAt !== null;
}
