import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
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
});
