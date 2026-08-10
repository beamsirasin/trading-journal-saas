import 'server-only';

import { APIError } from 'better-auth/api';
import { and, eq, gt, isNotNull, ne } from 'drizzle-orm';

import { getAuth } from '@/lib/auth/server';
import type { ChangePasswordData } from '@/lib/settings/schemas';
import { getDb, type Database } from '@/server/db/client';
import { accounts, rateLimits, sessions } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';

export type AccountSecurityErrorCode =
  | 'unauthenticated'
  | 'password_not_available'
  | 'incorrect_current_password'
  | 'cannot_revoke_current_session'
  | 'rate_limited'
  | 'unexpected_error';

export class AccountSecurityError extends Error {
  constructor(readonly code: AccountSecurityErrorCode) {
    super(code);
    this.name = 'AccountSecurityError';
  }
}

const PASSWORD_CHANGE_RATE_LIMIT_WINDOW_MS = 60_000;
const PASSWORD_CHANGE_RATE_LIMIT_MAX = 5;

type AuditWriter = typeof insertAuditLog;

function mapCanonicalError(error: unknown): never {
  if (error instanceof APIError) {
    const code = error.body?.code;
    if (code === 'INVALID_PASSWORD') {
      throw new AccountSecurityError('incorrect_current_password');
    }
    if (code === 'CREDENTIAL_ACCOUNT_NOT_FOUND') {
      throw new AccountSecurityError('password_not_available');
    }
    if (code === 'UNAUTHORIZED' || error.status === 'UNAUTHORIZED' || error.statusCode === 401) {
      throw new AccountSecurityError('unauthenticated');
    }
    if (error.status === 'TOO_MANY_REQUESTS' || error.statusCode === 429) {
      throw new AccountSecurityError('rate_limited');
    }
  }
  throw error;
}

/**
 * Better Auth's direct server API does not pass through its HTTP router rate limiter.
 * Reuse the existing database-backed rate-limit table with a narrow per-user key;
 * the row is locked so concurrent attempts cannot pass by racing the counter.
 */
export async function consumePasswordChangeRateLimit(
  db: Database,
  userId: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const key = `security:change-password:${userId}`;
  return db.transaction(async (tx) => {
    await tx
      .insert(rateLimits)
      .values({ key, count: 0, lastRequest: nowMs })
      .onConflictDoNothing({ target: rateLimits.key });

    const rows = await tx
      .select({ count: rateLimits.count, lastRequest: rateLimits.lastRequest })
      .from(rateLimits)
      .where(eq(rateLimits.key, key))
      .for('update')
      .limit(1);
    const row = rows[0];
    if (row === undefined) throw new Error('Password-change rate-limit row was not created.');

    const windowExpired = nowMs - row.lastRequest >= PASSWORD_CHANGE_RATE_LIMIT_WINDOW_MS;
    if (!windowExpired && row.count >= PASSWORD_CHANGE_RATE_LIMIT_MAX) return false;

    await tx
      .update(rateLimits)
      .set({
        count: windowExpired ? 1 : row.count + 1,
        lastRequest: windowExpired ? nowMs : row.lastRequest,
      })
      .where(eq(rateLimits.key, key));
    return true;
  });
}

async function credentialPasswordAvailable(db: Database, userId: string): Promise<boolean> {
  const row = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, 'credential'),
        isNotNull(accounts.password),
      ),
    )
    .limit(1);
  return row[0] !== undefined;
}

interface ChangePasswordDependencies {
  readonly db?: Database;
  readonly auditWriter?: AuditWriter;
  readonly canonicalChange?: (input: {
    currentPassword: string;
    newPassword: string;
    headers: Headers;
  }) => Promise<void>;
  readonly canonicalRevokeOthers?: (headers: Headers) => Promise<void>;
}

