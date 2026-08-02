import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { generateId } from '@/lib/identifiers';
import { closeDb } from '@/server/db/client';
import { accounts, rateLimits, sessions, users } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

let requestHeaders = new Headers();

vi.mock('next/headers', () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: () => undefined }),
}));

const { buildAuth, getAuth } = await import('@/lib/auth/server');
const { getOptionalSession } = await import('./dal');

const createdUserIds: string[] = [];

async function createCredentialUser() {
  const db = getTestDb();
  const userId = generateId();
  const email = `session-${crypto.randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  await db.insert(users).values({
    id: userId,
    name: 'Session Test',
    email,
    emailVerified: true,
  });
  await db.insert(accounts).values({
    id: generateId(),
    userId,
    accountId: userId,
    providerId: 'credential',
    password: await hashPassword(password),
  });
  createdUserIds.push(userId);
  return { userId, email, password };
}

function cookiesFrom(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  return setCookies.filter(Boolean).map((value) => value.split(';', 1)[0]!);
}

describe('real Better Auth session boundary', () => {
  afterEach(async () => {
    requestHeaders = new Headers();
    const db = getTestDb();
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeDb();
    await closeTestDb();
  });

  it('rejects a revoked database session even when its signed session-data cache is replayed', async () => {
    const { userId, email, password } = await createCredentialUser();
    const auth = getAuth();
    const signIn = await auth.api.signInEmail({
      body: { email, password },
      headers: new Headers({ origin: 'http://localhost:3000' }),
      asResponse: true,
    });
    const sessionCookies = cookiesFrom(signIn);
    expect(sessionCookies.some((cookie) => cookie.includes('session_token='))).toBe(true);

    const initialCookie = sessionCookies.join('; ');
    const sessionResponse = await auth.api.getSession({
      headers: new Headers({ cookie: initialCookie }),
      asResponse: true,
    });
    const allCookies = [...sessionCookies, ...cookiesFrom(sessionResponse)];
    expect(allCookies.some((cookie) => cookie.includes('session_data='))).toBe(true);

    requestHeaders = new Headers({ cookie: allCookies.join('; ') });
    expect((await getOptionalSession())?.user.id).toBe(userId);

    await getTestDb().delete(sessions).where(eq(sessions.userId, userId));

    // The exact token and signed cache remain in the request. Authorization
    // must nevertheless consult PostgreSQL and observe revocation immediately.
    expect(await getOptionalSession()).toBeNull();
  });

  it('commits user and credential account atomically before a failing provisioning hook', async () => {
    const email = `hook-${crypto.randomUUID()}@example.test`;
    const auth = buildAuth({
      afterUserCreated: async () => {
        throw new Error('simulated workspace provisioning failure');
      },
    });

    await expect(
      auth.api.signUpEmail({
        body: { name: 'Hook Failure', email, password: 'correct-horse-battery-staple' },
        headers: new Headers({ origin: 'http://localhost:3000' }),
      }),
    ).rejects.toThrow(/provisioning failure/);

    const db = getTestDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(user).toBeDefined();
    if (user === undefined) return;
    createdUserIds.push(user.id);
    const account = await db.query.accounts.findFirst({
      where: and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')),
    });
    expect(account).toBeDefined();
  });

  it('round-trips Better Auth epoch milliseconds as an exact JavaScript number', async () => {
    const db = getTestDb();
    const key = `numeric-contract-${crypto.randomUUID()}`;
    const lastRequest = Date.now();
    try {
      await db.insert(rateLimits).values({ key, count: 3, lastRequest });
      const row = await db.query.rateLimits.findFirst({ where: eq(rateLimits.key, key) });
      expect(row?.lastRequest).toBe(lastRequest);
      expect(typeof row?.lastRequest).toBe('number');
    } finally {
      await db.delete(rateLimits).where(eq(rateLimits.key, key));
    }
  });
});
