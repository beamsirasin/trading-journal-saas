import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/server/db/client';
import { accounts, auditLogs, rateLimits, users, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Exercises Phase 2.1's registration hardening (`src/lib/auth/server.ts`'s
 * `enforceSignUpPasswordPolicy` before-hook, Better Auth's own
 * lowercase-email normalization and synthetic-duplicate-response behavior)
 * against the real Better Auth instance and a real, disposable database —
 * exactly like the sibling `verification-email.integration.test.ts` file,
 * whose `next/headers` mock this test reuses for the same reason (no cookie
 * present, so `resolveRequestEmailLocale` falls back to English without a
 * real Next.js request context).
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

const VALID_PASSWORD = 'Correct-Horse9!';
const WEAK_PASSWORD = 'alllowercaseonly';

function signUpEmailRequest(
  auth: ReturnType<typeof getAuth>,
  body: { name: string; email: string; password: string },
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return auth.handler(
    new Request('http://localhost:3000/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Better Auth's rate limiter falls back to a fixed `"127.0.0.1"` client
 * identity when `isTest()` is true and no `x-forwarded-for` header is
 * present (see `verification-email.integration.test.ts`'s identical
 * reasoning for the `/send-verification-email` key). `storage: 'database'`
 * means the bucket persists across test runs, so it is cleared before and
 * after use.
 */
const SIGNUP_RATE_LIMIT_KEY = '127.0.0.1|/sign-up/email';

async function resetSignUpRateLimitBucket(): Promise<void> {
  await getTestDb().delete(rateLimits).where(eq(rateLimits.key, SIGNUP_RATE_LIMIT_KEY));
}

async function findUserByEmail(email: string) {
  return getTestDb().query.users.findFirst({ where: eq(users.email, email) });
}

const createdUserIds: string[] = [];

function trackUser(userId: string | undefined) {
  if (userId !== undefined) createdUserIds.push(userId);
}

describe('Registration hardening (real Better Auth + database)', () => {
  afterEach(async () => {
    const db = getTestDb();
    for (const userId of createdUserIds.splice(0)) {
      // Cascades to accounts/workspaces/workspace_members/audit_logs via the
      // FK `onDelete` rules declared across src/server/db/schema/.
      await db.delete(users).where(eq(users.id, userId));
    }
    await resetSignUpRateLimitBucket();
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

    it('accepts a valid password and creates exactly one user row', async () => {
      const auth = getAuth();
      const email = `strong-${crypto.randomUUID()}@example.test`;

      const response = await signUpEmailRequest(auth, {
        name: 'Strong Password',
        email,
        password: VALID_PASSWORD,
      });
      expect(response.status).toBe(200);

      const user = await findUserByEmail(email);
      expect(user).toBeDefined();
      trackUser(user?.id);
    });

    it('accepts a valid password and sends exactly one verification email', async () => {
      const auth = getAuth();
      const email = `strong-email-${crypto.randomUUID()}@example.test`;
      testAdapter().reset();

      await signUpEmailRequest(auth, {
        name: 'Strong Password',
        email,
        password: VALID_PASSWORD,
      });

      const user = await findUserByEmail(email);
      trackUser(user?.id);

      const sentToUser = testAdapter().sent.filter((message) => message.to === email);
      expect(sentToUser).toHaveLength(1);
      expect(sentToUser[0]?.kind).toBe('verification');
    });

    it('does not affect /sign-in/email — a wrong password for a nonexistent user gets ordinary invalid-credentials, never WEAK_PASSWORD', async () => {
      const auth = getAuth();
      const email = `no-such-user-${crypto.randomUUID()}@example.test`;

      const response = await auth.handler(
        new Request('http://localhost:3000/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
          body: JSON.stringify({ email, password: 'short' }),
        }),
      );

      const body = (await response.json()) as { code?: string };
      expect(body.code).not.toBe('WEAK_PASSWORD');
      expect(response.status).not.toBe(400);
    });
  });

  describe('duplicate-email handling', () => {
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

    it('creates no additional user row for a duplicate canonical email', async () => {
      const auth = getAuth();
      const email = `dup-user-${crypto.randomUUID()}@example.test`;

      await signUpEmailRequest(auth, { name: 'Original', email, password: VALID_PASSWORD });
      const original = await findUserByEmail(email);
      trackUser(original?.id);

      await signUpEmailRequest(auth, { name: 'Impersonator', email, password: VALID_PASSWORD });

      const db = getTestDb();
      const rows = await db.select().from(users).where(eq(users.email, email));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(original?.id);
    });

    it('creates no additional credential account row for a duplicate signup', async () => {
      const auth = getAuth();
      const email = `dup-account-${crypto.randomUUID()}@example.test`;

      await signUpEmailRequest(auth, { name: 'Original', email, password: VALID_PASSWORD });
      const original = await findUserByEmail(email);
      trackUser(original?.id);
      if (original === undefined) throw new Error('expected the first signup to create a user');

      await signUpEmailRequest(auth, { name: 'Impersonator', email, password: VALID_PASSWORD });

      const db = getTestDb();
      const accountRows = await db.select().from(accounts).where(eq(accounts.userId, original.id));
      expect(accountRows).toHaveLength(1);
    });

    it('creates no additional workspace for a duplicate signup', async () => {
      const auth = getAuth();
      const email = `dup-workspace-${crypto.randomUUID()}@example.test`;

      await signUpEmailRequest(auth, { name: 'Original', email, password: VALID_PASSWORD });
      const original = await findUserByEmail(email);
      trackUser(original?.id);
      if (original === undefined) throw new Error('expected the first signup to create a user');

      await signUpEmailRequest(auth, { name: 'Impersonator', email, password: VALID_PASSWORD });

      const db = getTestDb();
      const workspaceRows = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.personalOwnerUserId, original.id));
      expect(workspaceRows).toHaveLength(1);
    });

    it('responds with the same success shape for a duplicate signup as a genuine one — no existence leak via status code', async () => {
      const auth = getAuth();
      const email = `dup-shape-${crypto.randomUUID()}@example.test`;

      const genuineResponse = await signUpEmailRequest(auth, {
        name: 'Original',
        email,
        password: VALID_PASSWORD,
      });
      const original = await findUserByEmail(email);
      trackUser(original?.id);

      const duplicateResponse = await signUpEmailRequest(auth, {
        name: 'Impersonator',
        email,
        password: VALID_PASSWORD,
      });

      expect(genuineResponse.status).toBe(200);
      // Better Auth's synthetic-duplicate response (shouldReturnGenericDuplicateResponse,
      // active because requireEmailVerification is on) is a real 200, not a
      // 4xx USER_ALREADY_EXISTS — this is the actual anti-enumeration property.
      expect(duplicateResponse.status).toBe(200);
    });

    it('does not send a fresh verification email to the attacker for a duplicate signup attempt', async () => {
      const auth = getAuth();
      const email = `dup-noemail-${crypto.randomUUID()}@example.test`;

      await signUpEmailRequest(auth, { name: 'Original', email, password: VALID_PASSWORD });
      const original = await findUserByEmail(email);
      trackUser(original?.id);
      testAdapter().reset();

      await signUpEmailRequest(auth, { name: 'Impersonator', email, password: VALID_PASSWORD });

      // Better Auth's synthetic-duplicate path never calls sendVerificationEmail
      // for a real recipient — sending one here would hand a fresh
      // verification link to whoever submitted the duplicate attempt.
      expect(testAdapter().sent.filter((message) => message.to === email)).toHaveLength(0);
    });

    it('yields exactly one user row when the same brand-new email signs up concurrently', async () => {
      const auth = getAuth();
      const email = `concurrent-${crypto.randomUUID()}@example.test`;

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          signUpEmailRequest(auth, { name: 'Racer', email, password: VALID_PASSWORD }),
        ),
      );

      const db = getTestDb();
      const rows = await db.select().from(users).where(eq(users.email, email));
      expect(rows).toHaveLength(1);
      trackUser(rows[0]?.id);

      // Every concurrent attempt must resolve to *some* non-5xx, non-leaking
      // outcome — either the real creation or Better Auth's synthetic/duplicate
      // path (including the rare FAILED_TO_CREATE_USER race-loser case) —
      // never an unhandled server error.
      for (const response of responses) {
        expect(response.status).toBeLessThan(500);
      }
    });

    it('cannot create a second identity via a case-variant of an already-registered email', async () => {
      const auth = getAuth();
      const localPart = `case-${crypto.randomUUID()}`;
      const lowerEmail = `${localPart}@example.test`;
      const upperVariant = `${localPart.toUpperCase()}@example.test`;

      await signUpEmailRequest(auth, {
        name: 'Original',
        email: lowerEmail,
        password: VALID_PASSWORD,
      });
      const original = await findUserByEmail(lowerEmail);
      trackUser(original?.id);
      if (original === undefined) throw new Error('expected the first signup to create a user');

      await signUpEmailRequest(auth, {
        name: 'Case Variant',
        email: upperVariant,
        password: VALID_PASSWORD,
      });

      const db = getTestDb();
      // Better Auth's internal-adapter lowercases every email before lookup
      // and storage (findUserByEmail, sign-up.mjs), so the case-variant
      // attempt must resolve to the SAME lowercase row, never a second one.
      const rows = await db.select().from(users).where(eq(users.email, lowerEmail));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(original.id);

      const upperRows = await db
        .select()
        .from(users)
        .where(eq(users.email, upperVariant.toLowerCase()));
      expect(upperRows).toHaveLength(1);
      expect(upperRows[0]?.id).toBe(original.id);
    });
  });

  describe('rate limiting and unrelated paths remain unaffected', () => {
    it('keeps /sign-up/email rate limited via the real HTTP router', async () => {
      const auth = getAuth();
      await resetSignUpRateLimitBucket();
      const configuredRule = auth.options.rateLimit?.customRules?.['/sign-up/email'];
      if (configuredRule === undefined) throw new Error('expected a configured signup rate limit');

      const statuses: number[] = [];
      for (let attempt = 0; attempt < configuredRule.max + 2; attempt += 1) {
        const email = `ratelimit-${crypto.randomUUID()}@example.test`;
        const response = await signUpEmailRequest(auth, {
          name: 'Rate Limited',
          email,
          password: VALID_PASSWORD,
        });
        statuses.push(response.status);
        const user = await findUserByEmail(email);
        trackUser(user?.id);
      }

      const blockedCount = statuses.filter((status) => status === 429).length;
      expect(blockedCount).toBeGreaterThan(0);
      expect(statuses.slice(0, configuredRule.max).every((status) => status !== 429)).toBe(true);

      await resetSignUpRateLimitBucket();
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

  describe('audit log hygiene', () => {
    it('never records a password or confirmPassword value in the workspace-provisioning audit metadata for a new registration', async () => {
      const auth = getAuth();
      const email = `audit-${crypto.randomUUID()}@example.test`;

      await signUpEmailRequest(auth, { name: 'Audited', email, password: VALID_PASSWORD });
      const user = await findUserByEmail(email);
      trackUser(user?.id);
      if (user === undefined) throw new Error('expected the signup to create a user');

      const db = getTestDb();
      const rows = await db.select().from(auditLogs).where(eq(auditLogs.actorUserId, user.id));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const serialized = JSON.stringify(row.metadata);
        expect(serialized).not.toContain(VALID_PASSWORD);
        expect(serialized.toLowerCase()).not.toMatch(/password/);
      }
    });
  });
});
