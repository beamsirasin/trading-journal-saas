import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { billingTransactions, workspaceEntitlements, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

type BillingInsert = typeof billingTransactions.$inferInsert;
type EntitlementInsert = typeof workspaceEntitlements.$inferInsert;

function databaseErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    const record = current as Record<string, unknown>;
    if (typeof record.code === 'string') return record.code;
    current = record.cause;
  }
  return undefined;
}

async function expectDatabaseError(operation: Promise<unknown>, code: string): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(databaseErrorCode(error)).toBe(code);
    return;
  }
  throw new Error(`expected PostgreSQL error ${code}`);
}

/**
 * An `ON DELETE RESTRICT` violation is the one PostgreSQL rejection this
 * suite has observed surfaced under two different SQLSTATE codes depending
 * on version/environment: `23001` (restrict_violation) locally on
 * PostgreSQL 18.4, and `23503` (foreign_key_violation) on GitHub Actions'
 * PostgreSQL service container. Both are genuine integrity-constraint
 * rejections of the same RESTRICT behavior, so either is accepted here —
 * never an arbitrary error, and never every class-23 error.
 */
const RESTRICT_VIOLATION_CODES = ['23001', '23503'] as const;

async function expectRestrictViolation(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(RESTRICT_VIOLATION_CODES).toContain(databaseErrorCode(error));
    return;
  }
  throw new Error(`expected a RESTRICT violation (${RESTRICT_VIOLATION_CODES.join(' or ')})`);
}

