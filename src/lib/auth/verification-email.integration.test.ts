import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/server/db/client';
import { rateLimits, users } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Exercises the real Better Auth instance against a real, disposable
 * database (see `src/test/integration-db.ts`) — the only way to prove
 * "exactly one verification email per sign-up, exactly one more per
 * explicit resend" as a property of Better Auth's own `sendOnSignUp`
 * wiring (`src/lib/auth/server.ts`), rather than of our own code, which
 * cannot be faked with a mock and still mean anything.
 *
 * `next/headers` is mocked the same way `session-boundary.integration.test.ts`
 * mocks it: no cookie present, so `resolveRequestEmailLocale` in
 * `src/lib/auth/server.ts` falls back to English without needing a real
 * Next.js request context.
 */
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const { getAuth } = await import('@/lib/auth/server');
const { getEmailAdapter } = await import('@/lib/auth/email');

interface CapturedTestEmailAdapter {
  readonly sent: ReadonlyArray<{
    kind: 'verification' | 'password-reset';
    to: string;
    url: string;
  }>;
  reset(): void;
}

function testAdapter(): CapturedTestEmailAdapter {
  const adapter = getEmailAdapter();
  if (!('sent' in adapter) || !('reset' in adapter)) {
    throw new Error(
      'Expected the deterministic TestEmailAdapter (NODE_ENV=test) — got a different adapter.',
    );
  }
  return adapter as CapturedTestEmailAdapter;
}

const createdUserIds: string[] = [];

/**
 * Better Auth's rate limiter (`@better-auth/core/utils/ip`'s `getIp`) falls
 * back to a fixed `"127.0.0.1"` client identity whenever `isTest()` is true
 * and no `x-forwarded-for` header is present — which is exactly this test
 * process (`NODE_ENV=test`, no forwarded header sent below). Combined with
 * the fixed request path, the key is always this exact string
 * (`createRateLimitKey`, `dist/api/rate-limiter/index.mjs`). Storage is
 * `database` (`src/lib/auth/server.ts`'s `rateLimit.storage`), so the
 * counter row persists in Postgres across test runs — cleared before and
 * after use so this test is isolated from anything else that has ever hit
 * this path with this IP.
 */
const RESEND_RATE_LIMIT_KEY = '127.0.0.1|/send-verification-email';

async function resetResendRateLimitBucket(): Promise<void> {
  await getTestDb().delete(rateLimits).where(eq(rateLimits.key, RESEND_RATE_LIMIT_KEY));
}

/**
 * `auth.api.sendVerificationEmail(...)` — used by the other tests in this
 * file — calls `dispatchAuthEndpoint` directly (`to-auth-endpoints.mjs`) and
 * never touches Better Auth's router. Rate limiting lives entirely in the
 * router's `onRequest` hook (`onRequestRateLimit`, `dist/api/index.mjs` /
 * `dist/api/rate-limiter/index.mjs`), which only runs for a request that
 * goes through `auth.handler(request)` — the exact method `toNextJsHandler`
 * calls (`dist/integrations/next-js.mjs`: `"handler" in auth ?
 * auth.handler(request) : auth(request)`), i.e. the real
 * `/api/auth/[...all]/route.ts` path. A direct `auth.api.*` call is
 * therefore the wrong layer to prove rate limiting from — no number of
 * calls through it will ever see a 429, regardless of the configured limit.
 */
function sendVerificationEmailRequest(
  auth: ReturnType<typeof getAuth>,
  email: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return auth.handler(
    new Request('http://localhost:3000/api/auth/send-verification-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        ...extraHeaders,
      },
      body: JSON.stringify({ email, callbackURL: '/verify-email/complete' }),
    }),
  );
}

