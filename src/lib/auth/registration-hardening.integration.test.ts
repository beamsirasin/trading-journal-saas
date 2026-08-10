import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/server/db/client';
import { accounts, auditLogs, rateLimits, users, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';
import { VALID_TEST_PASSWORD } from '@/test/test-passwords';

/**
 * Exercises Phase 2.1's registration hardening — the password-policy
 * before-hook, Better Auth's own lowercase-email normalization and
 * synthetic-duplicate-response behavior, and (this file's newer additions)
 * the Phase 2.1 follow-up's post-registration verification-dispatch
 * sequence (`src/lib/auth/server.ts`'s `sendOnSignUp: false` plus
 * `AuthForm`'s explicit `sendVerificationEmail` call) — against the real
 * Better Auth instance and a real, disposable database. Mirrors
 * `verification-email.integration.test.ts`'s `next/headers` mock for the
 * same reason (no cookie present, so `resolveRequestEmailLocale` falls back
 * to English without a real Next.js request context).
 */
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const { getAuth } = await import('./server');
const { getEmailAdapter } = await import('./email');

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

const WEAK_PASSWORD = 'alllowercaseonly';

function signUpEmailRequest(
  auth: ReturnType<typeof getAuth>,
  body: { name: string; email: string; password: string },
): Promise<Response> {
  return auth.handler(
    new Request('http://localhost:3000/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        'x-forwarded-for': TEST_CLIENT_IP,
      },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * The exact call `AuthForm`'s client-side `sendVerificationEmail(...)` makes
 * (`src/components/auth/auth-form.tsx`), replayed here through the real
 * HTTP router (`auth.handler`) rather than `auth.api.*` — the router is the
 * only path that enforces the rate limiter (see this project's earlier
 * `enforceSignUpPasswordPolicy` finding: `auth.api.*` calls
 * `dispatchAuthEndpoint` directly, bypassing `onRequest`/`onRequestRateLimit`
 * entirely), and the task this file was extended for is explicit that
 * rate-limit assertions must use this real path, never `auth.api`.
 */
function dispatchVerificationEmailRequest(
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
        'x-forwarded-for': TEST_CLIENT_IP,
        ...extraHeaders,
      },
      body: JSON.stringify({ email, callbackURL: '/verify-email/complete' }),
    }),
  );
}

/**
 * This file sends a stable reserved TEST-NET identity. Database-backed
 * buckets persist across processes, so using a file-specific key prevents
 * another auth integration file from changing this file's allowance while
 * clean-before/after protects retries after an interrupted run.
 */
const TEST_CLIENT_IP = '203.0.113.13';
const SIGNUP_RATE_LIMIT_KEY = `${TEST_CLIENT_IP}|/sign-up/email`;
const DISPATCH_RATE_LIMIT_KEY = `${TEST_CLIENT_IP}|/send-verification-email`;

async function resetRateLimitBuckets(): Promise<void> {
  const db = getTestDb();
  await db.delete(rateLimits).where(eq(rateLimits.key, SIGNUP_RATE_LIMIT_KEY));
  await db.delete(rateLimits).where(eq(rateLimits.key, DISPATCH_RATE_LIMIT_KEY));
}

async function findUserByEmail(email: string) {
  return getTestDb().query.users.findFirst({ where: eq(users.email, email) });
}

const createdUserIds: string[] = [];

function trackUser(userId: string | undefined) {
  if (userId !== undefined) createdUserIds.push(userId);
}

