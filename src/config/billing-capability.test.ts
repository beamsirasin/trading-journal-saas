import { describe, expect, it } from 'vitest';

import {
  classifyRuntimeEnvironment,
  isGuardedTestSeamArmed,
  isLoopbackUrl,
  matchTrustedE2eCheckoutEmail,
  PaymentProviderUnavailableError,
} from './billing-capability';

describe('classifyRuntimeEnvironment', () => {
  it('accepts exactly the three real Next.js/Vitest runtime values', () => {
    expect(classifyRuntimeEnvironment('development')).toBe('development');
    expect(classifyRuntimeEnvironment('test')).toBe('test');
    expect(classifyRuntimeEnvironment('production')).toBe('production');
  });

  it('fails closed to "unknown" for missing, empty, staging, preview, or any other value', () => {
    expect(classifyRuntimeEnvironment(undefined)).toBe('unknown');
    expect(classifyRuntimeEnvironment('')).toBe('unknown');
    expect(classifyRuntimeEnvironment('staging')).toBe('unknown');
    expect(classifyRuntimeEnvironment('preview')).toBe('unknown');
    expect(classifyRuntimeEnvironment('Production')).toBe('unknown');
    expect(classifyRuntimeEnvironment('PRODUCTION')).toBe('unknown');
    expect(classifyRuntimeEnvironment('production ')).toBe('unknown');
    expect(classifyRuntimeEnvironment('anything-else')).toBe('unknown');
  });
});

describe('isLoopbackUrl', () => {
  it('accepts exact loopback hostnames', () => {
    expect(isLoopbackUrl('http://localhost:3000')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:3100')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:3000')).toBe(true);
  });

  it('rejects a real origin, including one that merely contains "localhost"', () => {
    expect(isLoopbackUrl('https://app.trading-os.example')).toBe(false);
    expect(isLoopbackUrl('https://localhost.attacker.example')).toBe(false);
    expect(isLoopbackUrl('https://not-localhost.example')).toBe(false);
  });

  it('fails closed for an absent or malformed value rather than throwing', () => {
    expect(isLoopbackUrl(undefined)).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
    expect(isLoopbackUrl('')).toBe(false);
  });
});

describe('isGuardedTestSeamArmed', () => {
  it('requires both E2E_TEST_MODE=true and a loopback BETTER_AUTH_URL', () => {
    expect(
      isGuardedTestSeamArmed({ E2E_TEST_MODE: 'true', BETTER_AUTH_URL: 'http://127.0.0.1:3100' }),
    ).toBe(true);
  });

  it('is unarmed when E2E_TEST_MODE is missing, even with a loopback origin', () => {
    expect(isGuardedTestSeamArmed({ BETTER_AUTH_URL: 'http://127.0.0.1:3100' })).toBe(false);
  });

  it('is unarmed when the origin is not loopback, even with E2E_TEST_MODE=true', () => {
    expect(
      isGuardedTestSeamArmed({
        E2E_TEST_MODE: 'true',
        BETTER_AUTH_URL: 'https://app.trading-os.example',
      }),
    ).toBe(false);
  });

  it('fails closed for any value other than the exact string "true"', () => {
    for (const malformed of ['TRUE', '1', 'yes', 'True ', ' true']) {
      expect(
        isGuardedTestSeamArmed({
          E2E_TEST_MODE: malformed,
          BETTER_AUTH_URL: 'http://127.0.0.1:3100',
        }),
      ).toBe(false);
    }
  });
});

describe('matchTrustedE2eCheckoutEmail', () => {
  it('matches the fixed success/processing/failed e2e checkout identities and selects the right outcome', () => {
    expect(matchTrustedE2eCheckoutEmail('e2e-checkout-success-chromium@example.test')).toEqual({
      matches: true,
      outcome: 'immediate_success',
    });
    expect(
      matchTrustedE2eCheckoutEmail('e2e-checkout-processing-history-chromium@example.test'),
    ).toEqual({ matches: true, outcome: 'processing_then_success' });
    expect(matchTrustedE2eCheckoutEmail('e2e-checkout-failed-mobile-chrome@example.test')).toEqual({
      matches: true,
      outcome: 'immediate_decline',
    });
  });

  it('never matches an ordinary customer email, even one resembling the pattern', () => {
    for (const email of [
      'e2e-checkout-success-chromium@gmail.com',
      'checkout-success-chromium@example.test',
      'attacker@example.test',
      'e2e-checkout-refunded-chromium@example.test',
      '',
    ]) {
      expect(matchTrustedE2eCheckoutEmail(email)).toEqual({ matches: false, outcome: null });
    }
  });

  it('rejects a self-registered identity outside the closed set of real Playwright project segments', () => {
    // A normal user can freely register any @example.test address through
    // ordinary signup. Before this pattern was tightened to an exact
    // project-segment allowlist, any of these would have matched the old
    // `[a-z0-9-]+` wildcard and been indistinguishable from a genuine
    // guarded-provisioning identity.
    for (const email of [
      'e2e-checkout-success-attacker@example.test',
      'e2e-checkout-success-anything-an-attacker-wants@example.test',
      'e2e-checkout-processing-webkit@example.test',
      'e2e-checkout-failed-firefox@example.test',
      'e2e-checkout-processing-history-attacker@example.test',
      'e2e-checkout-processing-history-webkit@example.test',
    ]) {
      expect(matchTrustedE2eCheckoutEmail(email)).toEqual({ matches: false, outcome: null });
    }
  });

  it('matches the billing-history checkout fixture only for the real project segments', () => {
    expect(
      matchTrustedE2eCheckoutEmail('e2e-checkout-processing-history-mobile-chrome@example.test'),
    ).toEqual({ matches: true, outcome: 'processing_then_success' });
  });
});

describe('PaymentProviderUnavailableError', () => {
  it('carries the typed safe error code and no provider detail', () => {
    const error = new PaymentProviderUnavailableError();
    expect(error.code).toBe('payment_provider_unavailable');
    expect(error.name).toBe('PaymentProviderUnavailableError');
    expect(error.message).not.toMatch(/stripe|omise|provider secret/i);
  });
});
