import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSubmitData } from '@/lib/trading-accounts/schema';
import {
  auditLogs,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Phase 3C's entitlement enforcement, exercised against a real, disposable
 * database — the same mocking pattern `trading-account-management.
 * integration.test.ts` already established: only Better Auth's own
 * session-resolution step is mocked, everything else is a real transaction
 * against real tables and real locks.
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

const { completeOnboarding } = await import('./trading-account');
const { createTradingAccount, restoreTradingAccount } =
  await import('./trading-account-management');
const { readEffectiveEntitlement } = await import('./entitlement');

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

/** A workspace WITHOUT completed onboarding and WITHOUT an entitlement row — the pre-onboarding state. */
async function createIncompleteWorkspace(db: ReturnType<typeof getTestDb>, ownerUserId: string) {
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

async function seedEntitlement(
  db: ReturnType<typeof getTestDb>,
  workspaceId: string,
  overrides: {
    status?: 'trialing' | 'active' | 'expired' | 'canceled';
    planKey?: string | null;
    trialEndsAt?: Date | null;
  } = {},
) {
  await db.insert(workspaceEntitlements).values({
    workspaceId,
    status: overrides.status ?? 'trialing',
    planKey: overrides.planKey ?? null,
    trialStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    trialEndsAt:
      overrides.trialEndsAt === undefined
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        : overrides.trialEndsAt,
  });
}

/** A fully onboarded workspace, WITH a caller-controlled entitlement row. */
async function createWorkspaceWithEntitlement(
  db: ReturnType<typeof getTestDb>,
  ownerUserId: string,
  entitlement: Parameters<typeof seedEntitlement>[2] = {},
) {
  const workspaceId = await createIncompleteWorkspace(db, ownerUserId);
  await seedEntitlement(db, workspaceId, entitlement);
  return workspaceId;
}

async function seedAccount(
  db: ReturnType<typeof getTestDb>,
  workspaceId: string,
  overrides: { name?: string; isArchived?: boolean } = {},
) {
  const [account] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId,
      name: overrides.name ?? 'Seed Account',
      accountMode: 'live',
      baseCurrency: 'USD',
      startingBalance: '10000',
      timezone: 'UTC',
      isArchived: overrides.isArchived ?? false,
    })
    .returning({ id: tradingAccounts.id });
  if (account === undefined) throw new Error('failed to seed account');
  return account.id;
}

function accountInput(overrides: { mutationKey?: string; name?: string } = {}) {
  return {
    name: overrides.name ?? 'Additional Account',
    accountMode: 'demo' as const,
    baseCurrency: 'EUR',
    startingBalance: '1000',
    timezone: 'UTC',
    mutationKey: overrides.mutationKey ?? crypto.randomUUID(),
    setActive: false,
  };
}

const ONBOARDING_INPUT: OnboardingSubmitData = {
  name: 'First Account',
  accountMode: 'live',
  baseCurrency: 'USD',
  startingBalance: '5000',
  timezone: 'UTC',
};

