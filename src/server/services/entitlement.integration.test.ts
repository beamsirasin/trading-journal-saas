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
 *
 * Locked plan decision (correcting the earlier starter/pro/elite 1/3/10
 * draft): starter=1, trader=5, professional=15; the trial is a fixed
 * 1-account allowance, never derived from the highest configured plan.
 * Concurrency races that need more than one slot use Trader (racing for the
 * 5th slot) or Professional (racing for the 15th) — never the trial, whose
 * only race scenario is onboarding's own atomicity, already covered by
 * `trading-account.integration.test.ts`'s "creates exactly one account when
 * the same workspace onboards concurrently".
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
    planKey?: 'starter' | 'trader' | 'professional' | null;
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
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    currentPeriodStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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

    it('leaves the workspace at 1/1 usage immediately after onboarding', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createIncompleteWorkspace(db, userId);
      currentSession = sessionFor(userId);

      await completeOnboarding(workspaceId, userId, ONBOARDING_INPUT);

      const effective = await readEffectiveEntitlement(db, workspaceId);
      expect(effective?.accountLimit).toBe(1);
      expect(effective?.activeAccountCount).toBe(1);
      expect(effective?.remainingAccountSlots).toBe(0);
      expect(effective?.canCreateAccount).toBe(false);
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

  describe('createTradingAccount — trial (limit 1)', () => {
    it('allows the trial to reach its one-account allowance', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId);
      currentSession = sessionFor(userId);

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result.ok).toBe(true);
    });

    it('rejects a second account once the trial holds its one allowed account', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId);
      currentSession = sessionFor(userId);
      await seedAccount(db, workspaceId);

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result).toEqual({ ok: false, code: 'account_limit_reached' });

      const accounts = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceId));
      expect(accounts).toHaveLength(1);
    });

    it('archived accounts do not consume the trial allowance', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId);
      currentSession = sessionFor(userId);
      await seedAccount(db, workspaceId, { isArchived: true });

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result.ok).toBe(true);
    });

    it('rejects creation for an expired trial', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        trialEndsAt: new Date(Date.now() - 1000),
      });
      currentSession = sessionFor(userId);

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result).toEqual({ ok: false, code: 'trial_expired' });
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

      // The workspace is now at its 1/1 trial limit — a genuine second
      // create would be rejected (proven above), but a replay of the SAME
      // mutation key must still succeed.
      const replay = await createTradingAccount(workspaceId, userId, accountInput({ mutationKey }));
      expect(replay).toEqual({ ok: true, accountId: first.accountId, alreadyCreated: true });
    });
  });

  describe('createTradingAccount — active plans', () => {
    it('Starter permits exactly 1 active account', async () => {
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

    it('Trader permits up to 5 active accounts', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'trader',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      for (let i = 0; i < 4; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}` });
      }

      const fifth = await createTradingAccount(workspaceId, userId, accountInput());
      expect(fifth.ok).toBe(true);

      const sixth = await createTradingAccount(workspaceId, userId, accountInput());
      expect(sixth).toEqual({ ok: false, code: 'account_limit_reached' });
    });

    it('Professional permits up to 15 active accounts', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'professional',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      for (let i = 0; i < 14; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}` });
      }

      const fifteenth = await createTradingAccount(workspaceId, userId, accountInput());
      expect(fifteenth.ok).toBe(true);

      const sixteenth = await createTradingAccount(workspaceId, userId, accountInput());
      expect(sixteenth).toEqual({ ok: false, code: 'account_limit_reached' });
    });

    /**
     * There is deliberately no DB-level integration test that inserts a
     * `mystery`/`pro`/`elite` `plan_key` and then calls `createTradingAccount`
     * against it: `workspace_entitlements_plan_key_check` (migration 0004)
     * makes that INSERT itself fail with a Postgres constraint violation
     * before the service code under test ever runs — the row is simply
     * impossible to create in this database, by design. The unknown-plan
     * fail-closed BEHAVIOR is proven at the layer that can actually exercise
     * it without corrupting the schema: `resolveEffectiveEntitlement`'s pure
     * unit tests (`src/lib/entitlements/resolve.test.ts` — "fails closed for
     * an unrecognized plan key", "fails closed for the retired draft plan
     * keys pro/elite"), which construct an `EntitlementRecord` directly in
     * memory, no database involved. Defense in depth is therefore: the CHECK
     * constraint (prevents the bad value from ever being persisted) plus the
     * pure resolver test (proves the application logic would fail closed if
     * it somehow were) — together covering both "can this state exist" and
     * "what happens if it did," without needing a test that defeats the
     * constraint to prove it. Migration 0004's own translation behavior
     * (pro→trader, elite→professional, timestamps preserved, new constraint
     * installed) is covered separately in
     * `entitlement-plan-key-migration.integration.test.ts`, against a
     * fixture that faithfully reproduces the pre-0004 schema rather than the
     * already-upgraded one this file's `createWorkspaceWithEntitlement` seeds
     * into.
     */
  });

  describe('restoreTradingAccount — limits', () => {
    it('restoring is rejected once it would exceed the Starter limit', async () => {
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

    it('Professional permits restoring up to its 15-account limit', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'professional',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      for (let i = 0; i < 14; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}` });
      }
      const archivedId = await seedAccount(db, workspaceId, { isArchived: true });

      const result = await restoreTradingAccount(workspaceId, userId, archivedId);
      expect(result).toEqual({ ok: true });
    });
  });

  describe('createTradingAccount / restoreTradingAccount — no entitlement row (anomaly)', () => {
    /**
     * Onboarding complete (so a real account exists, matching every actual
     * production workspace's guarantee) but no `workspace_entitlements` row —
     * the fail-closed anomaly `lockAndResolveEntitlement`/
     * `resolveEntitlementGate` treat as "nothing is allowed," never as
     * unlimited access. Not reachable through any real onboarding flow
     * (`completeOnboarding` always starts a trial atomically); this fixture
     * exists specifically to prove the server never fails open regardless.
     */
    async function createOnboardedWorkspaceWithoutEntitlement(
      db: ReturnType<typeof getTestDb>,
      ownerUserId: string,
    ) {
      const workspaceId = await createIncompleteWorkspace(db, ownerUserId);
      await db
        .update(workspaces)
        .set({ onboardingCompletedAt: new Date() })
        .where(eq(workspaces.id, workspaceId));
      return workspaceId;
    }

    it('createTradingAccount rejects with entitlement_unavailable', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createOnboardedWorkspaceWithoutEntitlement(db, userId);
      currentSession = sessionFor(userId);
      await seedAccount(db, workspaceId);

      const result = await createTradingAccount(workspaceId, userId, accountInput());
      expect(result).toEqual({ ok: false, code: 'entitlement_unavailable' });

      const accounts = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceId));
      expect(accounts).toHaveLength(1);
    });

    it('restoreTradingAccount rejects with entitlement_unavailable', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createOnboardedWorkspaceWithoutEntitlement(db, userId);
      currentSession = sessionFor(userId);
      const archivedId = await seedAccount(db, workspaceId, { isArchived: true });

      const result = await restoreTradingAccount(workspaceId, userId, archivedId);
      expect(result).toEqual({ ok: false, code: 'entitlement_unavailable' });

      const [account] = await db
        .select({ isArchived: tradingAccounts.isArchived })
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, archivedId));
      expect(account?.isArchived).toBe(true);
    });
  });

  /**
   * Every test below seeds exactly 4 pre-existing active accounts against a
   * Trader plan (limit 5) — exactly ONE slot remaining — before racing two
   * mutations for it. This count matters precisely: seeding only 3 (2 free
   * slots) makes "both succeed" the mathematically CORRECT outcome (each
   * consumes one of the two available slots), not a concurrency defect, so
   * asserting "exactly one success" against a 2-slot fixture is a test bug,
   * not evidence the server fails to serialize. 4 existing + 1 contested
   * slot is what actually exercises the race.
   */
  describe('concurrency — Trader (racing for the 5th slot)', () => {
    it('two creates racing for the last slot produce exactly one success and one rejection', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'trader',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      for (let i = 0; i < 4; i += 1) {
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
      expect(accounts).toHaveLength(5);
    });

    it('two restores racing for the last slot produce exactly one success and one rejection', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'trader',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      for (let i = 0; i < 4; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}` });
      }
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
      expect(activeAccounts).toHaveLength(5);
    });

    it('a create and a restore racing for the same last slot never both succeed', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'trader',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      for (let i = 0; i < 4; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}` });
      }
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
      expect(activeAccounts).toHaveLength(5);
    });

    it('the same mutation key retried under concurrent load still creates exactly one account at the limit', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'trader',
        trialEndsAt: null,
      });
      currentSession = sessionFor(userId);
      for (let i = 0; i < 4; i += 1) {
        await seedAccount(db, workspaceId, { name: `Seed ${i}` });
      }
      const mutationKey = crypto.randomUUID();

      const [a, b] = await Promise.all([
        createTradingAccount(workspaceId, userId, accountInput({ mutationKey })),
        createTradingAccount(workspaceId, userId, accountInput({ mutationKey })),
      ]);
      if (!a.ok) throw new Error(`expected success, got ${a.code}`);
      if (!b.ok) throw new Error(`expected success, got ${b.code}`);
      expect(a.accountId).toBe(b.accountId);

      const accounts = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceId));
      expect(accounts).toHaveLength(5);
    });
  });

  describe('readEffectiveEntitlement', () => {
    it('excludes archived accounts from the active count', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithEntitlement(db, userId, {
        status: 'active',
        planKey: 'trader',
        trialEndsAt: null,
      });
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
