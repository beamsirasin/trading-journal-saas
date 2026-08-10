import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { generateId } from '@/lib/identifiers';
import { closeDb } from '@/server/db/client';
import { accounts, auditLogs, rateLimits, sessions, users } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';
import { VALID_TEST_PASSWORD } from '@/test/test-passwords';

let requestHeaders = new Headers();
const writtenCookies = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string) => writtenCookies.set(name, value),
  }),
}));

const { getAuth } = await import('@/lib/auth/server');
const { getAccountSecurityView } = await import('@/server/auth/account-security-dal');
const {
  AccountSecurityError,
  changeOwnPassword,
  revokeAllOwnOtherSessions,
  revokeOwnOtherSession,
} = await import('./account-security');

const createdUserIds: string[] = [];

async function createCredentialUser(password = VALID_TEST_PASSWORD) {
  const db = getTestDb();
  const userId = generateId();
  const email = `security-${crypto.randomUUID()}@example.test`;
  await db.insert(users).values({
    id: userId,
    name: 'Security Test',
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

async function createOAuthOnlyUser() {
  const db = getTestDb();
  const userId = generateId();
  await db.insert(users).values({
    id: userId,
    name: 'OAuth Test',
    email: `oauth-${crypto.randomUUID()}@example.test`,
    emailVerified: true,
  });
  await db.insert(accounts).values({
    id: generateId(),
    userId,
    accountId: `google-${generateId()}`,
    providerId: 'google',
  });
  createdUserIds.push(userId);
  return userId;
}

function responseCookieHeader(response: Response): string {
  const source = response.headers as Headers & { getSetCookie?: () => string[] };
  return (source.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .filter(Boolean)
    .map((value) => value.split(';', 1)[0]!)
    .join('; ');
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await signInResponse(email, password);
  if (!response.ok) throw new Error(`Expected test sign-in success, received ${response.status}.`);
  return responseCookieHeader(response);
}

async function signInResponse(email: string, password: string): Promise<Response> {
  return getAuth().api.signInEmail({
    body: { email, password },
    headers: new Headers({ origin: 'http://localhost:3000' }),
    asResponse: true,
  });
}

async function currentSessionId(cookie: string): Promise<string> {
  const result = await sessionForCookie(cookie);
  if (result === null) throw new Error('Expected a current test session.');
  return result.session.id;
}

async function sessionForCookie(cookie: string) {
  return getAuth().api.getSession({
    headers: new Headers({ cookie }),
    query: { disableCookieCache: true },
  });
}

describe('account security (real Better Auth and PostgreSQL)', () => {
  afterEach(async () => {
    requestHeaders = new Headers();
    writtenCookies.clear();
    const db = getTestDb();
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, userId));
      await db.delete(rateLimits).where(eq(rateLimits.key, `security:change-password:${userId}`));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeDb();
    await closeTestDb();
  });

  it('lists only safe caller sessions, protects current, and canonically revokes one/all others without a workspace', async () => {
    const user = await createCredentialUser();
    const foreign = await createCredentialUser();
    const currentCookie = await signIn(user.email, user.password);
    const otherCookie = await signIn(user.email, user.password);
    const foreignCookie = await signIn(foreign.email, foreign.password);
    const currentId = await currentSessionId(currentCookie);
    const otherId = await currentSessionId(otherCookie);
    const foreignId = await currentSessionId(foreignCookie);
    const expiredId = generateId();
    await getTestDb()
      .insert(sessions)
      .values({
        id: expiredId,
        userId: user.userId,
        token: generateId(),
        expiresAt: new Date(Date.now() - 60_000),
      });
    requestHeaders = new Headers({ cookie: currentCookie });

    const view = await getAccountSecurityView();
    expect(view.canChangePassword).toBe(true);
    expect(view.providers).toEqual(['email_password']);
    expect(view.sessions[0]?.sessionId).toBe(currentId);
    expect(view.sessions[0]?.isCurrent).toBe(true);
    expect(view.sessions).toHaveLength(2);
    expect(view.sessions.map((session) => session.sessionId)).toContain(otherId);
    expect(view.sessions.map((session) => session.sessionId)).not.toContain(foreignId);
    expect(view.sessions.map((session) => session.sessionId)).not.toContain(expiredId);
    for (const session of view.sessions) {
      expect(session).not.toHaveProperty('token');
      expect(session).not.toHaveProperty('ipAddress');
      expect(session).not.toHaveProperty('userId');
    }
    expect(view).not.toHaveProperty('providerId');

    await expect(
      revokeOwnOtherSession(user.userId, currentId, currentId, requestHeaders),
    ).rejects.toMatchObject({ code: 'cannot_revoke_current_session' });
    expect(await revokeOwnOtherSession(user.userId, currentId, foreignId, requestHeaders)).toEqual({
      revoked: false,
    });

    expect(await revokeOwnOtherSession(user.userId, currentId, otherId, requestHeaders)).toEqual({
      revoked: true,
    });
    expect(await revokeOwnOtherSession(user.userId, currentId, otherId, requestHeaders)).toEqual({
      revoked: false,
    });
    expect(await sessionForCookie(otherCookie)).toBeNull();
    expect(await currentSessionId(currentCookie)).toBe(currentId);
    expect(await currentSessionId(foreignCookie)).toBe(foreignId);

    const secondOtherCookie = await signIn(user.email, user.password);
    const thirdOtherCookie = await signIn(user.email, user.password);
    expect(await revokeAllOwnOtherSessions(user.userId, currentId, requestHeaders)).toEqual({
      revokedCount: 2,
    });
    expect(await currentSessionId(currentCookie)).toBe(currentId);
    for (const cookie of [secondOtherCookie, thirdOtherCookie]) {
      expect(await sessionForCookie(cookie)).toBeNull();
    }
    expect(await currentSessionId(foreignCookie)).toBe(foreignId);
    expect(await revokeAllOwnOtherSessions(user.userId, currentId, requestHeaders)).toEqual({
      revokedCount: 0,
    });

    const events = await getTestDb()
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.actorUserId, user.userId));
    expect(events).toEqual(
      expect.arrayContaining([
        {
          action: 'security.session_revoked',
          metadata: { revokedCount: 1, scope: 'other_session' },
        },
        {
          action: 'security.sessions_revoked',
          metadata: { revokedCount: 2, scope: 'other_sessions' },
        },
      ]),
    );
  });

  it('changes the canonical credential, preserves current, revokes other sessions, and audits no secret', async () => {
    const user = await createCredentialUser();
    const newPassword = 'New-Correct-Horse8!';
    const currentCookie = await signIn(user.email, user.password);
    const otherCookie = await signIn(user.email, user.password);
    const oldCurrentId = await currentSessionId(currentCookie);
    requestHeaders = new Headers({ cookie: currentCookie, 'next-action': 'test' });

    await expect(
      changeOwnPassword(
        user.userId,
        oldCurrentId,
        {
          currentPassword: 'Definitely-Wrong7!',
          newPassword,
          confirmNewPassword: newPassword,
        },
        requestHeaders,
      ),
    ).rejects.toMatchObject({ code: 'incorrect_current_password' });
    expect(
      await getTestDb().select().from(auditLogs).where(eq(auditLogs.actorUserId, user.userId)),
    ).toHaveLength(0);

    await expect(
      changeOwnPassword(
        user.userId,
        oldCurrentId,
        {
          currentPassword: user.password,
          newPassword,
          confirmNewPassword: newPassword,
        },
        requestHeaders,
      ),
    ).resolves.toEqual({ otherSessionsRevoked: true });

    expect(await currentSessionId(currentCookie)).toBe(oldCurrentId);
    expect(await sessionForCookie(otherCookie)).toBeNull();
    const remainingSessions = await getTestDb()
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, user.userId));
    expect(remainingSessions).toEqual([{ id: oldCurrentId }]);

    const oldPasswordResponse = await signInResponse(user.email, user.password);
    expect(oldPasswordResponse.status).toBe(401);
    expect(await oldPasswordResponse.json()).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' });
    await expect(signIn(user.email, newPassword)).resolves.toContain('session_token=');

    const [event] = await getTestDb()
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.actorUserId, user.userId),
          eq(auditLogs.action, 'security.password_changed'),
        ),
      );
    expect(event).toEqual({
      action: 'security.password_changed',
      metadata: { changedFields: ['password'] },
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(user.password);
    expect(serialized).not.toContain(newPassword);
  });

  it('denies an OAuth-only user before invoking any canonical password mutation', async () => {
    const userId = await createOAuthOnlyUser();
    await expect(
      changeOwnPassword(
        userId,
        generateId(),
        {
          currentPassword: 'Current1!secure',
          newPassword: 'Different2!secure',
          confirmNewPassword: 'Different2!secure',
        },
        new Headers(),
      ),
    ).rejects.toBeInstanceOf(AccountSecurityError);
    await expect(
      changeOwnPassword(
        userId,
        generateId(),
        {
          currentPassword: 'Current1!secure',
          newPassword: 'Different2!secure',
          confirmNewPassword: 'Different2!secure',
        },
        new Headers(),
      ),
    ).rejects.toMatchObject({ code: 'password_not_available' });
  });

  it('rate-limits repeated password attempts in the existing database-backed table', async () => {
    const user = await createCredentialUser();
    const cookie = await signIn(user.email, user.password);
    const currentId = await currentSessionId(cookie);
    const headers = new Headers({ cookie });
    const input = {
      currentPassword: 'Definitely-Wrong7!',
      newPassword: 'Different2!secure',
      confirmNewPassword: 'Different2!secure',
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(changeOwnPassword(user.userId, currentId, input, headers)).rejects.toMatchObject(
        {
          code: 'incorrect_current_password',
        },
      );
    }
    await expect(changeOwnPassword(user.userId, currentId, input, headers)).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(
      await getTestDb().select().from(auditLogs).where(eq(auditLogs.actorUserId, user.userId)),
    ).toHaveLength(0);
  });
});
