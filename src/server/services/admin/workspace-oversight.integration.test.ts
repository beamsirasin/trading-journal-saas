import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createFixedClock } from '@/lib/time';
import {
  billingTransactions,
  platformAdmins,
  setups,
  strategies,
  strategySetupVersions,
  strategyVersions,
  trades,
  tradingAccounts,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Read-only Workspace oversight (Phase 11D), against a real database.
 * Mirrors `user-oversight.integration.test.ts`'s and
 * `metrics.integration.test.ts`'s exact fixture/session conventions.
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

const { getAdminWorkspaceList, getAdminWorkspaceDetail } = await import('./workspace-oversight');
const { PlatformAdminRequiredError } = await import('@/server/auth/admin-dal');

const db = getTestDb();
const NOW = new Date('2026-08-10T12:00:00Z');

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Workspace oversight test admin',
      email: 'workspace-oversight-test@example.test',
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

describe('Workspace oversight (real database)', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  async function createUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({
        name: 'Workspace oversight fixture user',
        email: `workspace-oversight-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      })
      .returning({ id: users.id });
    if (user === undefined) throw new Error('failed to insert test user');
    userIds.push(user.id);
    return user.id;
  }

  async function createWorkspace(name: string): Promise<string> {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name, slug: `workspace-oversight-${crypto.randomUUID()}` })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to insert test workspace');
    workspaceIds.push(workspace.id);
    return workspace.id;
  }

  async function addMember(
    workspaceId: string,
    userId: string,
    role: 'owner' | 'member' = 'owner',
  ): Promise<void> {
    await db.insert(workspaceMembers).values({ workspaceId, userId, role, status: 'active' });
  }

  async function createEntitlement(
    workspaceId: string,
    overrides: Partial<typeof workspaceEntitlements.$inferInsert>,
  ): Promise<void> {
    await db
      .insert(workspaceEntitlements)
      .values({ workspaceId, status: 'trialing', ...overrides });
  }

  async function createAccount(
    workspaceId: string,
    overrides: Partial<typeof tradingAccounts.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: 'Workspace oversight account',
        accountMode: 'demo',
        baseCurrency: 'USD',
        startingBalance: '10000.0000000000',
        timezone: 'UTC',
        ...overrides,
      })
      .returning({ id: tradingAccounts.id });
    if (row === undefined) throw new Error('account insert failed');
    return row.id;
  }

  async function createFramework(workspaceId: string, isArchived = false) {
    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId, isArchived })
      .returning({ id: strategies.id });
    if (strategy === undefined) throw new Error('strategy insert failed');
    const [version] = await db
      .insert(strategyVersions)
      .values({ workspaceId, strategyId: strategy.id, versionNumber: 1, name: 'v1' })
      .returning({ id: strategyVersions.id });
    if (version === undefined) throw new Error('version insert failed');
    const [setup] = await db
      .insert(setups)
      .values({ workspaceId, strategyId: strategy.id })
      .returning({ id: setups.id });
    if (setup === undefined) throw new Error('setup insert failed');
    const [setupVersion] = await db
      .insert(strategySetupVersions)
      .values({
        workspaceId,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        setupId: setup.id,
        name: 'Setup v1',
      })
      .returning({ id: strategySetupVersions.id });
    if (setupVersion === undefined) throw new Error('setup version insert failed');
    return {
      strategyId: strategy.id,
      strategyVersionId: version.id,
      setupId: setup.id,
      setupVersionId: setupVersion.id,
    };
  }

  async function createMinimalTrade(
    workspaceId: string,
    accountId: string,
    framework: Awaited<ReturnType<typeof createFramework>>,
    options: { deletedAt?: Date } = {},
  ): Promise<string> {
    const [row] = await db
      .insert(trades)
      .values({
        workspaceId,
        tradingAccountId: accountId,
        strategyId: framework.strategyId,
        strategyVersionId: framework.strategyVersionId,
        setupId: framework.setupId,
        setupVersionId: framework.setupVersionId,
        symbol: 'EURUSD',
        direction: 'long',
        plannedEntry: '100.0000000000',
        plannedStop: '99.0000000000',
        plannedTarget: '102.0000000000',
        plannedR: '2.0000',
        status: 'planned',
        ...(options.deletedAt === undefined ? {} : { deletedAt: options.deletedAt }),
      })
      .returning({ id: trades.id });
    if (row === undefined) throw new Error('trade insert failed');
    return row.id;
  }

  async function createBillingTransaction(
    workspaceId: string,
    overrides: Partial<typeof billingTransactions.$inferInsert> = {},
  ): Promise<void> {
    await db.insert(billingTransactions).values({
      workspaceId,
      idempotencyKey: crypto.randomUUID(),
      planKey: 'starter',
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      subtotalMinor: 500n,
      vatEnabled: false,
      appliedVatRateBasisPoints: 0,
      vatAmountMinor: 0n,
      totalMinor: 500n,
      taxMode: 'disabled',
      status: 'succeeded',
      ...overrides,
    });
  }

  async function grantAdmin(userId: string): Promise<void> {
    await db.insert(platformAdmins).values({ userId });
  }

  afterEach(async () => {
    currentSession = null;
    const pendingWorkspaceIds = workspaceIds.splice(0);
    if (pendingWorkspaceIds.length > 0) {
      // `billing_transactions.workspace_id` is RESTRICT (immutable financial
      // history) — this fixture's own billing rows must be cleared before
      // the workspace can be deleted, the same ordering constraint
      // `workspace-export.integration.test.ts` observes for the same table.
      await db
        .delete(billingTransactions)
        .where(inArray(billingTransactions.workspaceId, pendingWorkspaceIds));
    }
    for (const workspaceId of pendingWorkspaceIds) {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await db.delete(platformAdmins).where(eq(platformAdmins.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe('authorization', () => {
    it('a non-admin caller is denied for both list and detail', async () => {
      const userId = await createUser();
      currentSession = sessionFor(userId);
      await expect(getAdminWorkspaceList({}, createFixedClock(NOW))).rejects.toBeInstanceOf(
        PlatformAdminRequiredError,
      );
      const workspaceId = await createWorkspace('Auth fixture workspace');
      await expect(
        getAdminWorkspaceDetail(workspaceId, createFixedClock(NOW)),
      ).rejects.toBeInstanceOf(PlatformAdminRequiredError);
    });

    it('an active admin is allowed', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);
      await expect(getAdminWorkspaceList({}, createFixedClock(NOW))).resolves.toBeDefined();
    });
  });

  describe('list', () => {
    it('finds a workspace by exact ID', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const targetId = await createWorkspace('Findable By Id');
      const page = await getAdminWorkspaceList({ q: targetId }, createFixedClock(NOW));
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.workspaceId).toBe(targetId);
    });

    it('finds a workspace by a case-insensitive name prefix', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const marker = crypto.randomUUID().slice(0, 8);
      await createWorkspace(`Zebra-${marker} Fund`);
      const page = await getAdminWorkspaceList({ q: `zebra-${marker}` }, createFixedClock(NOW));
      expect(page.items).toHaveLength(1);
    });

    it('filters by plan, excluding a workspace on a different plan', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const marker = crypto.randomUUID().slice(0, 8);
      const proWorkspaceId = await createWorkspace(`Plan filter pro ${marker}`);
      const starterWorkspaceId = await createWorkspace(`Plan filter starter ${marker}`);
      await createEntitlement(proWorkspaceId, {
        status: 'active',
        planKey: 'professional',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
        source: 'paid',
      });
      await createEntitlement(starterWorkspaceId, {
        status: 'active',
        planKey: 'starter',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
        source: 'paid',
      });

      const page = await getAdminWorkspaceList(
        { q: `Plan filter`, plan: 'professional' },
        createFixedClock(NOW),
      );
      const ids = page.items.map((item) => item.workspaceId);
      expect(ids).toContain(proWorkspaceId);
      expect(ids).not.toContain(starterWorkspaceId);
    });

    it('filters by source, excluding a workspace with a different source', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const marker = crypto.randomUUID().slice(0, 8);
      const compWorkspaceId = await createWorkspace(`Source filter comp ${marker}`);
      const paidWorkspaceId = await createWorkspace(`Source filter paid ${marker}`);
      await createEntitlement(compWorkspaceId, {
        status: 'active',
        planKey: 'professional',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
        source: 'complimentary',
      });
      await createEntitlement(paidWorkspaceId, {
        status: 'active',
        planKey: 'professional',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
        source: 'paid',
      });

      const page = await getAdminWorkspaceList(
        { q: 'Source filter', source: 'complimentary' },
        createFixedClock(NOW),
      );
      const ids = page.items.map((item) => item.workspaceId);
      expect(ids).toContain(compWorkspaceId);
      expect(ids).not.toContain(paidWorkspaceId);
    });

    it('a trial workspace with no plan_key stays "none", never assigned a paid plan', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const workspaceId = await createWorkspace(`No plan trial ${crypto.randomUUID()}`);
      await createEntitlement(workspaceId, {
        status: 'trialing',
        trialStartedAt: NOW,
        trialEndsAt: new Date(NOW.getTime() + 7 * 86_400_000),
        planKey: null,
        source: 'trial',
      });

      const page = await getAdminWorkspaceList({ q: workspaceId }, createFixedClock(NOW));
      expect(page.items[0]?.effectivePlanKey).toBeNull();

      const noneFiltered = await getAdminWorkspaceList(
        { q: workspaceId, plan: 'none' },
        createFixedClock(NOW),
      );
      expect(noneFiltered.items.map((i) => i.workspaceId)).toContain(workspaceId);
    });

    it('reports active vs. archived trading-account counts correctly', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const workspaceId = await createWorkspace(`Account counts ${crypto.randomUUID()}`);
      await createAccount(workspaceId);
      await createAccount(workspaceId);
      await createAccount(workspaceId, { isArchived: true });

      const page = await getAdminWorkspaceList({ q: workspaceId }, createFixedClock(NOW));
      expect(page.items[0]?.activeTradingAccounts).toBe(2);
      expect(page.items[0]?.archivedTradingAccounts).toBe(1);
    });

    it('an owned workspace reports its single owner; an ownerless workspace reports "none"', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const ownerUserId = await createUser();
      const ownedWorkspaceId = await createWorkspace(`Owned ${crypto.randomUUID()}`);
      await addMember(ownedWorkspaceId, ownerUserId, 'owner');
      const ownerlessWorkspaceId = await createWorkspace(`Ownerless ${crypto.randomUUID()}`);

      const ownedPage = await getAdminWorkspaceList({ q: ownedWorkspaceId }, createFixedClock(NOW));
      expect(ownedPage.items[0]?.owner.kind).toBe('single');

      const ownerlessPage = await getAdminWorkspaceList(
        { q: ownerlessWorkspaceId },
        createFixedClock(NOW),
      );
      expect(ownerlessPage.items[0]?.owner).toEqual({ kind: 'none' });
    });

    it('the DTO is JSON-safe and leaks no Trade, Strategy, or provider content', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const workspaceId = await createWorkspace(`No leak list ${crypto.randomUUID()}`);
      const accountId = await createAccount(workspaceId);
      const framework = await createFramework(workspaceId);
      await createMinimalTrade(workspaceId, accountId, framework);

      const page = await getAdminWorkspaceList({ q: workspaceId }, createFixedClock(NOW));
      const serialized = JSON.stringify(page);
      expect(serialized).not.toContain('EURUSD');
      expect(serialized).not.toContain('plannedEntry');
      const roundTripped = JSON.parse(serialized) as typeof page;
      expect(roundTripped).toEqual(page);
    });
  });

  describe('detail', () => {
    it('returns null for an unknown workspaceId — the caller renders a 404, not a 403', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const result = await getAdminWorkspaceDetail(crypto.randomUUID(), createFixedClock(NOW));
      expect(result).toBeNull();
    });

    it('reports account, strategy (including archived), and trade (including soft-deleted) counts', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const workspaceId = await createWorkspace(`Counts detail ${crypto.randomUUID()}`);
      const accountId = await createAccount(workspaceId);
      await createAccount(workspaceId, { isArchived: true });
      const activeFramework = await createFramework(workspaceId);
      await createFramework(workspaceId, true);
      await createMinimalTrade(workspaceId, accountId, activeFramework);
      await createMinimalTrade(workspaceId, accountId, activeFramework, {
        deletedAt: new Date('2026-08-01T00:00:00Z'),
      });

      const detail = await getAdminWorkspaceDetail(workspaceId, createFixedClock(NOW));
      expect(detail?.tradingAccounts).toEqual({ active: 1, archived: 1 });
      expect(detail?.strategies).toEqual({ total: 2, archived: 1 });
      expect(detail?.trades).toEqual({ total: 2, softDeleted: 1 });
    });

    it('reports the canonical effective subscription state, not the raw persisted status', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const workspaceId = await createWorkspace(`Effective status ${crypto.randomUUID()}`);
      await createEntitlement(workspaceId, {
        status: 'trialing',
        trialStartedAt: new Date('2026-01-01T00:00:00Z'),
        trialEndsAt: new Date('2026-01-08T00:00:00Z'), // long past NOW
        source: 'trial',
      });

      const detail = await getAdminWorkspaceDetail(workspaceId, createFixedClock(NOW));
      expect(detail?.subscription.effectiveStatus).toBe('expired');
    });

    it('exposes a sanitized latest billing transaction with the exact currency, and an accurate total count', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const workspaceId = await createWorkspace(`Billing detail ${crypto.randomUUID()}`);
      await createBillingTransaction(workspaceId, {
        billingCurrency: 'THB',
        subtotalMinor: 29900n,
        vatEnabled: false,
        appliedVatRateBasisPoints: 0,
        vatAmountMinor: 0n,
        totalMinor: 29900n,
        taxMode: 'disabled',
        planKey: 'trader',
      });
      await createBillingTransaction(workspaceId);

      const detail = await getAdminWorkspaceDetail(workspaceId, createFixedClock(NOW));
      expect(detail?.billing.transactionCount).toBe(2);
      expect(detail?.billing.latestTransaction).not.toBeNull();
      expect(detail?.billing.latestTransaction?.currency).toBe('USD'); // the second (later) transaction
    });

    it('a workspace with no billing transactions reports null latestTransaction and zero count', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const workspaceId = await createWorkspace(`No billing ${crypto.randomUUID()}`);
      const detail = await getAdminWorkspaceDetail(workspaceId, createFixedClock(NOW));
      expect(detail?.billing).toEqual({ latestTransaction: null, transactionCount: 0 });
    });

    it('the DTO is JSON-safe and leaks no Strategy name, Trade row, or billing-provider identifier', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const workspaceId = await createWorkspace(`No leak detail ${crypto.randomUUID()}`);
      const accountId = await createAccount(workspaceId);
      const framework = await createFramework(workspaceId);
      await createMinimalTrade(workspaceId, accountId, framework);
      const marker = crypto.randomUUID();
      await createBillingTransaction(workspaceId, {
        providerKind: 'mock',
        providerCheckoutId: `checkout_should_never_leak_${marker}`,
        providerPaymentId: `payment_should_never_leak_${marker}`,
      });

      const detail = await getAdminWorkspaceDetail(workspaceId, createFixedClock(NOW));
      const serialized = JSON.stringify(detail);
      expect(serialized).not.toContain('EURUSD');
      expect(serialized).not.toContain('checkout_should_never_leak');
      expect(serialized).not.toContain('payment_should_never_leak');
      expect(serialized).not.toContain('idempotencyKey');
      const roundTripped = JSON.parse(serialized) as typeof detail;
      expect(roundTripped).toEqual(detail);
    });
  });
});
