import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSubmitData } from '@/lib/trading-accounts/schema';
import {
  auditLogs,
  tradingAccounts,
  userPreferences,
  users,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Exercises Phase 3A's onboarding-completion transaction
 * (`src/server/services/trading-account.ts`) and its tenant-isolation
 * boundary (`src/server/auth/dal.ts`'s `getActiveTradingAccount`,
 * `src/server/actions/onboarding.ts`'s `completeOnboardingAction`) against
 * a real, disposable database — the same mocking pattern
 * `dal.integration.test.ts` already established: only Better Auth's own
 * session-resolution step is mocked, everything under test runs as real
 * Drizzle queries against real rows.
 */
type MockSession = {
  user: { id: string; name: string; email: string; emailVerified: boolean; image: string | null };
  session: { id: string; expiresAt: Date };
} | null;

let currentSession: MockSession = null;

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({
    api: {
      getSession: async () => currentSession,
    },
  }),
}));

const { getActiveTradingAccount } = await import('@/server/auth/dal');
const { completeOnboarding } = await import('./trading-account');
const { completeOnboardingAction } = await import('@/server/actions/onboarding');

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Test User',
      email: 'test@example.test',
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

async function createUser(db: ReturnType<typeof getTestDb>, label: string) {
  const [user] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('failed to insert test user');
  return user.id;
}

async function createWorkspaceWithOwner(db: ReturnType<typeof getTestDb>, ownerUserId: string) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Test workspace',
      slug: `ws-${crypto.randomUUID()}`,
      kind: 'personal',
      personalOwnerUserId: ownerUserId,
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('failed to insert test workspace');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });
  await db.insert(userPreferences).values({ userId: ownerUserId, activeWorkspaceId: workspace.id });
  return workspace.id;
}

const VALID_INPUT: OnboardingSubmitData = {
  name: 'My First Account',
  accountMode: 'live',
  baseCurrency: 'USD',
  startingBalance: '10000',
  timezone: 'Asia/Bangkok',
  riskPerTradePercent: '1',
  maximumDailyLossPercent: '3',
};

