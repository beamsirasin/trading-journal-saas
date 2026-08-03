import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/server/db/client';
import { rateLimits, users } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';
import { VALID_TEST_PASSWORD } from '@/test/test-passwords';

/**
 * Exercises the real Better Auth instance against a real, disposable
 * database, with the application-owned email adapter replaced by a mock
 * that can be made to fail on demand — the only way to prove the delivery
 * failure behavior below without a real (or even simulated) SMTP outage.
 *
 * Phase 2.1's follow-up turned `emailVerification.sendOnSignUp` OFF, so
 * `signUpEmail` no longer touches the email adapter at all — the adapter is
 * only ever reached by the explicit `/send-verification-email` dispatch
 * call `AuthForm` makes after every accepted signup
 * (`src/components/auth/auth-form.tsx`), which is what these tests target
 * now. Unlike the old `sendOnSignUp` path (backgrounded via
 * `runInBackgroundOrAwait`, which swallows a failure), the unauthenticated
 * `/send-verification-email` endpoint re-throws a genuine adapter failure
 * after its timing floor (`email-verification.mjs`) — confirmed against
 * `better-call@1.3.7`'s `router.mjs`: an uncaught non-`APIError` throw
 * reaching the real HTTP router becomes `new Response(null, { status: 500
 * })`, a null body, never the underlying error message. That is why this
 * file drives the failing call through `auth.handler(request)` (the real
 * router) rather than `auth.api.sendVerificationEmail` — a direct
 * `auth.api.*` call has no such catch-and-convert step and would simply
 * reject the call instead of resolving to a response to assert on.
 */
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const sendVerificationEmailMock = vi.fn();

vi.mock('@/lib/auth/email', () => ({
  getEmailAdapter: () => ({
    sendVerificationEmail: sendVerificationEmailMock,
    sendPasswordResetEmail: vi.fn(),
  }),
}));

const { getAuth } = await import('@/lib/auth/server');

const createdUserIds: string[] = [];

/**
 * Shared with `registration-hardening.integration.test.ts` and
 * `verification-email.integration.test.ts` — same fixed `"127.0.0.1"` test
 * identity, same real database-backed bucket (`rateLimit.storage: 'database'`
 * in `src/lib/auth/server.ts`). This test needs two dispatch calls to
 * succeed within the configured `max: 3`, so it resets the bucket itself
 * rather than assuming whichever integration file ran before it left the
 * bucket empty.
 */
const DISPATCH_RATE_LIMIT_KEY = '127.0.0.1|/send-verification-email';

async function resetDispatchRateLimitBucket(): Promise<void> {
  await getTestDb().delete(rateLimits).where(eq(rateLimits.key, DISPATCH_RATE_LIMIT_KEY));
}

describe('Better Auth verification email failure handling (real database, mocked adapter)', () => {
  afterEach(async () => {
    sendVerificationEmailMock.mockReset();
    const db = getTestDb();
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
    await resetDispatchRateLimitBucket();
  });

  afterAll(async () => {
    await closeDb();
    await closeTestDb();
  });

  function dispatchVerificationEmailRequest(
    auth: ReturnType<typeof getAuth>,
    email: string,
  ): Promise<Response> {
    return auth.handler(
      new Request('http://localhost:3000/api/auth/send-verification-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ email, callbackURL: '/verify-email/complete' }),
      }),
    );
  }

  it('creates the account regardless of the email adapter — signUpEmail never touches it now that sendOnSignUp is off', async () => {
    sendVerificationEmailMock.mockRejectedValueOnce(new Error('Mailpit unreachable: ECONNREFUSED'));
    const auth = getAuth();
    const email = `smtp-down-${crypto.randomUUID()}@example.test`;

    const result = await auth.api.signUpEmail({
      body: { name: 'Retry Path', email, password: VALID_TEST_PASSWORD },
      headers: new Headers({ origin: 'http://localhost:3000' }),
      asResponse: true,
    });
    expect(result.status).toBe(200);
    const body = (await result.json()) as { user?: { email?: string } };
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('Mailpit');

    const db = getTestDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(user).toBeDefined();
    if (user !== undefined) createdUserIds.push(user.id);
    // sendOnSignUp is off (src/lib/auth/server.ts) — the account is created
    // and the response succeeds independent of the (here, broken) adapter,
    // because signUpEmail never calls it at all anymore.
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
  });

  it('surfaces a genuine dispatch failure as a bare 500 with no leaked delivery error, and lets the user retry once the adapter recovers', async () => {
    await resetDispatchRateLimitBucket();
    sendVerificationEmailMock.mockRejectedValueOnce(new Error('Mailpit unreachable: ECONNREFUSED'));
    sendVerificationEmailMock.mockResolvedValueOnce(undefined);

    const auth = getAuth();
    const email = `smtp-recovers-${crypto.randomUUID()}@example.test`;

    await auth.api.signUpEmail({
      body: { name: 'Retry Path', email, password: VALID_TEST_PASSWORD },
      headers: new Headers({ origin: 'http://localhost:3000' }),
    });
    const db = getTestDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(user).toBeDefined();
    if (user !== undefined) createdUserIds.push(user.id);
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();

    // The first explicit dispatch (mirrors AuthForm's own post-signup call)
    // hits the broken adapter. Unlike the old sendOnSignUp path, this is not
    // swallowed — better-call's router converts the uncaught throw to a
    // bare 500 with a null body (router.mjs), never the adapter's message.
    const failedAttempt = await dispatchVerificationEmailRequest(auth, email);
    expect(failedAttempt.status).toBe(500);
    const failedBody = await failedAttempt.text();
    expect(failedBody).not.toContain('ECONNREFUSED');
    expect(failedBody).not.toContain('Mailpit');
    expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1);

    // Retrying (mirrors pressing the manual Resend button) once the
    // adapter has recovered succeeds.
    const recoveredAttempt = await dispatchVerificationEmailRequest(auth, email);
    expect(recoveredAttempt.status).toBe(200);
    expect(sendVerificationEmailMock).toHaveBeenCalledTimes(2);
  });
});
