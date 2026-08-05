import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  auditLogs,
  billingTransactions,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';
import {
  cancelPlanDowngradeAction,
  cancelSubscriptionCancellationAction,
  schedulePlanDowngradeAction,
  scheduleSubscriptionCancellationAction,
} from './subscription-management';

const actionState = vi.hoisted(() => ({
  context: null as null | { workspaceId: string; userId: string },
  unauthenticated: false,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/auth/dal', () => {
  class UnauthenticatedError extends Error {}
  return {
    UnauthenticatedError,
    getActiveWorkspaceContext: async () => {
      if (actionState.unauthenticated || actionState.context === null) {
        throw new UnauthenticatedError();
      }
      return actionState.context;
    },
  };
});

const userIds: string[] = [];
const workspaceIds: string[] = [];

async function createPaidWorkspace(planKey: 'starter' | 'trader' | 'professional') {
  const db = getTestDb();
  const [user] = await db
    .insert(users)
    .values({
      name: 'Subscription manager',
      email: `subscription-manager-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('user fixture failed');
  userIds.push(user.id);
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Subscription workspace',
      slug: `subscription-${crypto.randomUUID()}`,
      personalOwnerUserId: user.id,
      onboardingCompletedAt: new Date(),
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('workspace fixture failed');
  workspaceIds.push(workspace.id);
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  });
  await db.insert(userPreferences).values({ userId: user.id, activeWorkspaceId: workspace.id });
  const now = Date.now();
  await db.insert(workspaceEntitlements).values({
    workspaceId: workspace.id,
    status: 'active',
    planKey,
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    currentPeriodStartedAt: new Date(now - 24 * 60 * 60 * 1000),
    currentPeriodEndsAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
  });
  actionState.context = { workspaceId: workspace.id, userId: user.id };
  return { workspaceId: workspace.id, userId: user.id };
}

async function entitlement(workspaceId: string) {
  return getTestDb().query.workspaceEntitlements.findFirst({
    where: eq(workspaceEntitlements.workspaceId, workspaceId),
  });
}

async function insertProcessingCheckout(workspaceId: string) {
  await getTestDb().insert(billingTransactions).values({
    workspaceId,
    idempotencyKey: crypto.randomUUID(),
    planKey: 'professional',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    subtotalMinor: 1500n,
    vatEnabled: false,
    appliedVatRateBasisPoints: 0,
    vatAmountMinor: 0n,
    totalMinor: 1500n,
    taxMode: 'disabled',
    providerKind: 'mock',
    status: 'processing',
  });
}

afterEach(async () => {
  actionState.context = null;
  actionState.unauthenticated = false;
  const db = getTestDb();
  for (const workspaceId of workspaceIds.splice(0)) {
    await db.delete(billingTransactions).where(eq(billingTransactions.workspaceId, workspaceId));
  }
  for (const userId of userIds.splice(0)) await db.delete(users).where(eq(users.id, userId));
});

afterAll(async () => {
  await closeDb();
  await closeTestDb();
});

describe('customer subscription-management actions (real PostgreSQL)', () => {
  it.each([
    ['trader', 'starter'],
    ['professional', 'trader'],
    ['professional', 'starter'],
  ] as const)(
    'schedules %s to %s at the stored period end and audits once',
    async (current, target) => {
      const { workspaceId } = await createPaidWorkspace(current);
      const before = await entitlement(workspaceId);
      const first = await schedulePlanDowngradeAction({ targetPlanKey: target });
      const retry = await schedulePlanDowngradeAction({ targetPlanKey: target });
      expect(first).toMatchObject({ ok: true, changed: true });
      expect(retry).toMatchObject({ ok: true, changed: false });
      const row = await entitlement(workspaceId);
      expect(row?.pendingPlanKey).toBe(target);
      expect(row?.pendingPlanEffectiveAt?.toISOString()).toBe(
        before?.currentPeriodEndsAt?.toISOString(),
      );
      const audits = await getTestDb()
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.action, 'subscription.downgrade_scheduled'),
          ),
        );
      expect(audits).toHaveLength(1);
    },
  );

  it('rejects same/higher plans and every client-controlled lifecycle value', async () => {
    await createPaidWorkspace('trader');
    await expect(schedulePlanDowngradeAction({ targetPlanKey: 'trader' })).resolves.toEqual({
      ok: false,
      code: 'downgrade_not_allowed',
    });
    await expect(schedulePlanDowngradeAction({ targetPlanKey: 'professional' })).resolves.toEqual({
      ok: false,
      code: 'downgrade_not_allowed',
    });
    for (const invalid of [
      { targetPlanKey: 'starter', effectiveAt: new Date().toISOString() },
      { targetPlanKey: 'starter', workspaceId: crypto.randomUUID() },
      { targetPlanKey: 'starter', currency: 'THB' },
    ]) {
      await expect(schedulePlanDowngradeAction(invalid)).resolves.toEqual({
        ok: false,
        code: 'validation',
      });
    }
  });

  it('cancels a pending downgrade idempotently', async () => {
    const { workspaceId } = await createPaidWorkspace('professional');
    await schedulePlanDowngradeAction({ targetPlanKey: 'starter' });
    await expect(cancelPlanDowngradeAction({})).resolves.toMatchObject({ ok: true, changed: true });
    await expect(cancelPlanDowngradeAction({})).resolves.toMatchObject({
      ok: true,
      changed: false,
    });
    expect(await entitlement(workspaceId)).toMatchObject({
      pendingPlanKey: null,
      pendingPlanEffectiveAt: null,
    });
  });

  it('scheduling cancellation clears downgrade, blocks another downgrade, and reversal restores no downgrade', async () => {
    const { workspaceId } = await createPaidWorkspace('professional');
    await schedulePlanDowngradeAction({ targetPlanKey: 'starter' });
    await expect(scheduleSubscriptionCancellationAction({})).resolves.toMatchObject({
      ok: true,
      changed: true,
    });
    await expect(scheduleSubscriptionCancellationAction({})).resolves.toMatchObject({
      ok: true,
      changed: false,
    });
    expect(await entitlement(workspaceId)).toMatchObject({
      cancelAtPeriodEnd: true,
      pendingPlanKey: null,
      pendingPlanEffectiveAt: null,
    });
    await expect(schedulePlanDowngradeAction({ targetPlanKey: 'trader' })).resolves.toEqual({
      ok: false,
      code: 'downgrade_not_allowed',
    });
    const cancellationAudits = await getTestDb()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.workspaceId, workspaceId),
          eq(auditLogs.action, 'subscription.cancellation_scheduled'),
        ),
      );
    expect(cancellationAudits).toHaveLength(1);
    await expect(cancelSubscriptionCancellationAction({})).resolves.toMatchObject({
      ok: true,
      changed: true,
    });
    expect(await entitlement(workspaceId)).toMatchObject({
      cancelAtPeriodEnd: false,
      pendingPlanKey: null,
    });
  });

  it('rejects every lifecycle action while a checkout is non-terminal', async () => {
    const { workspaceId } = await createPaidWorkspace('professional');
    await insertProcessingCheckout(workspaceId);
    for (const action of [
      () => schedulePlanDowngradeAction({ targetPlanKey: 'starter' }),
      () => cancelPlanDowngradeAction({}),
      () => scheduleSubscriptionCancellationAction({}),
      () => cancelSubscriptionCancellationAction({}),
    ]) {
      await expect(action()).resolves.toEqual({ ok: false, code: 'checkout_in_progress' });
    }
  });

  it('denies removed membership, unauthenticated calls, and client-selected workspaces', async () => {
    const first = await createPaidWorkspace('professional');
    await getTestDb()
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, first.workspaceId),
          eq(workspaceMembers.userId, first.userId),
        ),
      );
    await expect(schedulePlanDowngradeAction({ targetPlanKey: 'starter' })).resolves.toEqual({
      ok: false,
      code: 'forbidden',
    });
    await createPaidWorkspace('professional');
    await expect(
      schedulePlanDowngradeAction({
        targetPlanKey: 'starter',
        workspaceId: first.workspaceId,
      }),
    ).resolves.toEqual({ ok: false, code: 'validation' });
    actionState.unauthenticated = true;
    await expect(scheduleSubscriptionCancellationAction({})).resolves.toEqual({
      ok: false,
      code: 'unauthenticated',
    });
  });
});