describe('completeOnboarding (real database)', () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    currentSession = null;
    const db = getTestDb();
    for (const userId of createdUserIds.splice(0)) {
      // Cascades to workspaces/workspace_members/user_preferences/trading_accounts
      // via the FK onDelete rules declared across src/server/db/schema/.
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('creates exactly one trading account belonging to the active workspace', async () => {
    const db = getTestDb();
    const userId = await createUser(db, 'owner');
    createdUserIds.push(userId);
    const workspaceId = await createWorkspaceWithOwner(db, userId);

    const result = await completeOnboarding(workspaceId, userId, VALID_INPUT);

    const accounts = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.id).toBe(result.accountId);
    expect(accounts[0]?.workspaceId).toBe(workspaceId);
  });

  it('sets the created account active for the user and marks workspace onboarding complete', async () => {
    const db = getTestDb();
    const userId = await createUser(db, 'owner');
    createdUserIds.push(userId);
    const workspaceId = await createWorkspaceWithOwner(db, userId);

    const result = await completeOnboarding(workspaceId, userId, VALID_INPUT);

    const preferenceRows = await db
      .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    expect(preferenceRows[0]?.activeTradingAccountId).toBe(result.accountId);

    const workspaceRows = await db
      .select({ onboardingCompletedAt: workspaces.onboardingCompletedAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    expect(workspaceRows[0]?.onboardingCompletedAt).not.toBeNull();
  });

  it('records a trading_account.created audit entry with no sensitive form data', async () => {
    const db = getTestDb();
    const userId = await createUser(db, 'owner');
    createdUserIds.push(userId);
    const workspaceId = await createWorkspaceWithOwner(db, userId);

    const result = await completeOnboarding(workspaceId, userId, VALID_INPUT);

    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.workspaceId, workspaceId),
          eq(auditLogs.action, 'trading_account.created'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(result.accountId);
    expect(rows[0]?.entityType).toBe('trading_account');
    const serializedMetadata = JSON.stringify(rows[0]?.metadata ?? {});
    expect(serializedMetadata).not.toContain(VALID_INPUT.startingBalance);
    expect(serializedMetadata).not.toContain(VALID_INPUT.riskPerTradePercent);
    expect(serializedMetadata).not.toContain(VALID_INPUT.maximumDailyLossPercent);
    expect(serializedMetadata).not.toContain(VALID_INPUT.name);

    const onboardingRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.workspaceId, workspaceId),
          eq(auditLogs.action, 'workspace.onboarding_completed'),
        ),
      );
    expect(onboardingRows).toHaveLength(1);
  });

  it('rolls back every write in the attempt when one write fails (a real DB CHECK-constraint violation)', async () => {
    const db = getTestDb();
    const userId = await createUser(db, 'owner');
    createdUserIds.push(userId);
    const workspaceId = await createWorkspaceWithOwner(db, userId);

    // Bypasses Zod entirely (a hypothetical caller that skipped validation)
    // to prove the database itself, not merely the application layer, is a
    // genuine enforcement boundary — and that a failure here leaves NO
    // partial state (no account, no active-account preference, onboarding
    // still incomplete), because it all happened inside one transaction.
    await expect(
      completeOnboarding(workspaceId, userId, { ...VALID_INPUT, startingBalance: '-1' }),
    ).rejects.toThrow();

    const accounts = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    expect(accounts).toHaveLength(0);

    const workspaceRows = await db
      .select({ onboardingCompletedAt: workspaces.onboardingCompletedAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    expect(workspaceRows[0]?.onboardingCompletedAt).toBeNull();

    const preferenceRows = await db
      .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    expect(preferenceRows[0]?.activeTradingAccountId).toBeNull();
  });

  it('rejects an invalid account mode at the database boundary too', async () => {
    const db = getTestDb();
    const userId = await createUser(db, 'owner');
    createdUserIds.push(userId);
    const workspaceId = await createWorkspaceWithOwner(db, userId);

    await expect(
      completeOnboarding(workspaceId, userId, {
        ...VALID_INPUT,
        accountMode: 'paper' as OnboardingSubmitData['accountMode'],
      }),
    ).rejects.toThrow();

    const accounts = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    expect(accounts).toHaveLength(0);
  });

  it('creates exactly one account when the same workspace onboards concurrently', async () => {
    const db = getTestDb();
    const userId = await createUser(db, 'owner');
    createdUserIds.push(userId);
    const workspaceId = await createWorkspaceWithOwner(db, userId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => completeOnboarding(workspaceId, userId, VALID_INPUT)),
    );

    const accounts = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    expect(accounts).toHaveLength(1);

    const distinctAccountIds = new Set(results.map((result) => result.accountId));
    expect(distinctAccountIds.size).toBe(1);
    expect(results.filter((result) => !result.alreadyCompleted)).toHaveLength(1);
  });

  it('is idempotent: repeating a completed submission creates no additional account', async () => {
    const db = getTestDb();
    const userId = await createUser(db, 'owner');
    createdUserIds.push(userId);
    const workspaceId = await createWorkspaceWithOwner(db, userId);

    const first = await completeOnboarding(workspaceId, userId, VALID_INPUT);
    const second = await completeOnboarding(workspaceId, userId, {
      ...VALID_INPUT,
      name: 'A Different Name Entirely',
    });

    expect(second.accountId).toBe(first.accountId);
    expect(second.alreadyCompleted).toBe(true);

    const accounts = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    expect(accounts).toHaveLength(1);
    // The second call's (different) input never overwrote the original.
    expect(accounts[0]?.name).toBe(VALID_INPUT.name);
  });

  it('repairs partial state (an account already exists, onboarding not yet marked complete) without creating a duplicate', async () => {
    const db = getTestDb();
    const userId = await createUser(db, 'owner');
    createdUserIds.push(userId);
    const workspaceId = await createWorkspaceWithOwner(db, userId);

    // Simulates a crash between account creation and marking onboarding
    // complete — a real (if rare) partial-failure mode, not something a
    // fresh completeOnboarding call alone could produce.
    const [partialAccount] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: 'Partially Created Account',
        accountMode: 'live',
        baseCurrency: 'USD',
        startingBalance: '5000',
        timezone: 'UTC',
      })
      .returning({ id: tradingAccounts.id });
    if (partialAccount === undefined) throw new Error('failed to seed partial account');

    const result = await completeOnboarding(workspaceId, userId, VALID_INPUT);

    expect(result.accountId).toBe(partialAccount.id);
    const accounts = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.name).toBe('Partially Created Account');

    const workspaceRows = await db
      .select({ onboardingCompletedAt: workspaces.onboardingCompletedAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    expect(workspaceRows[0]?.onboardingCompletedAt).not.toBeNull();
  });

  it('rejects a caller who is not an active member of the target workspace', async () => {
    const db = getTestDb();
    const ownerUserId = await createUser(db, 'owner');
    const outsiderUserId = await createUser(db, 'outsider');
    createdUserIds.push(ownerUserId, outsiderUserId);
    const workspaceId = await createWorkspaceWithOwner(db, ownerUserId);

    await expect(completeOnboarding(workspaceId, outsiderUserId, VALID_INPUT)).rejects.toThrow();

    const accounts = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    expect(accounts).toHaveLength(0);
  });

  describe('foreign-key behavior', () => {
    it('cascades: deleting a workspace deletes its trading accounts', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const result = await completeOnboarding(workspaceId, userId, VALID_INPUT);

      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));

      const accounts = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, result.accountId));
      expect(accounts).toHaveLength(0);
    });

    it('sets the active-account preference to null (not an error) when the active account is deleted', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const result = await completeOnboarding(workspaceId, userId, VALID_INPUT);

      await db.delete(tradingAccounts).where(eq(tradingAccounts.id, result.accountId));

      const preferenceRows = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      expect(preferenceRows[0]?.activeTradingAccountId).toBeNull();
    });
  });

  describe('tenant isolation', () => {
    it("User A cannot read User B's account through workspace-scoped queries", async () => {
      const db = getTestDb();
      const userA = await createUser(db, 'user-a');
      const userB = await createUser(db, 'user-b');
      createdUserIds.push(userA, userB);
      const workspaceA = await createWorkspaceWithOwner(db, userA);
      const workspaceB = await createWorkspaceWithOwner(db, userB);
      const resultB = await completeOnboarding(workspaceB, userB, VALID_INPUT);

      // The exact predicate every real read (getActiveTradingAccount, and
      // any future "get account by id") must use: workspace-scoped, never
      // just the record ID.
      const crossTenantRead = await db
        .select()
        .from(tradingAccounts)
        .where(
          and(
            eq(tradingAccounts.id, resultB.accountId),
            eq(tradingAccounts.workspaceId, workspaceA),
          ),
        );
      expect(crossTenantRead).toHaveLength(0);

      const withinTenantRead = await db
        .select()
        .from(tradingAccounts)
        .where(
          and(
            eq(tradingAccounts.id, resultB.accountId),
            eq(tradingAccounts.workspaceId, workspaceB),
          ),
        );
      expect(withinTenantRead).toHaveLength(1);
    });

    it("getActiveTradingAccount never resolves to another user's/workspace's account, even if the stored preference is forged", async () => {
      const db = getTestDb();
      const userA = await createUser(db, 'user-a');
      const userB = await createUser(db, 'user-b');
      createdUserIds.push(userA, userB);
      const workspaceA = await createWorkspaceWithOwner(db, userA);
      const workspaceB = await createWorkspaceWithOwner(db, userB);
      const resultA = await completeOnboarding(workspaceA, userA, VALID_INPUT);
      const resultB = await completeOnboarding(workspaceB, userB, {
        ...VALID_INPUT,
        name: "User B's Account",
      });

      // Simulates a forged/corrupted preference row pointing at another
      // workspace's account — something no normal flow produces, but the
      // authoritative re-validation in getActiveTradingAccount must still
      // catch it rather than trusting the stored reference.
      await db
        .update(userPreferences)
        .set({ activeTradingAccountId: resultB.accountId })
        .where(eq(userPreferences.userId, userA));

      currentSession = sessionFor(userA);
      const activeAccount = await getActiveTradingAccount();

      expect(activeAccount?.id).not.toBe(resultB.accountId);
      // Repaired to A's own account rather than left dangling or resolved
      // cross-tenant.
      expect(activeAccount?.id).toBe(resultA.accountId);

      const repairedPreference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userA));
      expect(repairedPreference[0]?.activeTradingAccountId).toBe(resultA.accountId);
    });

    it("a forged workspaceId in the onboarding action payload is ignored — the account is created in the caller's own active workspace", async () => {
      const db = getTestDb();
      const userA = await createUser(db, 'user-a');
      const userB = await createUser(db, 'user-b');
      createdUserIds.push(userA, userB);
      const workspaceA = await createWorkspaceWithOwner(db, userA);
      const workspaceB = await createWorkspaceWithOwner(db, userB);

      currentSession = sessionFor(userA);
      const result = await completeOnboardingAction({
        ...VALID_INPUT,
        // The Zod schema has no such field, but a raw object is what an
        // actual attacker-controlled request body would look like.
        workspaceId: workspaceB,
        userId: userB,
      });

      expect(result.ok).toBe(true);
      const accountsInB = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceB));
      expect(accountsInB).toHaveLength(0);
      const accountsInA = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceA));
      expect(accountsInA).toHaveLength(1);
    });
  });
});
