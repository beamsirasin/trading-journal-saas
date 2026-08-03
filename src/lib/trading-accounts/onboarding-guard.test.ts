import { describe, expect, it } from 'vitest';

import { isOnboardingComplete } from './onboarding-guard';

describe('isOnboardingComplete', () => {
  it('is false when onboardingCompletedAt is null (drives (main)/layout.tsx redirecting to /app/onboarding)', () => {
    expect(isOnboardingComplete(null)).toBe(false);
  });

  it('is true when onboardingCompletedAt is a Date (drives onboarding/page.tsx redirecting to /app)', () => {
    expect(isOnboardingComplete(new Date())).toBe(true);
  });

  it('is true for a Date far in the past', () => {
    expect(isOnboardingComplete(new Date(0))).toBe(true);
  });
});