describe('Phase 04C billing schema (real database)', () => {
  const createdWorkspaceIds: string[] = [];

  async function createWorkspace(label = 'billing-schema'): Promise<string> {
    const db = getTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: label, slug: `${label}-${crypto.randomUUID()}` })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to create test workspace');
    createdWorkspaceIds.push(workspace.id);
    return workspace.id;
  }

  function snapshot(workspaceId: string, overrides: Partial<BillingInsert> = {}): BillingInsert {
    return {
      workspaceId,
      idempotencyKey: crypto.randomUUID(),
      planKey: 'starter',
      billingCurrency: 'THB',
      billingInterval: 'monthly',
      subtotalMinor: 14_900n,
      vatEnabled: false,
      appliedVatRateBasisPoints: 0,
      vatAmountMinor: 0n,
      totalMinor: 14_900n,
      taxMode: 'disabled',
      ...overrides,
    };
  }

  async function expectEntitlementRejected(overrides: Partial<EntitlementInsert>): Promise<void> {
    const workspaceId = await createWorkspace('invalid-entitlement');
    await expectDatabaseError(
      getTestDb()
        .insert(workspaceEntitlements)
        .values({ workspaceId, status: 'active', ...overrides }),
      '23514',
    );
  }

  afterEach(async () => {
    const db = getTestDb();
    for (const workspaceId of createdWorkspaceIds.splice(0)) {
      await db.delete(billingTransactions).where(eq(billingTransactions.workspaceId, workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe('workspace entitlement lifecycle constraints', () => {
    it('accepts every supported status, including past_due, with nullable provider fields', async () => {
      const db = getTestDb();
      for (const status of ['trialing', 'active', 'past_due', 'canceled', 'expired']) {
        const workspaceId = await createWorkspace(`status-${status}`);
        const [row] = await db
          .insert(workspaceEntitlements)
          .values({ workspaceId, status })
          .returning();
        expect(row?.status).toBe(status);
        expect(row?.providerKind).toBeNull();
        expect(row?.providerCustomerId).toBeNull();
        expect(row?.providerSubscriptionId).toBeNull();
      }
    });

    it('rejects unsupported status, current/pending plan, currency, and interval values', async () => {
      await expectEntitlementRejected({ status: 'paused' });
      await expectEntitlementRejected({ planKey: 'enterprise' });
      await expectEntitlementRejected({ billingCurrency: 'EUR' });
      await expectEntitlementRejected({ billingInterval: 'annual' });
      await expectEntitlementRejected({
        pendingPlanKey: 'enterprise',
        pendingPlanEffectiveAt: new Date('2026-04-01T00:00:00Z'),
      });
    });

    it('accepts THB/USD and monthly, and rejects inverted billing periods', async () => {
      const db = getTestDb();
      for (const billingCurrency of ['THB', 'USD']) {
        const workspaceId = await createWorkspace(`currency-${billingCurrency}`);
        await expect(
          db.insert(workspaceEntitlements).values({
            workspaceId,
            status: 'active',
            billingCurrency,
            billingInterval: 'monthly',
            currentPeriodStartedAt: new Date('2026-03-01T00:00:00Z'),
            currentPeriodEndsAt: new Date('2026-04-01T00:00:00Z'),
          }),
        ).resolves.toBeDefined();
      }

      await expectEntitlementRejected({
        currentPeriodStartedAt: new Date('2026-04-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2026-03-01T00:00:00Z'),
      });
    });

    it('enforces cancellation-period and pending-downgrade pair consistency', async () => {
      await expectEntitlementRejected({ cancelAtPeriodEnd: true });
      await expectEntitlementRejected({ pendingPlanKey: 'starter' });
      await expectEntitlementRejected({
        pendingPlanEffectiveAt: new Date('2026-04-01T00:00:00Z'),
      });

      const workspaceId = await createWorkspace('valid-pending-downgrade');
      await expect(
        getTestDb()
          .insert(workspaceEntitlements)
          .values({
            workspaceId,
            status: 'active',
            planKey: 'trader',
            cancelAtPeriodEnd: true,
            currentPeriodEndsAt: new Date('2026-04-01T00:00:00Z'),
            pendingPlanKey: 'starter',
            pendingPlanEffectiveAt: new Date('2026-04-01T00:00:00Z'),
          }),
      ).resolves.toBeDefined();
    });
  });

  describe('billing transaction financial snapshots', () => {
    it('stores valid VAT-disabled and exact 7% exclusive bigint snapshots', async () => {
      const db = getTestDb();
      const workspaceId = await createWorkspace('valid-snapshots');
      const [disabled] = await db
        .insert(billingTransactions)
        .values(snapshot(workspaceId))
        .returning();
      const [exclusive] = await db
        .insert(billingTransactions)
        .values(
          snapshot(workspaceId, {
            planKey: 'professional',
            billingCurrency: 'USD',
            subtotalMinor: 1_500n,
            vatEnabled: true,
            appliedVatRateBasisPoints: 700,
            vatAmountMinor: 105n,
            totalMinor: 1_605n,
            taxMode: 'exclusive',
            taxJurisdiction: 'TH',
          }),
        )
        .returning();

      expect(disabled).toMatchObject({
        subtotalMinor: 14_900n,
        vatAmountMinor: 0n,
        totalMinor: 14_900n,
        vatEnabled: false,
        taxMode: 'disabled',
      });
      expect(exclusive).toMatchObject({
        subtotalMinor: 1_500n,
        vatAmountMinor: 105n,
        totalMinor: 1_605n,
        appliedVatRateBasisPoints: 700,
        vatEnabled: true,
        taxMode: 'exclusive',
      });
      expect(typeof exclusive?.subtotalMinor).toBe('bigint');
      expect(typeof exclusive?.vatAmountMinor).toBe('bigint');
      expect(typeof exclusive?.totalMinor).toBe('bigint');
    });

    it('rejects invalid money, VAT, catalogue, interval, and status snapshots', async () => {
      const db = getTestDb();
      const workspaceId = await createWorkspace('invalid-snapshots');
      const invalidSnapshots: Partial<BillingInsert>[] = [
        {
          subtotalMinor: -1n,
          vatEnabled: true,
          appliedVatRateBasisPoints: 700,
          vatAmountMinor: 1n,
          totalMinor: 0n,
          taxMode: 'exclusive',
        },
        {
          subtotalMinor: 100n,
          vatEnabled: true,
          appliedVatRateBasisPoints: 700,
          vatAmountMinor: -1n,
          totalMinor: 99n,
          taxMode: 'exclusive',
        },
        { subtotalMinor: -1n, vatAmountMinor: 0n, totalMinor: -1n },
        { subtotalMinor: 100n, vatAmountMinor: 0n, totalMinor: 99n },
        {
          subtotalMinor: 100n,
          vatEnabled: true,
          appliedVatRateBasisPoints: 10_001,
          vatAmountMinor: 1n,
          totalMinor: 101n,
          taxMode: 'exclusive',
        },
        { appliedVatRateBasisPoints: 700 },
        { vatAmountMinor: 1n, totalMinor: 14_901n },
        { taxMode: 'exclusive' },
        { vatEnabled: true, taxMode: 'disabled' },
        { planKey: 'enterprise' },
        { billingCurrency: 'EUR' },
        { billingInterval: 'annual' },
        { status: 'refunded' },
      ];

      for (const overrides of invalidSnapshots) {
        await expectDatabaseError(
          db.insert(billingTransactions).values(snapshot(workspaceId, overrides)),
          '23514',
        );
      }
    });
  });

  describe('idempotency and provider uniqueness', () => {
    it('scopes idempotency to a workspace', async () => {
      const db = getTestDb();
      const firstWorkspaceId = await createWorkspace('idem-first');
      const secondWorkspaceId = await createWorkspace('idem-second');
      const idempotencyKey = crypto.randomUUID();
      await db.insert(billingTransactions).values(snapshot(firstWorkspaceId, { idempotencyKey }));
      await expectDatabaseError(
        db.insert(billingTransactions).values(snapshot(firstWorkspaceId, { idempotencyKey })),
        '23505',
      );
      await expect(
        db.insert(billingTransactions).values(snapshot(secondWorkspaceId, { idempotencyKey })),
      ).resolves.toBeDefined();
    });

    it('rejects duplicate non-null provider IDs but permits multiple null IDs', async () => {
      const db = getTestDb();
      const workspaceId = await createWorkspace('provider-uniqueness');
      await db.insert(billingTransactions).values([snapshot(workspaceId), snapshot(workspaceId)]);

      await db.insert(billingTransactions).values(
        snapshot(workspaceId, {
          providerCheckoutId: 'checkout-unique',
          providerPaymentId: 'payment-unique',
        }),
      );
      await expectDatabaseError(
        db
          .insert(billingTransactions)
          .values(snapshot(workspaceId, { providerCheckoutId: 'checkout-unique' })),
        '23505',
      );
      await expectDatabaseError(
        db
          .insert(billingTransactions)
          .values(snapshot(workspaceId, { providerPaymentId: 'payment-unique' })),
        '23505',
      );
    });
  });

  describe('database-enforced snapshot immutability', () => {
    it('rejects commercial, tax, workspace, and idempotency changes', async () => {
      const db = getTestDb();
      const workspaceId = await createWorkspace('immutable-source');
      const otherWorkspaceId = await createWorkspace('immutable-target');
      const [row] = await db
        .insert(billingTransactions)
        .values(snapshot(workspaceId))
        .returning({ id: billingTransactions.id });
      if (row === undefined) throw new Error('failed to create immutable snapshot');

      const protectedUpdates: Partial<BillingInsert>[] = [
        { subtotalMinor: 20_000n, totalMinor: 20_000n },
        {
          vatEnabled: true,
          appliedVatRateBasisPoints: 700,
          vatAmountMinor: 1_043n,
          totalMinor: 15_943n,
          taxMode: 'exclusive',
        },
        { taxJurisdiction: 'TH', vatRegistrationNumber: 'VAT-001' },
        { planKey: 'trader' },
        { billingCurrency: 'USD' },
        { workspaceId: otherWorkspaceId },
        { idempotencyKey: crypto.randomUUID() },
      ];
      for (const values of protectedUpdates) {
        await expectDatabaseError(
          db.update(billingTransactions).set(values).where(eq(billingTransactions.id, row.id)),
          '23514',
        );
      }
    });

    it('allows provider, status, failure, and lifecycle timestamp updates', async () => {
      const db = getTestDb();
      const workspaceId = await createWorkspace('mutable-processing');
      const [succeeded] = await db
        .insert(billingTransactions)
        .values(snapshot(workspaceId))
        .returning({ id: billingTransactions.id });
      const [failed] = await db
        .insert(billingTransactions)
        .values(snapshot(workspaceId))
        .returning({ id: billingTransactions.id });
      if (succeeded === undefined || failed === undefined) throw new Error('failed to seed rows');

      const completedAt = new Date('2026-04-01T00:00:00Z');
      const failedAt = new Date('2026-04-02T00:00:00Z');
      await expect(
        db
          .update(billingTransactions)
          .set({
            status: 'succeeded',
            providerKind: 'mock',
            providerCheckoutId: 'checkout-updated',
            providerPaymentId: 'payment-updated',
            completedAt,
            updatedAt: completedAt,
          })
          .where(eq(billingTransactions.id, succeeded.id)),
      ).resolves.toBeDefined();
      await expect(
        db
          .update(billingTransactions)
          .set({ status: 'failed', failureCode: 'declined', failedAt, updatedAt: failedAt })
          .where(eq(billingTransactions.id, failed.id)),
      ).resolves.toBeDefined();
    });
  });

  describe('tenant integrity', () => {
    it('requires an existing workspace and rejects workspace deletion while its snapshot remains', async () => {
      const db = getTestDb();
      await expectDatabaseError(
        db.insert(billingTransactions).values(snapshot(crypto.randomUUID())),
        '23503',
      );

      const workspaceId = await createWorkspace('retained-snapshot-owner');
      const [row] = await db
        .insert(billingTransactions)
        .values(snapshot(workspaceId))
        .returning({ id: billingTransactions.id });
      if (row === undefined) throw new Error('failed to seed retained snapshot');
      await expectRestrictViolation(db.delete(workspaces).where(eq(workspaces.id, workspaceId)));
      const remaining = await db
        .select({ id: billingTransactions.id })
        .from(billingTransactions)
        .where(eq(billingTransactions.id, row.id));
      expect(remaining).toHaveLength(1);
    });
  });
});
