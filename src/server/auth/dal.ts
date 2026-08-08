import 'server-only';

import { and, asc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { cache } from 'react';

import { getAuth } from '@/lib/auth/server';
import type { EffectiveEntitlement } from '@/lib/entitlements/resolve';
import type { AccountMode } from '@/lib/trading-accounts/constants';
import { getDb } from '@/server/db/client';
import { tradingAccounts, userPreferences, workspaceMembers, workspaces } from '@/server/db/schema';
import { readEffectiveEntitlement } from '@/server/services/entitlement';
import { ensurePersonalWorkspace } from '@/server/services/workspace-provisioning';

export type { EffectiveEntitlement } from '@/lib/entitlements/resolve';

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

/**
 * Every field the Phase 3B account-management UI displays or edits — richer
 * than `ActiveTradingAccountSummary` (which only carries what the dashboard
 * and switcher need). Decimal/percentage fields stay strings end to end
 * (CLAUDE.md §5); `null` on the optional ones is a real "not set" that the
 * form and list page must render as absent, not as an empty string.
 */
export interface TradingAccountRecord {
  readonly id: string;
  readonly name: string;
  readonly brokerName: string | null;
  readonly platformName: string | null;
  readonly accountMode: AccountMode;
  readonly baseCurrency: string;
  readonly startingBalance: string;
  readonly timezone: string;
  readonly riskPerTradePercent: string | null;
  readonly maximumDailyLossPercent: string | null;
  readonly isArchived: boolean;
  readonly createdAt: Date;
}

function toTradingAccountRecord(account: {
  id: string;
  name: string;
  brokerName: string | null;
  platformName: string | null;
  accountMode: string;
  baseCurrency: string;
  startingBalance: string;
  timezone: string;
  riskPerTradePercent: string | null;
  maximumDailyLossPercent: string | null;
  isArchived: boolean;
  createdAt: Date;
}): TradingAccountRecord {
  return {
    id: account.id,
    name: account.name,
    brokerName: account.brokerName,
    platformName: account.platformName,
    accountMode: account.accountMode as AccountMode,
    baseCurrency: account.baseCurrency,
    startingBalance: account.startingBalance,
    timezone: account.timezone,
    riskPerTradePercent: account.riskPerTradePercent,
    maximumDailyLossPercent: account.maximumDailyLossPercent,
    isArchived: account.isArchived,
    createdAt: account.createdAt,
  };
}

/**
 * Every trading account (active and archived) in the caller's active
 * workspace — the account-management page's one data source for both its
 * "active accounts" and "archived accounts" sections. Ordered oldest first,
 * matching the same deterministic ordering `getActiveTradingAccount`'s
 * fallback and the archive service's fallback selection already use.
 */
export async function listWorkspaceTradingAccounts(): Promise<TradingAccountRecord[]> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();

  const rows = await db.query.tradingAccounts.findMany({
    where: eq(tradingAccounts.workspaceId, workspaceId),
    orderBy: [asc(tradingAccounts.createdAt), asc(tradingAccounts.id)],
  });

  return rows.map(toTradingAccountRecord);
}

/**
 * A single account, authorized against the caller's active workspace.
 * Returns `null` both when the ID does not exist at all AND when it belongs
 * to another workspace — deliberately indistinguishable, so the edit page
 * can render an ordinary "not found" without ever revealing that a given ID
 * belongs to someone else's tenant.
 */
export async function getWorkspaceTradingAccountById(
  accountId: string,
): Promise<TradingAccountRecord | null> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.workspaceId, workspaceId)),
  });

  return account === undefined ? null : toTradingAccountRecord(account);
}

/**
 * Non-archived accounts in the caller's active workspace, for the app-shell
 * account switcher — an archived account must never appear as a selectable
 * option (Phase 3B brief). Same summary shape as `getActiveTradingAccount`
 * since the switcher shows exactly those fields (name, mode, currency).
 */