describe('Registration hardening (real Better Auth + database)', () => {
  beforeEach(async () => {
    // A prior interrupted integration process cannot be trusted to have run
    // its afterEach cleanup. Start every test from empty shared IP+route
    // buckets as well as cleaning after it.
    await resetRateLimitBuckets();
  });

  afterEach(async () => {
    const db = getTestDb();
    for (const userId of createdUserIds.splice(0)) {
      // Cascades to accounts/workspaces/workspace_members/audit_logs via the
      // FK `onDelete` rules declared across src/server/db/schema/.
      await db.delete(users).where(eq(users.id, userId));
    }
    await resetRateLimitBuckets();
  });

  afterAll(async () => {
    await closeDb();
    await closeTestDb();
  });

  describe('server-side password policy enforcement (real HTTP boundary)', () => {
    it('rejects a weak password with a sanitized WEAK_PASSWORD error before any user row is created', async () => {
      const auth = getAuth();
      const email = `weak-${crypto.randomUUID()}@example.test`;

      const response = await signUpEmailRequest(auth, {
        name: 'Weak Password',
        email,
        password: WEAK_PASSWORD,
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe('WEAK_PASSWORD');

      expect(await findUserByEmail(email)).toBeUndefined();
    });

    it('rejects a weak password before any verification email is sent', async () => {
      const auth = getAuth();
      const email = `weak-noemail-${crypto.randomUUID()}@example.test`;
      testAdapter().reset();

      await signUpEmailRequest(auth, {
        name: 'Weak Password',
        email,
        password: WEAK_PASSWORD,
      });

      expect(testAdapter().sent.filter((message) => message.to === email)).toHaveLength(0);
    });

    it('never echoes the submitted password value back in the rejection response', async () => {
      const auth = getAuth();
      const email = `weak-noecho-${crypto.randomUUID()}@example.test`;

      const response = await signUpEmailRequest(auth, {
        name: 'Weak Password',
        email,
        password: WEAK_PASSWORD,
      });

      const rawBody = await response.text();
      expect(rawBody).not.toContain(WEAK_PASSWORD);
    });

    it('does not affect /sign-in/email — a wrong password for a nonexistent user gets ordinary invalid-credentials, never WEAK_PASSWORD', async () => {
      const auth = getAuth();
      const email = `no-such-user-${crypto.randomUUID()}@example.test`;

      const response = await auth.handler(
        new Request('http://localhost:3000/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            'x-forwarded-for': TEST_CLIENT_IP,
          },
          body: JSON.stringify({ email, password: 'short' }),
        }),
      );

      const body = (await response.json()) as { code?: string };
      expect(body.code).not.toBe('WEAK_PASSWORD');
      expect(response.status).not.toBe(400);
    });
  });

  describe('final Better Auth configuration for verification dispatch', () => {
    it('has sendOnSignUp disabled (dispatch now happens client-side, after every accepted signup)', () => {
      const auth = getAuth();
      expect(auth.options.emailVerification?.sendOnSignUp).toBe(false);
    });

    it('keeps sendOnSignIn enabled (the expired-link recovery path is unaffected)', () => {
      const auth = getAuth();
      expect(auth.options.emailVerification?.sendOnSignIn).toBe(true);
    });

    it('does not send a verification email from signup alone', async () => {
      const auth = getAuth();
      const email = `no-auto-send-${crypto.randomUUID()}@example.test`;
      testAdapter().reset();

      const response = await signUpEmailRequest(auth, {
        name: 'No Auto Send',
        email,
        password: VALID_TEST_PASSWORD,
      });
      expect(response.status).toBe(200);
      const user = await findUserByEmail(email);
      trackUser(user?.id);

      expect(testAdapter().sent.filter((message) => message.to === email)).toHaveLength(0);
    });
  });

  describe('new email', () => {
    it('signup creates exactly one user, one credential account, and one personal workspace', async () => {
      const auth = getAuth();
      const email = `new-${crypto.randomUUID()}@example.test`;

      const response = await signUpEmailRequest(auth, {
        name: 'New User',
        email,
        password: VALID_TEST_PASSWORD,
      });
      expect(response.status).toBe(200);

      const db = getTestDb();
      const userRows = await db.select().from(users).where(eq(users.email, email));
      expect(userRows).toHaveLength(1);
      const user = userRows[0];
      if (user === undefined) throw new Error('expected the signup to create a user');
      trackUser(user.id);

      const accountRows = await db.select().from(accounts).where(eq(accounts.userId, user.id));
      expect(accountRows).toHaveLength(1);

      const workspaceRows = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.personalOwnerUserId, user.id));
      expect(workspaceRows).toHaveLength(1);
    });

    it('post-signup verification dispatch sends exactly one message, with no automatic second message from sendOnSignUp', async () => {
      const auth = getAuth();
      const email = `new-dispatch-${crypto.randomUUID()}@example.test`;
      testAdapter().reset();

      await signUpEmailRequest(auth, { name: 'New User', email, password: VALID_TEST_PASSWORD });
      const user = await findUserByEmail(email);
      trackUser(user?.id);
      expect(testAdapter().sent.filter((message) => message.to === email)).toHaveLength(0);

      const dispatchResponse = await dispatchVerificationEmailRequest(auth, email);
      expect(dispatchResponse.status).toBe(200);

      const sentToUser = testAdapter().sent.filter((message) => message.to === email);
      expect(sentToUser).toHaveLength(1);
      expect(sentToUser[0]?.kind).toBe('verification');
    });
  });

  describe('existing unverified email', () => {
    it('returns the generic accepted response and creates no additional user, account, or workspace', async () => {
      const auth = getAuth();
      const email = `dup-unverified-${crypto.randomUUID()}@example.test`;

      const genuineResponse = await signUpEmailRequest(auth, {
        name: 'Original',
        email,
        password: VALID_TEST_PASSWORD,
      });
      const original = await findUserByEmail(email);
      trackUser(original?.id);
      if (original === undefined) throw new Error('expected the first signup to create a user');

      const duplicateResponse = await signUpEmailRequest(auth, {
        name: 'Impersonator',
        email,
        password: VALID_TEST_PASSWORD,
      });

      expect(genuineResponse.status).toBe(200);
      expect(duplicateResponse.status).toBe(200);

      const db = getTestDb();
      expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(1);
      expect(await db.select().from(accounts).where(eq(accounts.userId, original.id))).toHaveLength(
        1,
      );
      expect(
        await db.select().from(workspaces).where(eq(workspaces.personalOwnerUserId, original.id)),
      ).toHaveLength(1);
    });

    it('does not change the existing password on a duplicate signup attempt', async () => {
      const auth = getAuth();
      const email = `dup-password-${crypto.randomUUID()}@example.test`;

      await signUpEmailRequest(auth, { name: 'Original', email, password: VALID_TEST_PASSWORD });
      const original = await findUserByEmail(email);
      trackUser(original?.id);
      if (original === undefined) throw new Error('expected the first signup to create a user');

      const db = getTestDb();
      const [accountBefore] = await db
        .select({ password: accounts.password })
        .from(accounts)
        .where(eq(accounts.userId, original.id));

      await signUpEmailRequest(auth, {
        name: 'Impersonator',
        email,
        password: 'Totally-Different-Password9!',
      });

      const [accountAfter] = await db
        .select({ password: accounts.password })
        .from(accounts)
        .where(eq(accounts.userId, original.id));
      expect(accountAfter?.password).toBe(accountBefore?.password);
    });

    it('post-signup verification dispatch sends exactly one fresh message to the real, still-unverified account', async () => {
      const auth = getAuth();
      const email = `dup-dispatch-${crypto.randomUUID()}@example.test`;

      await signUpEmailRequest(auth, { name: 'Original', email, password: VALID_TEST_PASSWORD });
      const original = await findUserByEmail(email);
      trackUser(original?.id);
      testAdapter().reset();

      const duplicateResponse = await signUpEmailRequest(auth, {
        name: 'Impersonator',
        email,
        password: VALID_TEST_PASSWORD,
      });
      expect(duplicateResponse.status).toBe(200);
      // The duplicate signup response itself must not have sent anything —
      // only the explicit dispatch call below does.
      expect(testAdapter().sent.filter((message) => message.to === email)).toHaveLength(0);

      const dispatchResponse = await dispatchVerificationEmailRequest(auth, email);
      expect(dispatchResponse.status).toBe(200);

      const sentToUser = testAdapter().sent.filter((message) => message.to === email);
      expect(sentToUser).toHaveLength(1);
      expect(sentToUser[0]?.kind).toBe('verification');
    });
  });

  describe('case variant of an existing unverified email', () => {
    it('behaves as the same identity — no duplicate records, one fresh verification message', async () => {
      const auth = getAuth();
      const localPart = `case-dispatch-${crypto.randomUUID()}`;
      const lowerEmail = `${localPart}@example.test`;
      const upperVariant = `${localPart.toUpperCase()}@example.test`;

      await signUpEmailRequest(auth, {
        name: 'Original',
        email: lowerEmail,
        password: VALID_TEST_PASSWORD,
      });
      const original = await findUserByEmail(lowerEmail);
      trackUser(original?.id);
      if (original === undefined) throw new Error('expected the first signup to create a user');

      await signUpEmailRequest(auth, {
        name: 'Case Variant',
        email: upperVariant,
        password: VALID_TEST_PASSWORD,
      });

      const db = getTestDb();
      const rows = await db.select().from(users).where(eq(users.email, lowerEmail));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(original.id);

      testAdapter().reset();
      const dispatchResponse = await dispatchVerificationEmailRequest(auth, upperVariant);
      expect(dispatchResponse.status).toBe(200);

      const sentToUser = testAdapter().sent.filter((message) => message.to === lowerEmail);
      expect(sentToUser).toHaveLength(1);
    });
  });

  describe('existing verified email', () => {
    async function createVerifiedUser(email: string) {
      const auth = getAuth();
      await signUpEmailRequest(auth, {
        name: 'Verified User',
        email,
        password: VALID_TEST_PASSWORD,
      });
      const user = await findUserByEmail(email);
      if (user === undefined) throw new Error('expected the signup to create a user');
      await getTestDb().update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
      trackUser(user.id);
      return user;
    }

    it('signup returns the same generic accepted response and creates no duplicate records', async () => {
      const auth = getAuth();
      const email = `verified-${crypto.randomUUID()}@example.test`;
      const original = await createVerifiedUser(email);

      const response = await signUpEmailRequest(auth, {
        name: 'Impersonator',
        email,
        password: VALID_TEST_PASSWORD,
      });
      expect(response.status).toBe(200);

      const db = getTestDb();
      expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(1);
      expect(
        await db.select().from(workspaces).where(eq(workspaces.personalOwnerUserId, original.id)),
      ).toHaveLength(1);
    });

    it('verification-dispatch endpoint returns its generic response without invoking the email adapter', async () => {
      const auth = getAuth();
      const email = `verified-dispatch-${crypto.randomUUID()}@example.test`;
      await createVerifiedUser(email);
      testAdapter().reset();

      const dispatchResponse = await dispatchVerificationEmailRequest(auth, email);
      expect(dispatchResponse.status).toBe(200);

      expect(testAdapter().sent.filter((message) => message.to === email)).toHaveLength(0);
    });
  });

  describe('security: response shape stays indistinguishable across new/duplicate/verified outcomes', () => {
    it('signup responds 200 for a new email, an unverified duplicate, and a verified duplicate alike', async () => {
      const auth = getAuth();
      const newEmail = `shape-new-${crypto.randomUUID()}@example.test`;
      const unverifiedEmail = `shape-unverified-${crypto.randomUUID()}@example.test`;
      const verifiedEmail = `shape-verified-${crypto.randomUUID()}@example.test`;

      await signUpEmailRequest(auth, {
        name: 'Unverified',
        email: unverifiedEmail,
        password: VALID_TEST_PASSWORD,
      });
      const unverifiedUser = await findUserByEmail(unverifiedEmail);
      trackUser(unverifiedUser?.id);

      await signUpEmailRequest(auth, {
        name: 'Verified',
        email: verifiedEmail,
        password: VALID_TEST_PASSWORD,
      });
      const verifiedUser = await findUserByEmail(verifiedEmail);
      if (verifiedUser === undefined) throw new Error('expected the signup to create a user');
      await getTestDb()
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, verifiedUser.id));
      trackUser(verifiedUser.id);

      const [newResponse, unverifiedDuplicate, verifiedDuplicate] = await Promise.all([
        signUpEmailRequest(auth, {
          name: 'Brand New',
          email: newEmail,
          password: VALID_TEST_PASSWORD,
        }),
        signUpEmailRequest(auth, {
          name: 'Impersonator',
          email: unverifiedEmail,
          password: VALID_TEST_PASSWORD,
        }),
        signUpEmailRequest(auth, {
          name: 'Impersonator',
          email: verifiedEmail,
          password: VALID_TEST_PASSWORD,
        }),
      ]);
      const newUser = await findUserByEmail(newEmail);
      trackUser(newUser?.id);

      expect(newResponse.status).toBe(200);
      expect(unverifiedDuplicate.status).toBe(200);
      expect(verifiedDuplicate.status).toBe(200);
    });

    it('the dispatch endpoint responds 200 for a nonexistent, unverified, and verified email alike', async () => {
      const auth = getAuth();
      const nonexistentEmail = `shape-dispatch-nonexistent-${crypto.randomUUID()}@example.test`;
      const unverifiedEmail = `shape-dispatch-unverified-${crypto.randomUUID()}@example.test`;
      const verifiedEmail = `shape-dispatch-verified-${crypto.randomUUID()}@example.test`;

      await signUpEmailRequest(auth, {
        name: 'Unverified',
        email: unverifiedEmail,
        password: VALID_TEST_PASSWORD,
      });
      const unverifiedUser = await findUserByEmail(unverifiedEmail);
      trackUser(unverifiedUser?.id);

      await signUpEmailRequest(auth, {
        name: 'Verified',
        email: verifiedEmail,
        password: VALID_TEST_PASSWORD,
      });
      const verifiedUser = await findUserByEmail(verifiedEmail);
      if (verifiedUser === undefined) throw new Error('expected the signup to create a user');
      await getTestDb()
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, verifiedUser.id));
      trackUser(verifiedUser.id);

      const [nonexistentResponse, unverifiedResponse, verifiedResponse] = await Promise.all([
        dispatchVerificationEmailRequest(auth, nonexistentEmail),
        dispatchVerificationEmailRequest(auth, unverifiedEmail),
        dispatchVerificationEmailRequest(auth, verifiedEmail),
      ]);

      expect(nonexistentResponse.status).toBe(200);
      expect(unverifiedResponse.status).toBe(200);
      expect(verifiedResponse.status).toBe(200);
    });

    it('keeps /sign-up/email rate limited via the real HTTP router', async () => {
      const auth = getAuth();
      await resetRateLimitBuckets();
      const configuredRule = auth.options.rateLimit?.customRules?.['/sign-up/email'];
      if (configuredRule === undefined) throw new Error('expected a configured signup rate limit');

      const statuses: number[] = [];
      for (let attempt = 0; attempt < configuredRule.max + 2; attempt += 1) {
        const email = `ratelimit-${crypto.randomUUID()}@example.test`;
        const response = await signUpEmailRequest(auth, {
          name: 'Rate Limited',
          email,
          password: VALID_TEST_PASSWORD,
        });
        statuses.push(response.status);
        const user = await findUserByEmail(email);
        trackUser(user?.id);
      }

      const blockedCount = statuses.filter((status) => status === 429).length;
      expect(blockedCount).toBeGreaterThan(0);
      expect(statuses.slice(0, configuredRule.max).every((status) => status !== 429)).toBe(true);
    });

    it('keeps /send-verification-email rate limited, and a blocked dispatch never invokes the email adapter', async () => {
      const auth = getAuth();
      const email = `dispatch-ratelimit-${crypto.randomUUID()}@example.test`;
      await signUpEmailRequest(auth, {
        name: 'Rate Limited',
        email,
        password: VALID_TEST_PASSWORD,
      });
      const user = await findUserByEmail(email);
      trackUser(user?.id);

      await resetRateLimitBuckets();
      const configuredRule = auth.options.rateLimit?.customRules?.['/send-verification-email'];
      if (configuredRule === undefined)
        throw new Error('expected a configured dispatch rate limit');

      testAdapter().reset();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < configuredRule.max + 2; attempt += 1) {
        const response = await dispatchVerificationEmailRequest(auth, email);
        statuses.push(response.status);
      }

      const acceptedCount = statuses.filter((status) => status === 200).length;
      const blockedCount = statuses.filter((status) => status === 429).length;
      expect(blockedCount).toBeGreaterThan(0);
      // Every accepted call legitimately re-sends (the account stays
      // unverified throughout); a blocked call must never have reached the
      // adapter at all.
      expect(testAdapter().sent.filter((message) => message.to === email)).toHaveLength(
        acceptedCount,
      );
    });

    it('does not let the signup password-policy hook block an unrelated auth endpoint', async () => {
      const auth = getAuth();

      const sessionResponse = await auth.handler(
        new Request('http://localhost:3000/api/auth/get-session', {
          method: 'GET',
          headers: { origin: 'http://localhost:3000' },
        }),
      );

      expect(sessionResponse.status).not.toBe(400);
      const body = (await sessionResponse.json().catch(() => null)) as { code?: string } | null;
      expect(body?.code).not.toBe('WEAK_PASSWORD');
    });
  });

  describe('duplicate-email database uniqueness', () => {
    it('enforces a real database-level unique constraint on users.email, independent of application logic', async () => {
      // Bypasses Better Auth and the application entirely — a raw second
      // insert with the same email, proving `users_email_idx`
      // (`drizzle/0000_init_auth_tenancy.sql`) is a genuine Postgres
      // constraint and not merely an application-level check-then-insert
      // that a bug (or a second code path) could someday skip.
      const db = getTestDb();
      const email = `raw-dup-${crypto.randomUUID()}@example.test`;

      const [first] = await db.insert(users).values({ name: 'First', email }).returning({
        id: users.id,
      });
      if (first === undefined) throw new Error('expected the first raw insert to succeed');
      trackUser(first.id);

      await expect(db.insert(users).values({ name: 'Second', email })).rejects.toThrow();

      const rows = await db.select().from(users).where(eq(users.email, email));
      expect(rows).toHaveLength(1);
    });

    it('yields exactly one user row when the same brand-new email signs up concurrently', async () => {
      const auth = getAuth();
      const email = `concurrent-${crypto.randomUUID()}@example.test`;

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          signUpEmailRequest(auth, { name: 'Racer', email, password: VALID_TEST_PASSWORD }),
        ),
      );

      const db = getTestDb();
      const rows = await db.select().from(users).where(eq(users.email, email));
      expect(rows).toHaveLength(1);
      trackUser(rows[0]?.id);

      for (const response of responses) {
        expect(response.status).toBeLessThan(500);
      }
    });
  });

  describe('audit log hygiene', () => {
    it('never records a password, token, or email value in the workspace-provisioning audit metadata', async () => {
      const auth = getAuth();
      const email = `audit-${crypto.randomUUID()}@example.test`;

      await signUpEmailRequest(auth, { name: 'Audited', email, password: VALID_TEST_PASSWORD });
      const user = await findUserByEmail(email);
      trackUser(user?.id);
      if (user === undefined) throw new Error('expected the signup to create a user');
      await dispatchVerificationEmailRequest(auth, email);

      const db = getTestDb();
      const rows = await db.select().from(auditLogs).where(eq(auditLogs.actorUserId, user.id));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const serialized = JSON.stringify(row.metadata);
        expect(serialized).not.toContain(VALID_TEST_PASSWORD);
        expect(serialized).not.toContain(email);
        expect(serialized.toLowerCase()).not.toMatch(/password|token/);
      }
    });
  });
});
