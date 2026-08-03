import 'server-only';

import { and, asc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { cache } from 'react';

import { getAuth } from '@/lib/auth/server';
import type { AccountMode } from '@/lib/trading-accounts/constants';
import { getDb } from '@/server/db/client';
import { tradingAccounts, userPreferences, workspaceMembers, workspaces } from '@/server/db/schema';
import { ensurePersonalWorkspace } from '@/server/services/workspace-provisioning';

/**
 * The one centralized, server-only authorization boundary (CLAUDE.md §4,
 * Phase 2 brief §14). Every protected page, server action, and query goes
 * through this module — never a raw `auth.api.getSession` call, never a
 * client-supplied workspace ID trusted without `requireWorkspaceMembership`.
 *
 * `src/proxy.ts` performs only an optimistic, cookie-presence redirect
 * (Better Auth's own documented recommendation for Next.js middleware/proxy).
 * Every function here re-verifies against the database — the proxy is a fast
 * UX shortcut, this file is the actual security boundary.
 */

/** The minimum session/user fields any caller should ever see — never Better Auth's full row, never an account's OAuth tokens. */
export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image: string | null;
}

export interface AuthSession {
  readonly user: SessionUser;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export type WorkspaceRole = 'owner' | 'member';

export interface WorkspaceContext {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
  /** `null` until Phase 3A's onboarding transaction commits — see `workspaces.onboardingCompletedAt`'s schema comment. */
  readonly onboardingCompletedAt: Date | null;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super('No authenticated session.');
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Not authorized for this workspace.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

function toSessionUser(user: {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null | undefined;
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image ?? null,
  };
}

/**
 * The only place `auth.api.getSession` is called. Every call bypasses Better
 * Auth's signed cookie cache and re-verifies against PostgreSQL; no memoized
 * value can authorize a revoked session past its database deletion.
 *
 * Wrapped in React's `cache()` so the nested onboarding-aware layouts
 * introduced in Phase 3A (`(app)/layout.tsx`, `(app)/app/(main)/layout.tsx`,
 * `(app)/app/onboarding/page.tsx`) — which now all resolve session/workspace
 * context independently — collapse to one database round trip per request
 * rather than one per layout. Memoization is scoped to a single request by
 * React itself, so it can never leak a session across requests.
 */
export const getOptionalSession = cache(
  async function getOptionalSession(): Promise<AuthSession | null> {
    const result = await getAuth().api.getSession({
      headers: await headers(),
      // Better Auth 1.6.25 returns the signed `session_data` cookie before it
      // queries PostgreSQL unless this is set. DAL calls authorize protected
      // reads and writes, so they must observe revocation immediately rather
      // than accepting a cached session for up to cookieCache.maxAge seconds.
      query: { disableCookieCache: true },
    });
    if (result === null) {
      return null;
    }

    return {
      user: toSessionUser(result.user),
      sessionId: result.session.id,
      expiresAt: result.session.expiresAt,
    };
  },
);

/** Throws rather than returning null — for server actions and deeper helpers that assume the page-level check already ran. */
export async function requireSession(): Promise<AuthSession> {
  const session = await getOptionalSession();
  if (session === null) {
    throw new UnauthenticatedError();
  }
  return session;
}

export async function getCurrentUser(): Promise<SessionUser> {
  return (await requireSession()).user;
}

/**
 * Loads the caller's active workspace, repairing it if missing or invalid.
 *
 * "Invalid" covers two real cases: a brand-new user whose
 * `databaseHooks.user.create.after` provisioning hook failed independently
 * (Phase 2 brief §12 requires exactly this repair path), and a user whose
 * `active_workspace_id` points at a workspace they are no longer a member of
 * (defensive — nothing in this phase removes a membership, but the check
 * costs one join and closes the door before a later phase needs it).
 */
export const getActiveWorkspaceContext = cache(
  async function getActiveWorkspaceContext(): Promise<WorkspaceContext> {
    const { user } = await requireSession();
    const db = getDb();

    const row = await db
      .select({
        workspaceId: workspaces.id,
        workspaceName: workspaces.name,
        role: workspaceMembers.role,
        onboardingCompletedAt: workspaces.onboardingCompletedAt,
      })
      .from(userPreferences)
      .innerJoin(workspaces, eq(workspaces.id, userPreferences.activeWorkspaceId))
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, user.id)),
      )
      .where(eq(userPreferences.userId, user.id))
      .limit(1);

    const active = row[0];
    if (active !== undefined) {
      return {
        workspaceId: active.workspaceId,
        workspaceName: active.workspaceName,
        role: active.role as WorkspaceRole,
        userId: user.id,
        onboardingCompletedAt: active.onboardingCompletedAt,
      };
    }

    // No valid active workspace found — repair via the same idempotent path a
    // fresh sign-up uses, then re-read. `ensurePersonalWorkspace` never
    // creates a second personal workspace for a user who already has one.
    const { workspaceId } = await ensurePersonalWorkspace(user.id, {
      repairActiveWorkspace: true,
    });
    const repaired = await db
      .select({
        workspaceName: workspaces.name,
        role: workspaceMembers.role,
        onboardingCompletedAt: workspaces.onboardingCompletedAt,
      })
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, user.id)),
      )
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    const fixed = repaired[0];
    if (fixed === undefined) {
      // ensurePersonalWorkspace just returned this workspaceId with the
      // caller as owner; not finding the row immediately after is a bug in
      // that guarantee, not a recoverable runtime state.
      throw new Error(
        `getActiveWorkspaceContext: repair produced no membership for user ${user.id}`,
      );
    }

    return {
      workspaceId,
      workspaceName: fixed.workspaceName,
      role: fixed.role as WorkspaceRole,
      userId: user.id,
      onboardingCompletedAt: fixed.onboardingCompletedAt,
    };
  },
);