describe('Better Auth verification email delivery (real database)', () => {
  beforeEach(() => {
    testAdapter().reset();
  });

  afterEach(async () => {
    const db = getTestDb();
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeDb();
    await closeTestDb();
  });

  it('sends exactly one verification email on sign-up, never a duplicate', async () => {
    const auth = getAuth();
    const email = `verify-once-${crypto.randomUUID()}@example.test`;

    await auth.api.signUpEmail({
      body: { name: 'Verify Once', email, password: 'correct-horse-battery-staple' },
      headers: new Headers({ origin: 'http://localhost:3000' }),
    });

    const db = getTestDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(user).toBeDefined();
    if (user !== undefined) createdUserIds.push(user.id);

    const sentToUser = testAdapter().sent.filter((message) => message.to === email);
    expect(sentToUser).toHaveLength(1);
    expect(sentToUser[0]?.kind).toBe('verification');
  });

  it('sends exactly one additional email when verification is explicitly resent', async () => {
    const auth = getAuth();
    const email = `verify-resend-${crypto.randomUUID()}@example.test`;

    await auth.api.signUpEmail({
      body: { name: 'Resend Once', email, password: 'correct-horse-battery-staple' },
      headers: new Headers({ origin: 'http://localhost:3000' }),
    });

    const db = getTestDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(user).toBeDefined();
    if (user !== undefined) createdUserIds.push(user.id);

    expect(testAdapter().sent.filter((message) => message.to === email)).toHaveLength(1);

    // Mirrors what ResendVerificationButton (src/components/auth/resend-verification-button.tsx)
    // actually calls through better-auth/react's client — the real
    // `/send-verification-email` endpoint, not a stub.
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: '/verify-email/complete' },
      headers: new Headers({ origin: 'http://localhost:3000' }),
    });

    const sentAfterResend = testAdapter().sent.filter((message) => message.to === email);
    expect(sentAfterResend).toHaveLength(2);
    expect(sentAfterResend.every((message) => message.kind === 'verification')).toBe(true);
  });

  it('keeps the resend endpoint rate limited via the real HTTP router (buildRateLimitCustomRules: max 3 per 60s)', async () => {
    const auth = getAuth();
    const email = `verify-ratelimit-${crypto.randomUUID()}@example.test`;

    await auth.api.signUpEmail({
      body: { name: 'Rate Limited', email, password: 'correct-horse-battery-staple' },
      headers: new Headers({ origin: 'http://localhost:3000' }),
    });

    const db = getTestDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(user).toBeDefined();
    if (user !== undefined) createdUserIds.push(user.id);
    testAdapter().reset();
    await resetResendRateLimitBucket();

    // The unauthenticated resend path enforces a >=500ms constant-time floor
    // per call (email-verification.mjs) for genuinely-processed requests, but
    // a blocked request never reaches that code — `onRequestRateLimit`
    // short-circuits inside the router's `onRequest` hook before the
    // endpoint handler runs — so only the first 3 (accepted) calls pay it.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await sendVerificationEmailRequest(auth, email);
      statuses.push(response.status);
    }

    // Exact sequence, not just "some 429 occurs": the bucket is guaranteed
    // clean (resetResendRateLimitBucket above) and better-auth@1.6.25's
    // `decideConsume`/`createDatabaseStorageWrapper.consume`
    // (`dist/api/rate-limiter/index.mjs`) allow while `count < max` and
    // block from the moment `count >= max` — with `max: 3`, that is
    // deterministically the 4th call in this fresh bucket.
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);

    // A blocked (429) attempt must never have reached the email adapter —
    // only genuinely accepted (200) attempts may have sent anything.
    const acceptedCount = statuses.filter((status) => status === 200).length;
    const deliveredCount = testAdapter().sent.filter((message) => message.to === email).length;
    expect(deliveredCount).toBe(acceptedCount);

    await resetResendRateLimitBucket();
  });

  it('gives a different client identity (x-forwarded-for) its own separate rate-limit allowance', async () => {
    const auth = getAuth();
    const email = `verify-ratelimit-other-ip-${crypto.randomUUID()}@example.test`;
    const otherIpKey = '203.0.113.5|/send-verification-email';

    await auth.api.signUpEmail({
      body: { name: 'Other IP', email, password: 'correct-horse-battery-staple' },
      headers: new Headers({ origin: 'http://localhost:3000' }),
    });
    const db = getTestDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(user).toBeDefined();
    if (user !== undefined) createdUserIds.push(user.id);

    await getTestDb().delete(rateLimits).where(eq(rateLimits.key, RESEND_RATE_LIMIT_KEY));
    await getTestDb().delete(rateLimits).where(eq(rateLimits.key, otherIpKey));

    // Exhaust the default ("127.0.0.1") bucket first.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await sendVerificationEmailRequest(auth, email);
      expect(response.status).toBe(200);
    }
    const blocked = await sendVerificationEmailRequest(auth, email);
    expect(blocked.status).toBe(429);

    // A distinct forwarded IP is a distinct rate-limit key, so it still has
    // its full allowance even though "127.0.0.1" is exhausted.
    const otherIp = await sendVerificationEmailRequest(auth, email, {
      'x-forwarded-for': '203.0.113.5',
    });
    expect(otherIp.status).toBe(200);

    await getTestDb().delete(rateLimits).where(eq(rateLimits.key, RESEND_RATE_LIMIT_KEY));
    await getTestDb().delete(rateLimits).where(eq(rateLimits.key, otherIpKey));
  });

  it('does not let the resend-specific limit block an unrelated auth endpoint', async () => {
    const auth = getAuth();
    const email = `verify-ratelimit-unrelated-${crypto.randomUUID()}@example.test`;

    await auth.api.signUpEmail({
      body: { name: 'Unrelated Endpoint', email, password: 'correct-horse-battery-staple' },
      headers: new Headers({ origin: 'http://localhost:3000' }),
    });
    const db = getTestDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(user).toBeDefined();
    if (user !== undefined) createdUserIds.push(user.id);

    await resetResendRateLimitBucket();
    // Exhaust the resend bucket for "127.0.0.1".
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await sendVerificationEmailRequest(auth, email);
    }

    // `/get-session` is not in better-auth's default special rules
    // (`getDefaultSpecialRules`, sign-in/sign-up/change-password/change-email
    // and reset-password/send-verification-email/forget-password) and has no
    // custom rule of its own — it must not inherit the resend path's block.
    const sessionResponse = await auth.handler(
      new Request('http://localhost:3000/api/auth/get-session', {
        method: 'GET',
        headers: { origin: 'http://localhost:3000' },
      }),
    );
    expect(sessionResponse.status).not.toBe(429);

    await resetResendRateLimitBucket();
  });

  it('carries the configured resend rate-limit rule in the real, final Better Auth configuration', () => {
    const auth = getAuth();
    expect(auth.options.rateLimit?.enabled).toBe(true);
    expect(auth.options.rateLimit?.storage).toBe('database');
    expect(auth.options.rateLimit?.customRules?.['/send-verification-email']).toEqual({
      window: 60,
      max: 3,
    });
  });
});
