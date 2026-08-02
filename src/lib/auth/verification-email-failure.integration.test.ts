import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Exercises the real Better Auth instance against a real, disposable
 * database, with the application-owned email adapter replaced by a mock
 * that can be made to fail on demand — the only way to prove "sign-up still
 * succeeds, and a subsequent resend still works once the adapter recovers"
 * without a real (or even simulated) SMTP outage.
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

describe('Better Auth verification email failure handling (real database, mocked adapter)', () => {
  afterEach(async () => {
    sendVerificationEmailMock.mockReset();
    const db = getTestDb();
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeDb();
    await closeTestDb();
  });

  it('still creates the account and returns success when automatic SMTP delivery fails, without surfacing the delivery error', async () => {
    sendVerificationEmailMock.mockRejectedValueOnce(new Error('Mailpit unreachable: ECONNREFUSED'));
    const auth = getAuth();
    const email = `smtp-down-${crypto.randomUUID()}@example.test`;

    // Better Auth's own runInBackgroundOrAwait catches and logs the delivery
    // error (ADR 0013) — sign-up itself must not fail just because the
    // downstream SMTP send did, and the response must not describe the
    // delivery failure (no token, no adapter error message).
    const result = await auth.api.signUpEmail({
      body: { name: 'Retry Path', email, password: 'correct-horse-battery-staple' },
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
    expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1);
  });

  it('lets the user retry through resend once the adapter recovers', async () => {
    sendVerificationEmailMock.mockRejectedValueOnce(new Error('Mailpit unreachable: ECONNREFUSED'));
    sendVerificationEmailMock.mockResolvedValueOnce(undefined);

    const auth = getAuth();
    const email = `smtp-recovers-${crypto.randomUUID()}@example.test`;

    await auth.api.signUpEmail({
      body: { name: 'Retry Path', email, password: 'correct-horse-battery-staple' },
      headers: new Headers({ origin: 'http://localhost:3000' }),
    });

    const db = getTestDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(user).toBeDefined();
    if (user !== undefined) createdUserIds.push(user.id);
    expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1);

    const resend = await auth.api.sendVerificationEmail({
      body: { email, callbackURL: '/verify-email/complete' },
      headers: new Headers({ origin: 'http://localhost:3000' }),
      asResponse: true,
    });

    expect(resend.status).toBe(200);
    expect(sendVerificationEmailMock).toHaveBeenCalledTimes(2);
  });
});