/**
 * The actual authorization check for "does this user belong to this
 * workspace" — the function every later phase's server action calls before
 * trusting a client-supplied `workspaceId`. Never infers membership from the
 * active-workspace context; a user may legitimately act on a workspace that
 * is not their *active* one once multi-workspace membership exists.
 */
export async function requireWorkspaceMembership(workspaceId: string): Promise<WorkspaceRole> {
  const { user } = await requireSession();
  const db = getDb();

  const row = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, user.id),
        eq(workspaceMembers.status, 'active'),
      ),
    )
    .limit(1);

  const membership = row[0];
  if (membership === undefined) {
    throw new ForbiddenError();
  }

  return membership.role as WorkspaceRole;
}

const ROLE_RANK: Record<WorkspaceRole, number> = { member: 0, owner: 1 };

export async function requireWorkspaceRole(
  workspaceId: string,
  minRole: WorkspaceRole,
): Promise<WorkspaceRole> {
  const role = await requireWorkspaceMembership(workspaceId);
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    throw new ForbiddenError(`Requires the '${minRole}' role.`);
  }
  return role;
}

export interface CurrentUserPreferences {
  readonly locale: string;
  readonly theme: string;
  readonly timezone: string;
}

/** Read-only — settings display reads through this; there is no write path yet (Phase 2 does not ship preference-editing UI beyond locale/theme). */
export async function getCurrentUserPreferences(): Promise<CurrentUserPreferences> {
  const { user } = await requireSession();
  const db = getDb();

  const row = await db
    .select({
      locale: userPreferences.locale,
      theme: userPreferences.theme,
      timezone: userPreferences.timezone,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .limit(1);

  const preferences = row[0];
  if (preferences === undefined) {
    // getActiveWorkspaceContext's repair path always creates this row
    // alongside the workspace; reaching here means that guarantee broke.
    throw new Error(`getCurrentUserPreferences: no row found for user ${user.id}`);
  }

  return preferences;
}

export interface ActiveTradingAccountSummary {
  readonly id: string;
  readonly name: string;
  readonly accountMode: AccountMode;
  readonly baseCurrency: string;
  /** Decimal string — never parsed to a JS `number` (CLAUDE.md §5). */
  readonly startingBalance: string;
}

/**
 * Resolves the caller's active trading account, re-validating rather than
 * trusting the stored preference — `user_preferences.activeTradingAccountId`
 * is a real FK to *some* trading account, but cannot express "belongs to the
 * CURRENT active workspace" or "is not archived" (see that column's schema
 * comment). Both are re-checked here on every call.
 *
 * Repairs a stale or invalid reference (points at another workspace's
 * account, or an account since archived) by selecting the workspace's
 * oldest remaining non-archived account and persisting that as the new
 * preference — the same "verify and repair, never merely trust" posture
 * `getActiveWorkspaceContext` already takes. Returns `null` only when the
 * active workspace genuinely has no usable account at all (onboarding never
 * completed, or every account has since been archived), which callers
 * treat as a recovery state rather than an error.
 *
 * Never accepts a trading-account ID from client input — the only inputs
 * are the authenticated session and the server-resolved active workspace.
 */
export async function getActiveTradingAccount(): Promise<ActiveTradingAccountSummary | null> {
  const { userId, workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();

  const preferenceRow = await db
    .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  const activeId = preferenceRow[0]?.activeTradingAccountId ?? null;

  if (activeId !== null) {
    const account = await db.query.tradingAccounts.findFirst({
      where: and(
        eq(tradingAccounts.id, activeId),
        eq(tradingAccounts.workspaceId, workspaceId),
        eq(tradingAccounts.isArchived, false),
      ),
    });
    if (account !== undefined) {
      return toActiveTradingAccountSummary(account);
    }
    // Falls through to repair — the stored ID did not resolve to a valid,
    // in-workspace, non-archived account.
  }

  const fallback = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.workspaceId, workspaceId), eq(tradingAccounts.isArchived, false)),
    orderBy: [asc(tradingAccounts.createdAt)],
  });

  if (fallback === undefined) {
    if (activeId !== null) {
      // Stop re-checking a reference that can never resolve again.
      await db
        .update(userPreferences)
        .set({ activeTradingAccountId: null })
        .where(eq(userPreferences.userId, userId));
    }
    return null;
  }

  await db
    .update(userPreferences)
    .set({ activeTradingAccountId: fallback.id })
    .where(eq(userPreferences.userId, userId));

  return toActiveTradingAccountSummary(fallback);
}

function toActiveTradingAccountSummary(account: {
  id: string;
  name: string;
  accountMode: string;
  baseCurrency: string;
  startingBalance: string;
}): ActiveTradingAccountSummary {
  return {
    id: account.id,
    name: account.name,
    accountMode: account.accountMode as AccountMode,
    baseCurrency: account.baseCurrency,
    startingBalance: account.startingBalance,
  };
}