describe('entitlement enforcement (real database)', () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    currentSession = null;
    const db = getTestDb();
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe('completeOnboarding — trial start', () => {
    it('starts exactly one 7-day trial atomically with the first account', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createIncompleteWorkspace(db, userId);
      currentSession = sessionFor(userId);

      const before = Date.now();
      await completeOnboarding(workspaceId, userId, ONBOARDING_INPUT);
      const after = Date.now();

      const rows = await db
        .select()
        .from(workspaceEntitlements)
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (row === undefined) throw new Error('expected entitlement row');
      expect(row.status).toBe('trialing');
      expect(row.trialStartedAt).not.toBeNull();
      expect(row.trialEndsAt).not.toBeNull();
      const trialMs = row.trialEndsAt!.getTime() - row.trialStartedAt!.getTime();
      expect(trialMs).toBe(7 * 24 * 60 * 60 * 1000);
      expect(row.trialStartedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(row.trialStartedAt!.getTime()).toBeLessThanOrEqual(after);

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.action, 'workspace.trial_started'),
          ),
        );
      expect(auditRows).toHaveLength(1);
      const serialized = JSON.stringify(auditRows[0]?.metadata ?? {});
      expect(serialized).not.toContain('plan');
      expect(serialized).not.toContain('status');
    });

    it('does not restart or extend the trial on a repeated onboarding completion', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createIncompleteWorkspace(db, userId);
      currentSession = sessionFor(userId);

      await completeOnboarding(workspaceId, userId, ONBOARDING_INPUT);
      const firstRows = await db
        .select()
        .from(workspaceEntitlements)
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));
      const firstTrialEndsAt = firstRows[0]?.trialEndsAt?.getTime();

      await new Promise((resolve) => setTimeout(resolve, 10));
      await completeOnboarding(workspaceId, userId, ONBOARDING_INPUT);

      const rows = await db
        .select()
        .from(workspaceEntitlements)
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.trialEndsAt?.getTime()).toBe(firstTrialEndsAt);
    });

    it('does not start a trial for a workspace whose onboarding has not completed', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createIncompleteWorkspace(db, userId);

      const rows = await db
        .select()
        .from(workspaceEntitlements)
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));
      expect(rows).toHaveLength(0);
    });
  });

  describe('createTradingAccount — limits', () => {
    it('allows creating up to the trial limit (10)', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId);
      currentSession = sessionFor(userId);
      for (let i = 0; i < 9; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}` });
      }

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result.ok).toBe(true);
    });

    it('rejects creation once the trial limit is reached', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId);
      currentSession = sessionFor(userId);
      for (let i = 0; i < 10; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}` });
      }

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result).toEqual({ ok: false, code: 'account_limit_reached' });

      const accounts = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceId));
      expect(accounts).toHaveLength(10);
    });

    it('archived accounts do not consume the allowance', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId);
      currentSession = sessionFor(userId);
      for (let i = 0; i < 10; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}`, isArchived: i < 3 });
      }

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result.ok).toBe(true);
    });

    it('a low-plan workspace is limited to its plan allowance, not the trial limit', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'starter',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      await seedAccount(db, workspaceId);

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result).toEqual({ ok: false, code: 'account_limit_reached' });
    });

    it('rejects creation for an expired trial', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        trialEndsAt: new Date(Date.now() - 1000),
      });
      currentSession = sessionFor(userId);
      await seedAccount(db, workspaceId);

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result).toEqual({ ok: false, code: 'trial_expired' });
    });

    it('rejects creation for an unrecognized plan (fail closed)', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'mystery',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      await seedAccount(db, workspaceId);

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result).toEqual({ ok: false, code: 'unknown_plan' });
    });

    it('a replayed mutation key returns the original account even at the limit', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId);
      currentSession = sessionFor(userId);
      const mutationKey = crypto.randomUUID();

      const first = await createTradingAccount(workspaceId, userId, accountInput({ mutationKey }));
      if (!first.ok) throw new Error(`expected success, got ${first.code}`);
      for (let i = 0; i < 9; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}` });
      }

      const replay = await createTradingAccount(workspaceId, userId, accountInput({ mutationKey }));
      expect(replay).toEqual({ ok: true, accountId: first.accountId, alreadyCreated: true });
    });

    it('two creates racing for the last slot produce exactly one success and one rejection', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId);
      currentSession = sessionFor(userId);
      for (let i = 0; i < 9; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}` });
      }

      const [a, b] = await Promise.all([
        createTradingAccount(workspaceId, userId, accountInput()),
        createTradingAccount(workspaceId, userId, accountInput()),
      ]);

      const outcomes = [a, b];
      expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
      expect(outcomes.filter((result) => !result.ok)).toHaveLength(1);

      const accounts = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceId));
      expect(accounts).toHaveLength(10);
    });
  });

  describe('restoreTradingAccount — limits', () => {
    it('restoring consumes allowance and is rejected once it would exceed the limit', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'starter',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      await seedAccount(db, workspaceId);
      const archivedId = await seedAccount(db, workspaceId, { isArchived: true });

      const result = await restoreTradingAccount(workspaceId, userId, archivedId);
      expect(result).toEqual({ ok: false, code: 'account_limit_reached' });
    });

    it('restoring is allowed once an active account is archived below the limit', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'starter',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      const activeId = await seedAccount(db, workspaceId);
      const archivedId = await seedAccount(db, workspaceId, { isArchived: true });

      await db
        .update(tradingAccounts)
        .set({ isArchived: true })
        .where(eq(tradingAccounts.id, activeId));

      const result = await restoreTradingAccount(workspaceId, userId, archivedId);
      expect(result).toEqual({ ok: true });
    });

    it('rejects restore for an expired trial', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        trialEndsAt: new Date(Date.now() - 1000),
      });
      currentSession = sessionFor(userId);
      const archivedId = await seedAccount(db, workspaceId, { isArchived: true });

      const result = await restoreTradingAccount(workspaceId, userId, archivedId);
      expect(result).toEqual({ ok: false, code: 'trial_expired' });
    });

    it('two restores racing for the last slot produce exactly one success and one rejection', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'pro',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      await seedAccount(db, workspaceId);
      const archivedA = await seedAccount(db, workspaceId, { isArchived: true });
      const archivedB = await seedAccount(db, workspaceId, { isArchived: true });

      const [a, b] = await Promise.all([
        restoreTradingAccount(workspaceId, userId, archivedA),
        restoreTradingAccount(workspaceId, userId, archivedB),
      ]);

      const outcomes = [a, b];
      expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
      expect(outcomes.filter((result) => !result.ok)).toHaveLength(1);

      const activeAccounts = await db
        .select()
        .from(tradingAccounts)
        .where(
          and(eq(tradingAccounts.workspaceId, workspaceId), eq(tradingAccounts.isArchived, false)),
        );
      expect(activeAccounts).toHaveLength(3);
    });

    it('a create and a restore racing for the same last slot never both succeed', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'pro',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      await seedAccount(db, workspaceId);
      await seedAccount(db, workspaceId);
      const archivedId = await seedAccount(db, workspaceId, { isArchived: true });

      const [createResult, restoreResult] = await Promise.all([
        createTradingAccount(workspaceId, userId, accountInput()),
        restoreTradingAccount(workspaceId, userId, archivedId),
      ]);

      const succeeded = [createResult.ok, restoreResult.ok].filter(Boolean);
      expect(succeeded).toHaveLength(1);

      const activeAccounts = await db
        .select()
        .from(tradingAccounts)
        .where(
          and(eq(tradingAccounts.workspaceId, workspaceId), eq(tradingAccounts.isArchived, false)),
        );
      expect(activeAccounts).toHaveLength(3);
    });
  });

  describe('readEffectiveEntitlement', () => {
    it('excludes archived accounts from the active count', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId);
      await seedAccount(db, workspaceId);
      await seedAccount(db, workspaceId, { isArchived: true });
      await seedAccount(db, workspaceId, { isArchived: true });

      const effective = await readEffectiveEntitlement(db, workspaceId);
      expect(effective?.activeAccountCount).toBe(1);
    });

    it('never logs plan, status, or trial dates on the trial_started audit row', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createIncompleteWorkspace(db, userId);
      currentSession = sessionFor(userId);

      await completeOnboarding(workspaceId, userId, ONBOARDING_INPUT);

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.action, 'workspace.trial_started'),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata).toEqual({});
    });
  });
});
