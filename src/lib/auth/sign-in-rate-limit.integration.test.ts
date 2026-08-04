import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { closeDb } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Proves the Phase 3C authentication-stabilization brief's core safety
 * claim: `/sign-in/email`'s production rate limit is untouched by the
 * E2E-side fix (a database-backed session fixture that bypasses this
 * endpoint entirely for `entitlements.spec.ts`/`accounts.spec.ts`, which
 * were exhausting the one shared bucket Better Auth's IP+route keying
 * produces). This file never imports or depends on anything E2E — it
 * exercises the real Better Auth instance and a real, disposable database
 * directly through `auth.handler`, the same pattern
 * `registration-hardening.integration.test.ts` already established for
 * `/sign-up/email` and `/send-verification-email`.
 */
const { getAuth } = await import('./server');

/**
 * Better Auth's rate limiter falls back to a fixed `"127.0.0.1"` client
 * identity when `isTest()` is true and no `x-forwarded-for` header is
 * present (`@better-auth/core/utils/ip.ts::getIp`) — the same reasoning
 * `registration-hardening.integration.test.ts` documents for its own two
 * buckets. `storage: 'database'` means the bucket persists across test
 * runs, so it is cleared before and after use.
 *
 * Outside a test/dev `NODE_ENV`, `getIp` returns `null` instead (no
 * `x-forwarded-for` header, no `trustedProxies` configured) and the key
 * collapses to `"no-trusted-ip|/sign-in/email"` — this is the actual root
 * cause the Playwright E2E suite hit: every project, worker, and retry's
 * sign-in shared that one identical key with no way to tell them apart.
 */
const SIGN_IN_RATE_LIMIT_KEY = '127.0.0.1|/sign-in/email';

async function resetRateLimitBucket(): Promise<void> {
  const db = getTestDb();
  await db.delete(rateLimits).where(eq(rateLimits.key, SIGN_IN_RATE_LIMIT_KEY));
}

function signInEmailRequest(
  auth: ReturnType<typeof getAuth>,
  body: { email: string; password: string },
): Promise<Response> {
  return auth.handler(
    new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
  );
}

describe('/sign-in/email rate limiting (real Better Auth + database)', () => {
  afterEach(async () => {
    await resetRateLimitBucket();
  });

  afterAll(async () => {
    await closeDb();
    await closeTestDb();
  });

  it('keeps /sign-in/email rate limited via the real HTTP router', async () => {
    const auth = getAuth();
    await resetRateLimitBucket();
    const configuredRule = auth.options.rateLimit?.customRules?.['/sign-in/email'];
    if (configuredRule === undefined) throw new Error('expected a configured sign-in rate limit');

    // Wrong credentials are enough — the rate limiter runs at the router
    // level, before the endpoint's own credential check, so a real
    // provisioned user is not needed to prove the limit itself (the same
    // reasoning the sibling file's dispatch test relies on).
    const statuses: number[] = [];
    for (let attempt = 0; attempt < configuredRule.max + 2; attempt += 1) {
      const response = await signInEmailRequest(auth, {
        email: `no-such-user-${crypto.randomUUID()}@example.test`,
        password: 'wrong-password-but-long-enough-1234',
      });
      statuses.push(response.status);
    }

    const blockedCount = statuses.filter((status) => status === 429).length;
    expect(blockedCount).toBeGreaterThan(0);
    expect(statuses.slice(0, configuredRule.max).every((status) => status !== 429)).toBe(true);
  });

  it('locks the production /sign-in/email rate limit at 5 requests per 60 seconds outside E2E_TEST_MODE', () => {
    // Guards the assertion below against a misleading pass: this test only
    // means something if it actually ran under the strict production
    // numbers, not the suite's own widened E2E allowance.
    expect(process.env.E2E_TEST_MODE).not.toBe('true');

    const auth = getAuth();
    const configuredRule = auth.options.rateLimit?.customRules?.['/sign-in/email'];
    expect(configuredRule).toEqual({ window: 60, max: 5 });
  });
});