/** Better Auth owns the credential/session transaction; the structural audit follows separately. */
export async function changeOwnPassword(
  userId: string,
  currentSessionId: string,
  input: ChangePasswordData,
  requestHeaders: Headers,
  dependencies: ChangePasswordDependencies = {},
): Promise<{ readonly otherSessionsRevoked: true }> {
  const db = dependencies.db ?? getDb();
  if (!(await credentialPasswordAvailable(db, userId))) {
    throw new AccountSecurityError('password_not_available');
  }
  if (!(await consumePasswordChangeRateLimit(db, userId))) {
    throw new AccountSecurityError('rate_limited');
  }

  try {
    if (dependencies.canonicalChange !== undefined) {
      await dependencies.canonicalChange({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        headers: requestHeaders,
      });
    } else {
      await getAuth().api.changePassword({
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          // Keep the current row/cookie stable. Other-session revocation is
          // the separate canonical operation immediately below.
          revokeOtherSessions: false,
        },
        headers: requestHeaders,
      });
    }
    if (dependencies.canonicalRevokeOthers !== undefined) {
      await dependencies.canonicalRevokeOthers(requestHeaders);
    } else {
      await getAuth().api.revokeOtherSessions({ headers: requestHeaders });
    }
  } catch (error) {
    mapCanonicalError(error);
  }

  const remainingOtherSessions = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        ne(sessions.id, currentSessionId),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  if (remainingOtherSessions.length > 0) {
    throw new AccountSecurityError('unexpected_error');
  }

  await (dependencies.auditWriter ?? insertAuditLog)(db, {
    action: 'security.password_changed',
    actorUserId: userId,
    entityType: 'user',
    entityId: userId,
    metadata: { changedFields: ['password'] },
  });
  return { otherSessionsRevoked: true };
}

interface SessionMutationDependencies {
  readonly db?: Database;
  readonly auditWriter?: AuditWriter;
  readonly canonicalRevoke?: (token: string, headers: Headers) => Promise<void>;
  readonly canonicalRevokeOthers?: (headers: Headers) => Promise<void>;
}

/** Resolves the token only after caller ownership and current-session protection are established. */
export async function revokeOwnOtherSession(
  userId: string,
  currentSessionId: string,
  targetSessionId: string,
  requestHeaders: Headers,
  dependencies: SessionMutationDependencies = {},
): Promise<{ readonly revoked: boolean }> {
  if (targetSessionId === currentSessionId) {
    throw new AccountSecurityError('cannot_revoke_current_session');
  }
  const db = dependencies.db ?? getDb();
  const target = await db
    .select({ token: sessions.token })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, targetSessionId),
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const owned = target[0];
  // Idempotent and deliberately indistinguishable from a foreign/nonexistent ID.
  if (owned === undefined) return { revoked: false };

  try {
    if (dependencies.canonicalRevoke !== undefined) {
      await dependencies.canonicalRevoke(owned.token, requestHeaders);
    } else {
      await getAuth().api.revokeSession({ body: { token: owned.token }, headers: requestHeaders });
    }
  } catch (error) {
    mapCanonicalError(error);
  }

  const remaining = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, targetSessionId), eq(sessions.userId, userId)))
    .limit(1);
  if (remaining[0] !== undefined) throw new AccountSecurityError('unexpected_error');

  await (dependencies.auditWriter ?? insertAuditLog)(db, {
    action: 'security.session_revoked',
    actorUserId: userId,
    entityType: 'session',
    metadata: { revokedCount: 1, scope: 'other_session' },
  });
  return { revoked: true };
}

export async function revokeAllOwnOtherSessions(
  userId: string,
  currentSessionId: string,
  requestHeaders: Headers,
  dependencies: SessionMutationDependencies = {},
): Promise<{ readonly revokedCount: number }> {
  const db = dependencies.db ?? getDb();
  const before = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        ne(sessions.id, currentSessionId),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  if (before.length === 0) return { revokedCount: 0 };

  try {
    if (dependencies.canonicalRevokeOthers !== undefined) {
      await dependencies.canonicalRevokeOthers(requestHeaders);
    } else {
      await getAuth().api.revokeOtherSessions({ headers: requestHeaders });
    }
  } catch (error) {
    mapCanonicalError(error);
  }

  const after = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        ne(sessions.id, currentSessionId),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  if (after.length > 0) throw new AccountSecurityError('unexpected_error');

  await (dependencies.auditWriter ?? insertAuditLog)(db, {
    action: 'security.sessions_revoked',
    actorUserId: userId,
    entityType: 'session',
    metadata: { revokedCount: before.length, scope: 'other_sessions' },
  });
  return { revokedCount: before.length };
}
