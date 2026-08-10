import 'server-only';

import { and, desc, eq, gt, sql } from 'drizzle-orm';

import { describeSessionAgent, type SessionAgentLabel } from '@/lib/settings/session-agent';
import { getDb } from '@/server/db/client';
import { accounts, sessions } from '@/server/db/schema';

import { requireSession } from './dal';
import { type LinkedAuthProvider } from './settings-dal';

export type { SessionAgentLabel } from '@/lib/settings/session-agent';

export interface ActiveSessionView {
  readonly sessionId: string;
  readonly isCurrent: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly agentLabel: SessionAgentLabel;
}

export interface AccountSecurityView {
  readonly providers: readonly LinkedAuthProvider[];
  readonly canChangePassword: boolean;
  readonly sessions: readonly ActiveSessionView[];
}

function toSafeProvider(providerId: string): LinkedAuthProvider {
  if (providerId === 'credential') return 'email_password';
  if (providerId === 'google') return 'google';
  return 'other';
}

/** Authenticated SELF read model. Password hashes, tokens, IPs, and provider account IDs are never selected. */
export async function getAccountSecurityView(now = new Date()): Promise<AccountSecurityView> {
  const current = await requireSession();
  const [accountRows, sessionRows] = await Promise.all([
    getDb()
      .select({
        providerId: accounts.providerId,
        hasPassword: sql<boolean>`${accounts.password} is not null`,
      })
      .from(accounts)
      .where(eq(accounts.userId, current.user.id)),
    getDb()
      .select({
        sessionId: sessions.id,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, current.user.id), gt(sessions.expiresAt, now)))
      .orderBy(desc(sessions.createdAt), desc(sessions.id)),
  ]);

  const providers = [...new Set(accountRows.map((row) => toSafeProvider(row.providerId)))];
  const activeSessions = sessionRows
    .map((row): ActiveSessionView => ({
      sessionId: row.sessionId,
      isCurrent: row.sessionId === current.sessionId,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      agentLabel: describeSessionAgent(row.userAgent),
    }))
    .sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
      return byCreatedAt === 0 ? right.sessionId.localeCompare(left.sessionId) : byCreatedAt;
    });

  return {
    providers,
    canChangePassword: accountRows.some(
      (row) => row.providerId === 'credential' && row.hasPassword,
    ),
    sessions: activeSessions,
  };
}
