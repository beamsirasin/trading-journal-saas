import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createFixedClock } from '@/lib/time';
import { closeDb } from '@/server/db/client';
import {
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { startTrialInTx } from './entitlement';
import {
  activatePaidSubscription,
  applyImmediateUpgrade,
  markSubscriptionExpired,
  scheduleCancellationAtPeriodEnd,
} from './subscription-lifecycle';

/**
 * Phase 11B's truthfulness contract for `workspace_entitlements.source`:
 * `startTrialInTx` always writes `'trial'`; a real, trusted paid activation
 * always writes `'paid'`; nothing else in the existing Phase 04 lifecycle
 * touches this column, so cancellation/expiry/upgrade must all preserve
 * whatever provenance was already there. No test here exercises
 * `'complimentary'` — nothing writes it until a future Phase 11E action
 * exists (see `admin-foundation-migration.integration.test.ts` for the DB
 * CHECK proving the value is at least accepted by the column today).
 */
describe('workspace_entitlements.source truthfulness across the Phase 04 lifecycle (real database)', () => {
  const NOW = new Date('2026-08-10T00:00:00Z');
  const PERIOD_START = new Date('2026-08-01T00:00:00Z');
  const PERIOD_END = new Date('2026-09-01T00:00:00Z');
  const workspaceIds: string[] = [];

  async function createWorkspaceAndUser(): Promise<{ workspaceId: string; userId: string }> {
    const db = getTestDb();
    const [user] = await db
      .insert(users)
      .values({
        name: 'Entitlement source test user',
        email: `entitlement-source-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      })
      .returning({ id: users.id });
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: 'Entitlement source workspace',
        slug: `entitlement-source-${crypto.randomUUID()}`,
      })
      .returning({ id: workspaces.id });
    if (user === undefined || workspace === undefined) {
      throw new Error('failed to create test fixtures');
    }
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
    await db.insert(userPreferences).values({ userId: user.id, activeWorkspaceId: workspace.id });
    workspaceIds.push(workspace.id);
    return { workspaceId: workspace.id, userId: user.id };
  }

  async function readSource(workspaceId: string): Promise<string | undefined> {
    const [row] = await getTestDb()
      .select({ source: workspaceEntitlements.source })
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    return row?.source;
  }

  afterEach(async () => {
    const db = getTestDb();
    for (const workspaceId of workspaceIds.splice(0)) {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
  });

  afterAll(async () => {
    await closeDb();
    await closeTestDb();
  });

  it("startTrialInTx writes source = 'trial'", async () => {
    const db = getTestDb();
    const { workspaceId, userId } = await createWorkspaceAndUser();
    await db.transaction((tx) => startTrialInTx(tx, workspaceId, userId, createFixedClock(NOW)));
    expect(await readSource(workspaceId)).toBe('trial');
  });

  it("a real trusted paid activation overwrites source to 'paid', from a trial", async () => {
    const db = getTestDb();
    const { workspaceId, userId } = await createWorkspaceAndUser();
    await db.transaction((tx) => startTrialInTx(tx, workspaceId, userId, createFixedClock(NOW)));
    expect(await readSource(workspaceId)).toBe('trial');

    await activatePaidSubscription(
      {
        workspaceId,
        planKey: 'trader',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        periodStartedAt: PERIOD_START,
        periodEndsAt: PERIOD_END,
      },
      createFixedClock(NOW),
    );
    expect(await readSource(workspaceId)).toBe('paid');
  });

  it("an immediate upgrade on an already-paid workspace leaves source as 'paid'", async () => {
    const { workspaceId, userId } = await createWorkspaceAndUser();
    await getTestDb().transaction((tx) =>
      startTrialInTx(tx, workspaceId, userId, createFixedClock(NOW)),
    );
    await activatePaidSubscription(
      {
        workspaceId,
        planKey: 'starter',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        periodStartedAt: PERIOD_START,
        periodEndsAt: PERIOD_END,
      },
      createFixedClock(NOW),
    );
    expect(await readSource(workspaceId)).toBe('paid');

    await applyImmediateUpgrade(
      {
        workspaceId,
        planKey: 'trader',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        periodStartedAt: PERIOD_START,
        periodEndsAt: PERIOD_END,
      },
      createFixedClock(NOW),
    );
    expect(await readSource(workspaceId)).toBe('paid');
  });

  it('cancellation at period end does not erase paid provenance', async () => {
    const { workspaceId, userId } = await createWorkspaceAndUser();
    await getTestDb().transaction((tx) =>
      startTrialInTx(tx, workspaceId, userId, createFixedClock(NOW)),
    );
    await activatePaidSubscription(
      {
        workspaceId,
        planKey: 'trader',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        periodStartedAt: PERIOD_START,
        periodEndsAt: PERIOD_END,
      },
      createFixedClock(NOW),
    );

    await scheduleCancellationAtPeriodEnd({ workspaceId }, createFixedClock(NOW));
    expect(await readSource(workspaceId)).toBe('paid');
  });

  it('marking a paid subscription expired does not erase paid provenance', async () => {
    const { workspaceId, userId } = await createWorkspaceAndUser();
    await getTestDb().transaction((tx) =>
      startTrialInTx(tx, workspaceId, userId, createFixedClock(NOW)),
    );
    await activatePaidSubscription(
      {
        workspaceId,
        planKey: 'trader',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        periodStartedAt: PERIOD_START,
        periodEndsAt: PERIOD_END,
      },
      createFixedClock(NOW),
    );

    await markSubscriptionExpired({ workspaceId }, createFixedClock(NOW));
    expect(await readSource(workspaceId)).toBe('paid');
  });
});