export async function listSwitchableTradingAccounts(): Promise<ActiveTradingAccountSummary[]> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();

  const rows = await db.query.tradingAccounts.findMany({
    where: and(eq(tradingAccounts.workspaceId, workspaceId), eq(tradingAccounts.isArchived, false)),
    orderBy: [asc(tradingAccounts.createdAt), asc(tradingAccounts.id)],
  });

  return rows.map(toActiveTradingAccountSummary);
}

/**
 * The one centralized permission decision behind every trading-account
 * mutation (create/edit/activate/archive/restore) — Phase 3B brief's "Role
 * authorization" section. Currently just `requireWorkspaceRole(workspaceId,
 * 'member')`: this project's only role in active use is `'owner'` (every
 * personal workspace's sole member — ADR 0011), and nothing in current
 * policy distinguishes owner-only vs member-permitted account actions, so
 * `'member'` is the least-restrictive boundary consistent with "preserve
 * existing policy." A future shared-workspace policy that wants e.g.
 * archiving restricted to `'owner'` changes this ONE function, not every
 * action that calls it.
 */
export async function requireTradingAccountManagement(workspaceId: string): Promise<WorkspaceRole> {
  return requireWorkspaceRole(workspaceId, 'member');
}

/**
 * The one centralized permission decision behind every Strategy/Setup/Rule
 * mutation (Phase 06D) — the same `'member'`-minimum, defense-in-depth
 * precheck `requireTradingAccountManagement` performs before its own
 * services, called from `src/server/actions/strategies.ts` before every
 * mutating Server Action reaches `strategy-management.ts`. The service layer
 * still independently re-verifies active membership itself inside its own
 * transaction (CLAUDE.md §4) — this is an additional, earlier check, not a
 * replacement for it.
 */
export async function requireStrategyManagement(workspaceId: string): Promise<WorkspaceRole> {
  return requireWorkspaceRole(workspaceId, 'member');
}

/**
 * The one centralized permission decision behind every Trade Server Action
 * (Phase 08C) — the same `'member'`-minimum, defense-in-depth precheck
 * `requireStrategyManagement`/`requireTradingAccountManagement` perform
 * before their own services, called from `src/server/actions/trades.ts`
 * before every mutating Server Action reaches `trade-management.ts`/
 * `trade-discipline.ts`. Deliberately authentication + active-membership
 * ONLY — it never resolves entitlement/access mode, so it can never reject
 * an exact-mutation-key `createTrade` replay that ought to stay replayable
 * under a `read_only`/`over_limit` workspace (`src/server/services/
 * trade-management.ts`'s own idempotency contract). The service layer
 * remains authoritative: it independently re-verifies active membership and
 * resolves/authorizes `ordinary_write` entitlement itself, inside its own
 * transaction, regardless of what this earlier check decides.
 */
export async function requireTradeManagement(workspaceId: string): Promise<WorkspaceRole> {
  return requireWorkspaceRole(workspaceId, 'member');
}

/**
 * The caller's active workspace's effective entitlement snapshot — display
 * only (CLAUDE.md §4's "never trust the browser clock" extended: this is
 * also never a lock, so it must never itself gate a mutation). Every write
 * that actually needs to enforce a limit re-resolves it under a row lock
 * inside its own transaction via `lockAndResolveEntitlement`
 * (`src/server/services/entitlement.ts`) instead of trusting this value.
 *
 * `null` only for the fail-closed anomaly of a completed-onboarding
 * workspace with no entitlement row — the migration backfilled every such
 * workspace and `completeOnboarding` starts one for every new workspace
 * going forward, so callers treat `null` as "nothing to show yet" rather
 * than design a real UI state around it.
 */
export const getWorkspaceEntitlement = cache(
  async function getWorkspaceEntitlement(): Promise<EffectiveEntitlement | null> {
    const { workspaceId } = await getActiveWorkspaceContext();
    const db = getDb();
    return readEffectiveEntitlement(db, workspaceId);
  },
);
