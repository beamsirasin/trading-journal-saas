import { expect, test } from '@playwright/test';

import { authStateFile } from './support/auth-state';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';

/**
 * Phase 12B security-header baseline (`next.config.ts`'s `SECURITY_HEADERS`).
 * Runs against a real production build/start (`playwright.config.ts`'s
 * `webServer`) because header semantics — in particular `Strict-Transport-
 * Security`, which is gated on `NODE_ENV === 'production'` — differ from
 * `next dev` and would silently pass a dev-server-only check.
 */

const BASELINE_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

function assertBaselineHeaders(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
    expect(headers[name], `missing/incorrect header: ${name}`).toBe(value);
  }
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['permissions-policy']).toContain('payment=()');
  expect(headers['content-security-policy-report-only']).toContain("default-src 'self'");
  expect(headers['content-security-policy-report-only']).toContain("frame-ancestors 'none'");
  // Enforcing CSP is deliberately deferred (Phase 12A/12B) — never assert an
  // enforcing header exists, and prove one hasn't been added by accident.
  expect(headers['content-security-policy']).toBeUndefined();
  // The webServer this suite runs against is `next build && next start`,
  // i.e. NODE_ENV=production — HSTS must be present here. A dev-server run
  // would correctly omit it (see next.config.ts), but this suite never runs
  // one.
  expect(headers['strict-transport-security']).toBe('max-age=31536000');
  expect(headers['strict-transport-security']).not.toContain('preload');
  expect(headers['strict-transport-security']).not.toContain('includeSubDomains');
}

test.describe('security headers', () => {
  test('public landing page carries the baseline', async ({ page }) => {
    const response = await page.goto('/en');
    expect(response?.ok()).toBe(true);
    assertBaselineHeaders(response!.headers());
  });

  test('login page carries the baseline', async ({ page }) => {
    const response = await page.goto('/en/login');
    expect(response?.ok()).toBe(true);
    assertBaselineHeaders(response!.headers());
  });

  test('an unauthenticated /admin redirect response carries the baseline', async ({ page }) => {
    const response = await page.goto('/admin');
    // Whether this specific navigation's terminal response is the redirect
    // or the page it lands on depends on how the test harness follows
    // redirects; either way something in this chain must carry the headers.
    expect(response).not.toBeNull();
    assertBaselineHeaders(response!.headers());
  });

  test('a locale-prefixed /admin path 404s and still carries the baseline', async ({ page }) => {
    const response = await page.goto('/en/admin');
    expect(response?.status()).toBe(404);
    assertBaselineHeaders(response!.headers());
  });

  test.describe('authenticated app shell', () => {
    test.use({ storageState: authStateFile });
    test.beforeEach(() => {
      test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    });

    test('/en/app carries the baseline', async ({ page }) => {
      const response = await page.goto('/en/app');
      expect(response?.ok()).toBe(true);
      assertBaselineHeaders(response!.headers());
    });
  });

  test('the Better Auth API route carries the baseline without breaking session lookup', async ({
    page,
  }) => {
    const response = await page.goto('/api/auth/get-session');
    expect(response).not.toBeNull();
    assertBaselineHeaders(response!.headers());
    // No session cookie on this unauthenticated request — Better Auth's own
    // JSON body, not a header regression, proves the route still functions.
    const body: unknown = await response!.json();
    expect(body).toBeNull();
  });
});
