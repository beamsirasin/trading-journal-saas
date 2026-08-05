import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createFixedClock } from '@/lib/time';
import { closeDb } from '@/server/db/client';
import { auditLogs, workspaceEntitlements, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import {
  activatePaidSubscription,
  applyImmediateUpgrade,
  cancelScheduledCancellation,
  cancelScheduledDowngrade,
  markSubscriptionExpired,
  markSubscriptionPastDue,
  materializeDueLifecycleState,
  recoverSubscription,
  scheduleCancellationAtPeriodEnd,
  schedulePlanDowngrade,
} from './subscription-lifecycle';

const NOW = new Date('2026-08-01T00:00:00Z');
const PERIOD_START = new Date('2026-07-15T00:00:00Z');
const PERIOD_END = new Date('2026-09-01T00:00:00Z');
const RENEWED_END = new Date('2026-10-01T00:00:00Z');

describe('subscription lifecycle transitions (real database)', () => {
  const workspaceIds: string[] = [];

  async function createWorkspaceWithEntitlement(
    overrides: Partial<typeof workspaceEntitlements.$inferInsert> = {},
  ): Promise<string> {
    const db = getTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Lifecycle workspace', slug: `lifecycle-${crypto.randomUUID()}` })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to create lifecycle workspace');
    workspaceIds.push(workspace.id);
    await db.insert(workspaceEntitlements).values({
      workspaceId: workspace.id,
      status: 'trialing',
      trialStartedAt: new Date('2026-06-01T00:00:00Z'),
      trialEndsAt: new Date('2026-06-08T00:00:00Z'),
      ...overrides,
    });
    return workspace.id;
  }

  async function createActiveWorkspace(
    planKey: 'starter' | 'trader' | 'professional' = 'trader',
  ): Promise<string> {
    return createWorkspaceWithEntitlement({
      status: 'active',
      planKey,
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      currentPeriodStartedAt: PERIOD_START,
      currentPeriodEndsAt: PERIOD_END,
    });
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

  it('activates trial to paid, preserves trial timestamps, audits once, and is retry-safe', async () => {
    const db = getTestDb();
    const workspaceId = await createWorkspaceWithEntitlement();
    const input = {
      workspaceId,
      planKey: 'trader' as const,
      billingCurrency: 'USD' as const,
      billingInterval: 'monthly' as const,
      periodStartedAt: PERIOD_START,
      periodEndsAt: PERIOD_END,
      providerKind: 'trusted-test',
    };

    await expect(activatePaidSubscription(input, createFixedClock(NOW))).resolves.toEqual({
      changed: true,
    });
    await expect(activatePaidSubscription(input, createFixedClock(NOW))).resolves.toEqual({
      changed: false,
    });

    const [row] = await db
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    expect(row).toMatchObject({
      status: 'active',
      planKey: 'trader',
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      cancelAtPeriodEnd: false,
      pendingPlanKey: null,
    });
    expect(row?.trialStartedAt?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(row?.trialEndsAt?.toISOString()).toBe('2026-06-08T00:00:00.000Z');

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, workspaceId));
    expect(audits.filter((audit) => audit.action === 'subscription.activated')).toHaveLength(1);
  });

  it('rejects unsupported activation inputs and invalid or stale periods', async () => {
    const workspaceId = await createWorkspaceWithEntitlement();
    const base = {
      workspaceId,
      planKey: 'starter' as const,
      billingCurrency: 'USD' as const,
      billingInterval: 'monthly' as const,
      periodStartedAt: PERIOD_START,
      periodEndsAt: PERIOD_END,
    };
    const clock = createFixedClock(NOW);

    await expect(
      activatePaidSubscription({ ...base, planKey: 'enterprise' as never }, clock),
    ).rejects.toMatchObject({ code: 'unsupported_plan' });
    await expect(
      activatePaidSubscription({ ...base, billingCurrency: 'EUR' as never }, clock),
    ).rejects.toMatchObject({ code: 'unsupported_currency' });
    await expect(
      activatePaidSubscription({ ...base, billingInterval: 'annual' as never }, clock),
    ).rejects.toMatchObject({ code: 'unsupported_billing_interval' });
    await expect(
      activatePaidSubscription(
        { ...base, periodStartedAt: PERIOD_END, periodEndsAt: PERIOD_START },
        clock,
      ),
    ).rejects.toMatchObject({ code: 'invalid_billing_period' });
    await expect(
      activatePaidSubscription(
        {
          ...base,
          periodStartedAt: new Date('2026-06-01T00:00:00Z'),
          periodEndsAt: new Date('2026-07-01T00:00:00Z'),
        },
        clock,
      ),
    ).rejects.toMatchObject({ code: 'stale_period' });
  });

  it('applies only a strictly larger immediate upgrade and clears obsolete pending state', async () => {
    const db = getTestDb();
    const workspaceId = await createActiveWorkspace('trader');
    await db
      .update(workspaceEntitlements)
      .set({ pendingPlanKey: 'starter', pendingPlanEffectiveAt: PERIOD_END })
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    const base = {
      workspaceId,
      billingCurrency: 'USD' as const,
      billingInterval: 'monthly' as const,
      periodStartedAt: NOW,
      periodEndsAt: RENEWED_END,
    };

    await expect(
      applyImmediateUpgrade({ ...base, planKey: 'trader' }, createFixedClock(NOW)),
    ).rejects.toMatchObject({ code: 'invalid_lifecycle_transition' });
    await expect(
      applyImmediateUpgrade({ ...base, planKey: 'starter' }, createFixedClock(NOW)),
    ).rejects.toMatchObject({ code: 'invalid_lifecycle_transition' });
    await expect(
      applyImmediateUpgrade(
        { ...base, planKey: 'professional', billingCurrency: 'THB' },
        createFixedClock(NOW),
      ),
    ).rejects.toMatchObject({ code: 'currency_change_not_allowed' });
    await expect(
      applyImmediateUpgrade({ ...base, planKey: 'professional' }, createFixedClock(NOW)),
    ).resolves.toEqual({ changed: true });

    const [row] = await db
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    expect(row).toMatchObject({
      planKey: 'professional',
      pendingPlanKey: null,
      pendingPlanEffectiveAt: null,
    });
  });

  it('schedules downgrade at the stored period end and can cancel it', async () => {
    const db = getTestDb();
    const workspaceId = await createActiveWorkspace('professional');
    const scheduled = await schedulePlanDowngrade(
      { workspaceId, targetPlanKey: 'starter' },
      createFixedClock(NOW),
    );
    expect(scheduled.effectiveAt.toISOString()).toBe(PERIOD_END.toISOString());

    const [pending] = await db
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    expect(pending?.planKey).toBe('professional');
    expect(pending?.pendingPlanKey).toBe('starter');
    expect(pending?.pendingPlanEffectiveAt?.toISOString()).toBe(PERIOD_END.toISOString());

    await expect(cancelScheduledDowngrade({ workspaceId }, createFixedClock(NOW))).resolves.toEqual(
      { changed: true },
    );
    const [canceled] = await db
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    expect(canceled?.pendingPlanKey).toBeNull();
    expect(canceled?.pendingPlanEffectiveAt).toBeNull();
  });

  it('schedules and reverses cancellation only before the exact boundary', async () => {
    const workspaceId = await createActiveWorkspace();
    await expect(
      scheduleCancellationAtPeriodEnd({ workspaceId }, createFixedClock(NOW)),
    ).resolves.toEqual({ changed: true });
    await expect(
      cancelScheduledCancellation(
        { workspaceId },
        createFixedClock(new Date(PERIOD_END.getTime() - 1)),
      ),
    ).resolves.toEqual({ changed: true });

    await scheduleCancellationAtPeriodEnd({ workspaceId }, createFixedClock(NOW));
    await expect(
      cancelScheduledCancellation({ workspaceId }, createFixedClock(PERIOD_END)),
    ).rejects.toMatchObject({ code: 'stale_transition' });
  });

  it('moves active to past_due and recovers only with same-currency trusted period data', async () => {
    const db = getTestDb();
    const workspaceId = await createActiveWorkspace();
    await expect(markSubscriptionPastDue({ workspaceId }, createFixedClock(NOW))).resolves.toEqual({
      changed: true,
    });
    await expect(
      recoverSubscription(
        {
          workspaceId,
          billingCurrency: 'THB',
          billingInterval: 'monthly',
          periodStartedAt: NOW,
          periodEndsAt: RENEWED_END,
        },
        createFixedClock(NOW),
      ),
    ).rejects.toMatchObject({ code: 'currency_change_not_allowed' });
    await expect(
      recoverSubscription(
        {
          workspaceId,
          billingCurrency: 'USD',
          billingInterval: 'monthly',
          periodStartedAt: NOW,
          periodEndsAt: RENEWED_END,
        },
        createFixedClock(NOW),
      ),
    ).resolves.toEqual({ changed: true });

    const [row] = await db
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    expect(row).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
  });

  it('materializes due pending plan and period-end state without changing history', async () => {
    const db = getTestDb();
    const workspaceId = await createActiveWorkspace('professional');
    await db
      .update(workspaceEntitlements)
      .set({
        pendingPlanKey: 'starter',
        pendingPlanEffectiveAt: PERIOD_END,
        cancelAtPeriodEnd: true,
      })
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));

    await expect(
      materializeDueLifecycleState({ workspaceId }, createFixedClock(PERIOD_END)),
    ).resolves.toEqual({ changed: true });
    const [row] = await db
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    expect(row).toMatchObject({
      status: 'canceled',
      planKey: 'starter',
      pendingPlanKey: null,
      cancelAtPeriodEnd: false,
    });
    expect(row?.trialStartedAt?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    const audits = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.workspaceId, workspaceId));
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(['subscription.pending_plan_materialized', 'subscription.canceled']),
    );
  });

  it('serializes concurrent upgrade and downgrade into a coherent final state', async () => {
    const db = getTestDb();
    const workspaceId = await createActiveWorkspace('trader');
    const results = await Promise.allSettled([
      applyImmediateUpgrade(
        {
          workspaceId,
          planKey: 'professional',
          billingCurrency: 'USD',
          billingInterval: 'monthly',
          periodStartedAt: NOW,
          periodEndsAt: RENEWED_END,
        },
        createFixedClock(NOW),
      ),
      schedulePlanDowngrade({ workspaceId, targetPlanKey: 'starter' }, createFixedClock(NOW)),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);

    const [row] = await db
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    expect(row?.planKey).toBe('professional');
    expect([null, 'starter']).toContain(row?.pendingPlanKey ?? null);
    expect(row?.billingCurrency).toBe('USD');
  });

  it('rejects invalid expiration transitions and keeps explicit expiry retry-safe', async () => {
    const trialWorkspaceId = await createWorkspaceWithEntitlement();
    await expect(
      markSubscriptionExpired({ workspaceId: trialWorkspaceId }, createFixedClock(NOW)),
    ).rejects.toMatchObject({ code: 'invalid_lifecycle_transition' });

    const paidWorkspaceId = await createActiveWorkspace();
    await expect(
      markSubscriptionExpired({ workspaceId: paidWorkspaceId }, createFixedClock(NOW)),
    ).resolves.toEqual({ changed: true });
    await expect(
      markSubscriptionExpired({ workspaceId: paidWorkspaceId }, createFixedClock(NOW)),
    ).resolves.toEqual({ changed: false });
  });
});
