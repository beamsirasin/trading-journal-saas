import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createFixedClock } from '@/lib/time';
import type { UpdateAccountData } from '@/lib/trading-accounts/schema';
import { closeDb } from '@/server/db/client';
import {
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import {
  archiveTradingAccount,
  createTradingAccount,
  restoreTradingAccount,
  setActiveTradingAccount,
  updateTradingAccount,
} from './trading-account-management';

const NOW = new Date('2026-08-01T00:00:00Z');
const CLOCK = createFixedClock(NOW);
const UPDATE_INPUT: UpdateAccountData = {
  name: 'Updated account',
  accountMode: 'live',
  baseCurrency: 'USD',
  startingBalance: '10000',
  timezone: 'UTC',
};

describe('workspace mutation authorization (real database)', () => {
  const userIds: string[] = [];

  async function createUser(): Promise<string> {
    const db = getTestDb();
    const [user] = await db
      .insert(users)
      .values({
        name: 'Mutation owner',
        email: `mutation-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      })
      .returning({ id: users.id });
    if (user === undefined) throw new Error('failed to create mutation user');
    userIds.push(user.id);
    return user.id;
  }

  async function createWorkspace(
    userId: string,
    entitlement: Partial<typeof workspaceEntitlements.$inferInsert>,
  ): Promise<string> {
    const db = getTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: 'Mutation workspace',
        slug: `mutation-${crypto.randomUUID()}`,
        personalOwnerUserId: userId,
      })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to create mutation workspace');
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: 'owner' });
    await db.insert(userPreferences).values({ userId, activeWorkspaceId: workspace.id });
    await db.insert(workspaceEntitlements).values({
      workspaceId: workspace.id,
      status: 'trialing',
      trialStartedAt: new Date('2026-07-25T00:00:00Z'),
      trialEndsAt: new Date('2026-08-01T00:00:00Z'),
      ...entitlement,
    });
    return workspace.id;
  }

  async function seedAccount(
    workspaceId: string,
    overrides: { name?: string; archived?: boolean } = {},
  ): Promise<string> {
    const [account] = await getTestDb()
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: overrides.name ?? 'Seed account',
        accountMode: 'live',
        baseCurrency: 'USD',
        startingBalance: '10000',
        timezone: 'UTC',
        isArchived: overrides.archived ?? false,
      })
      .returning({ id: tradingAccounts.id });
    if (account === undefined) throw new Error('failed to seed mutation account');
    return account.id;
  }

  function createInput() {
    return {
      name: 'New account',
      accountMode: 'demo' as const,
      baseCurrency: 'USD',
      startingBalance: '5000',
      timezone: 'UTC',
      mutationKey: crypto.randomUUID(),
      setActive: false,
    };
  }

  function activePaid(planKey: 'starter' | 'trader' | 'professional') {
    return {
      status: 'active' as const,
      planKey,
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      currentPeriodStartedAt: new Date('2026-07-15T00:00:00Z'),
      currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
    };
  }

  afterEach(async () => {
    const db = getTestDb();
    for (const userId of userIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeDb();
    await closeTestDb();
  });

  it('lets an expired trial change its viewing account but blocks business mutations', async () => {
    const userId = await createUser();
    const workspaceId = await createWorkspace(userId, {});
    const firstId = await seedAccount(workspaceId, { name: 'First' });
    const secondId = await seedAccount(workspaceId, { name: 'Second' });
    const archivedId = await seedAccount(workspaceId, { name: 'Archived', archived: true });

    await expect(
      updateTradingAccount(workspaceId, userId, firstId, UPDATE_INPUT, CLOCK),
    ).resolves.toEqual({ ok: false, code: 'read_only_workspace' });
    await expect(setActiveTradingAccount(workspaceId, userId, secondId)).resolves.toEqual({
      ok: true,
    });
    await expect(createTradingAccount(workspaceId, userId, createInput(), CLOCK)).resolves.toEqual({
      ok: false,
      code: 'trial_expired',
    });
    await expect(restoreTradingAccount(workspaceId, userId, archivedId, CLOCK)).resolves.toEqual({
      ok: false,
      code: 'trial_expired',
    });
    await expect(archiveTradingAccount(workspaceId, userId, secondId, CLOCK)).resolves.toEqual({
      ok: false,
      code: 'read_only_workspace',
    });

    const [preference] = await getTestDb()
      .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    expect(preference?.activeTradingAccountId).toBe(secondId);
  });

  it('lets past-due, canceled, and explicitly expired workspaces select accounts only', async () => {
    for (const status of ['past_due', 'canceled', 'expired'] as const) {
      const userId = await createUser();
      const workspaceId = await createWorkspace(userId, { ...activePaid('trader'), status });
      const firstId = await seedAccount(workspaceId, { name: `${status} first` });
      const secondId = await seedAccount(workspaceId, { name: `${status} second` });
      const archivedId = await seedAccount(workspaceId, {
        name: `${status} archived`,
        archived: true,
      });

      await expect(setActiveTradingAccount(workspaceId, userId, secondId)).resolves.toEqual({
        ok: true,
      });
      await expect(
        updateTradingAccount(workspaceId, userId, firstId, UPDATE_INPUT, CLOCK),
      ).resolves.toEqual({ ok: false, code: 'read_only_workspace' });
      await expect(
        createTradingAccount(workspaceId, userId, createInput(), CLOCK),
      ).resolves.toMatchObject({ ok: false });
      await expect(
        restoreTradingAccount(workspaceId, userId, archivedId, CLOCK),
      ).resolves.toMatchObject({ ok: false });
      await expect(archiveTradingAccount(workspaceId, userId, secondId, CLOCK)).resolves.toEqual({
        ok: false,
        code: 'read_only_workspace',
      });

      const [preference] = await getTestDb()
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      expect(preference?.activeTradingAccountId).toBe(secondId);
    }
  });

  it('blocks non-compliance-preserving writes while over limit, permits archive, then resumes writes', async () => {
    const userId = await createUser();
    const workspaceId = await createWorkspace(userId, activePaid('starter'));
    const firstId = await seedAccount(workspaceId, { name: 'First' });
    const secondId = await seedAccount(workspaceId, { name: 'Second' });
    const archivedId = await seedAccount(workspaceId, { name: 'Archived', archived: true });
    await getTestDb()
      .update(userPreferences)
      .set({ activeTradingAccountId: firstId })
      .where(eq(userPreferences.userId, userId));

    await expect(createTradingAccount(workspaceId, userId, createInput(), CLOCK)).resolves.toEqual({
      ok: false,
      code: 'workspace_over_limit',
    });
    await expect(restoreTradingAccount(workspaceId, userId, archivedId, CLOCK)).resolves.toEqual({
      ok: false,
      code: 'workspace_over_limit',
    });
    await expect(
      updateTradingAccount(workspaceId, userId, firstId, UPDATE_INPUT, CLOCK),
    ).resolves.toEqual({ ok: false, code: 'over_limit_workspace' });
    await expect(setActiveTradingAccount(workspaceId, userId, secondId)).resolves.toEqual({
      ok: true,
    });

    await expect(archiveTradingAccount(workspaceId, userId, secondId, CLOCK)).resolves.toEqual({
      ok: true,
    });
    await expect(
      updateTradingAccount(workspaceId, userId, firstId, UPDATE_INPUT, CLOCK),
    ).resolves.toEqual({ ok: true });
  });

  it('keeps Starter, Trader, and Professional writable below their respective limits', async () => {
    for (const planKey of ['starter', 'trader', 'professional'] as const) {
      const userId = await createUser();
      const workspaceId = await createWorkspace(userId, activePaid(planKey));
      await expect(
        createTradingAccount(workspaceId, userId, createInput(), CLOCK),
      ).resolves.toMatchObject({ ok: true, alreadyCreated: false });
    }
  });
});
